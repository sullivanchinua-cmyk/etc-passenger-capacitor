// =========================================================
// Payment form validators + formatters – pure functions, no DOM.
// (UMD: works in the browser as window.ETC_PayValidate and in node for tests)
// =========================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ETC_PayValidate = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const digits = (s) => String(s == null ? "" : s).replace(/\D+/g, "");

  // ---------- card ----------
  const BRANDS = {
    visa:       { name: "Visa",        lens: [13, 16, 19], cvv: 3, gaps: [4, 8, 12, 16] },
    mastercard: { name: "Mastercard",  lens: [16],         cvv: 3, gaps: [4, 8, 12] },
    verve:      { name: "Verve",       lens: [16, 18, 19], cvv: 3, gaps: [4, 8, 12, 16] },
    amex:       { name: "American Express", lens: [15],    cvv: 4, gaps: [4, 10] },
  };
  function brandOf(num) {
    const n = digits(num);
    if (/^(5061|5060|5078|5079|6500|6501|6502)/.test(n)) return "verve";   // check before Mastercard (50…)
    if (/^3[47]/.test(n)) return "amex";
    if (/^4/.test(n)) return "visa";
    if (/^(5[1-5]|2(22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(n)) return "mastercard";
    return null;
  }
  function luhn(num) {
    const n = digits(num); if (n.length < 12) return false;
    let sum = 0, alt = false;
    for (let i = n.length - 1; i >= 0; i--) {
      let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d; alt = !alt;
    }
    return sum % 10 === 0;
  }
  function formatCard(raw) {
    const n = digits(raw).slice(0, 19), b = BRANDS[brandOf(n)];
    const gaps = b ? b.gaps : [4, 8, 12, 16];
    let out = "", last = 0;
    gaps.forEach((g) => { if (n.length > last) out += (out ? " " : "") + n.slice(last, g); last = g; });
    if (n.length > last) out += (out ? " " : "") + n.slice(last);
    return out;
  }
  function validCard(num, allowed) {
    const n = digits(num), br = brandOf(n);
    if (!br) return { ok: false, msg: "Enter a Visa, Mastercard, Verve or Amex card number" };
    if (allowed && allowed.indexOf(br) < 0) return { ok: false, msg: BRANDS[br].name + " isn’t accepted here" };
    if (BRANDS[br].lens.indexOf(n.length) < 0) return { ok: false, msg: "Card number looks too " + (n.length < BRANDS[br].lens[0] ? "short" : "long") };
    // Verve cards are not always Luhn-valid on issuer test ranges – length + prefix is enough for them
    if (br !== "verve" && !luhn(n)) return { ok: false, msg: "Check the card number – it doesn’t look right" };
    return { ok: true, brand: br };
  }
  function formatExpiry(raw, prev) {
    let d = digits(raw).slice(0, 4);
    if (d.length === 1 && +d > 1) d = "0" + d;                       // 4 → 04
    if (d.length >= 2) d = d.slice(0, 2) + "/" + d.slice(2);
    if (prev && prev.length > raw.length && d.endsWith("/")) d = d.slice(0, -1);   // let backspace pass the slash
    return d;
  }
  function validExpiry(v, now) {
    const m = /^(\d{2})\/(\d{2})$/.exec(String(v || ""));
    if (!m) return { ok: false, msg: "Use MM/YY" };
    const mm = +m[1], yy = 2000 + +m[2];
    if (mm < 1 || mm > 12) return { ok: false, msg: "Month must be 01–12" };
    const t = now || new Date();
    if (yy < t.getFullYear() || (yy === t.getFullYear() && mm < t.getMonth() + 1)) return { ok: false, msg: "This card has expired" };
    if (yy > t.getFullYear() + 20) return { ok: false, msg: "Check the expiry year" };
    return { ok: true, month: m[1], year: String(yy) };
  }
  function validCvv(v, brand) {
    const need = (BRANDS[brand] || BRANDS.visa).cvv, n = digits(v);
    return n.length === need ? { ok: true } : { ok: false, msg: `CVV is ${need} digits` };
  }

  // ---------- other fields ----------
  const validEmail = (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()) ? { ok: true } : { ok: false, msg: "Enter a valid email for your receipt" });
  function normPhoneNG(v) {
    let n = digits(v);
    if (n.startsWith("234") && n.length === 13) n = "0" + n.slice(3);
    return n;
  }
  const validPhoneNG = (v) => (/^0[789][01]\d{8}$/.test(normPhoneNG(v)) ? { ok: true, value: normPhoneNG(v) } : { ok: false, msg: "Enter an 11-digit Nigerian phone number" });
  const validAccount = (v) => (digits(v).length === 10 ? { ok: true, value: digits(v) } : { ok: false, msg: "Account number is 10 digits" });
  const validPin = (v) => (/^\d{4}$/.test(String(v || "")) ? { ok: true } : { ok: false, msg: "Enter your 4-digit card PIN" });
  const validOtp = (v) => (/^\d{4,8}$/.test(String(v || "")) ? { ok: true } : { ok: false, msg: "Enter the code that was sent to you" });
  function validBirthday(v, now) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
    if (!m) return { ok: false, msg: "Use the date picker" };
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getMonth() !== +m[2] - 1 || d.getFullYear() < 1900 || d > (now || new Date())) return { ok: false, msg: "Enter a real date of birth" };
    return { ok: true };
  }
  const validText = (v, label, min) => (String(v || "").trim().length >= (min || 2) ? { ok: true } : { ok: false, msg: `Enter ${label}` });

  const maskCard = (num) => { const n = digits(num); return n ? "•••• " + n.slice(-4) : ""; };

  return { digits, BRANDS, brandOf, luhn, formatCard, validCard, formatExpiry, validExpiry, validCvv,
           validEmail, normPhoneNG, validPhoneNG, validAccount, validPin, validOtp, validBirthday, validText, maskCard };
});
