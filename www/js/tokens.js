// =========================================================
// 30-second dynamic ticket tokens (anti-screenshot).
//   payload = ETC1.<ticketId>.<window>.<token>
//   window  = floor(unixMs / 30000)
//   token   = first 10 hex chars of HMAC-SHA256(ticketSecret, ticketId + "." + window)
// The verifier app (later, with Firestore) holds the same ticketSecret, recomputes
// the token for window-1 … window+1 and accepts it. A screenshot dies in ≤ 60 s.
// Pure-JS SHA-256 so it also works on plain http / file:// where crypto.subtle is missing.
// =========================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ETC_Tokens = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const utf8 = (s) => { const o = []; s = unescape(encodeURIComponent(s)); for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i)); return o; };

  function sha256(bytes) {
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const l = bytes.length, bits = l * 8;
    const m = bytes.slice(); m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    for (let i = 7; i >= 0; i--) m.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < m.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4*i] << 24) | (m[o + 4*i + 1] << 16) | (m[o + 4*i + 2] << 8) | m[o + 4*i + 3];
      for (let i = 16; i < 64; i++) { const s0 = rot(w[i-15], 7) ^ rot(w[i-15], 18) ^ (w[i-15] >>> 3), s1 = rot(w[i-2], 17) ^ rot(w[i-2], 19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = []; H.forEach((x) => { for (let i = 3; i >= 0; i--) out.push((x >>> (i * 8)) & 255); });
    return out;
  }
  function hmac(key, msg) {
    let k = utf8(key); if (k.length > 64) k = sha256(k);
    while (k.length < 64) k.push(0);
    const ipad = k.map((b) => b ^ 0x36), opad = k.map((b) => b ^ 0x5c);
    return sha256(opad.concat(sha256(ipad.concat(utf8(msg)))));
  }
  const hex = (b) => b.map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha256hex = (s) => hex(sha256(utf8(s)));

  const PERIOD = 30000;
  const windowOf = (ms) => Math.floor((ms == null ? Date.now() : ms) / PERIOD);
  const tokenFor = (secret, id, win) => hex(hmac(secret, id + "." + win)).slice(0, 10);
  const payload = (ticket, ms) => {
    const w = windowOf(ms);
    // ETC1G = group/merged pass (agent boards all remaining on this payment reference)
    const prefix = ticket && ticket.groupBoard ? "ETC1G" : "ETC1";
    return `${prefix}.${ticket.id}.${w}.${tokenFor(ticket.secret, ticket.id, w)}`;
  };
  const secondsLeft = (ms) => { ms = ms == null ? Date.now() : ms; return Math.ceil((PERIOD - (ms % PERIOD)) / 1000); };
  function verify(secret, text, ms, drift) {
    const s = String(text || "").trim();
    // Parse from the right: ETC1.<id>.<window>.<token> (id may contain hyphens)
    let id = null, win = null, tok = null;
    if (s.toLowerCase().indexOf("etc1.") === 0) {
      const parts = s.split(".");
      if (parts.length >= 4) {
        tok = parts[parts.length - 1].toLowerCase();
        win = parts[parts.length - 2];
        id = parts.slice(1, -2).join(".");
      }
    }
    if (!id || !/^\d+$/.test(win || "") || !/^[0-9a-f]{10}$/.test(tok || "")) {
      return { ok: false, reason: "format" };
    }
    const w = windowOf(ms), d = drift == null ? 1 : drift;
    if (Math.abs(+win - w) > d) return { ok: false, reason: "expired", id: id };
    return tokenFor(secret, id, +win) === tok ? { ok: true, id: id } : { ok: false, reason: "bad-token", id: id };
  }
  function randomSecret() {
    const a = new Uint8Array(16);
    try { (self.crypto || require("crypto").webcrypto).getRandomValues(a); } catch (_) { for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    return hex(Array.from(a));
  }
  return { sha256hex, hmacHex: (k, m) => hex(hmac(k, m)), PERIOD, windowOf, tokenFor, payload, secondsLeft, verify, randomSecret };
});
