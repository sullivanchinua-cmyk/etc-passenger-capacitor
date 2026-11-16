// =========================================================
// DUMMY Paystack Charge API  (until you have real keys)
//
// Same shapes as Paystack:  POST /charge · /charge/submit_pin|otp|phone|birthday|address
//                           GET  /charge/:reference (pending check) · GET /transaction/verify/:reference
// so the real thing is a drop-in swap:  ETC_Paystack.createHttp("https://your-backend/pay")
//
// !! NEVER call Paystack from the app with your SECRET key (sk_…). The real adapter
//    below talks to YOUR backend (Cloud Function / server), which holds the key,
//    talks to Paystack, and answers with Paystack's JSON.
//
// TEST SCENARIOS  (tap the "Test mode" pill on the payment sheet, or set localStorage.etc_pay_scenario)
//   pass       everything succeeds by itself            ← default, "let Paystack pass it"
//   challenge  card asks PIN 1234 then OTP 123456; bank debit asks birthday + OTP; intl card asks address + 3-D Secure
//   threeds    card sends the customer to a bank page (approve / decline)
//   decline    card is declined (insufficient funds)
//   timeout    the request times out but the money WAS taken → tests "verify before retry"
//   network    first request fails (offline) → retry with the same reference succeeds
// =========================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ETC_Paystack = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SCENARIOS = [
    ["pass", "Auto-pass"], ["challenge", "PIN+OTP"], ["threeds", "3-D Secure"],
    ["decline", "Decline"], ["timeout", "Timeout"], ["network", "Offline"],
  ];
  const err = (kind, message) => Object.assign(new Error(message || kind), { kind });

  function createMock(o) {
    o = o || {};
    const store = o.storage || null;                      // sessionStorage in the browser → survives a reload
    const latency = o.latency == null ? 700 : o.latency;
    const passAfter = o.passAfter == null ? 5500 : o.passAfter;
    const clock = o.now || (() => Date.now());
    const wait = (ms) => new Promise((r) => (ms > 0 ? setTimeout(r, ms) : r()));
    const scenario = () => (typeof o.scenario === "function" ? o.scenario() : o.scenario) || "pass";

    let txns = {};
    try { if (store) txns = JSON.parse(store.getItem("etc_mock_txns")) || {}; } catch (_) {}
    const persist = () => { try { if (store) store.setItem("etc_mock_txns", JSON.stringify(txns)); } catch (_) {} };
    const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
    const ok = (data, message) => ({ status: true, message: message || "Charge attempted", data });
    const shape = (t, extra) => ({ reference: t.reference, status: t.status, amount: t.amount, currency: "NGN", channel: t.channel, gateway_response: t.gateway, domain: "test", ...(extra || {}) });

    function succeed(t) {
      t.status = "success"; t.gateway = "Successful"; t.paid_at = new Date(clock()).toISOString();
      if (t.channel === "card") t.authorization = { authorization_code: "AUTH_" + rnd(8), brand: t.brand, card_type: t.brand, last4: t.last4, bank: "TEST BANK" };
      persist(); return t;
    }
    const view = (t, extra) => shape(t, Object.assign(t.status === "success" ? { paid_at: t.paid_at, authorization: t.authorization } : {}, extra || {}));
    function channelOf(p) {
      return p.card ? (p.metadata && p.metadata.billing ? "intl_card" : "card") : p.bank_transfer ? "bank_transfer" : p.ussd ? "ussd" : p.mobile_money ? "mobile_money" : p.qr ? "qr" : p.apple_pay ? "apple_pay" : p.bank ? "bank" : "card";
    }

    // pending → success once `passAfter` has elapsed (only in auto-pass scenarios)
    function tick(t) {
      if (t.status === "pending" && t.autoPass && clock() - t.created >= passAfter) succeed(t);
      return t;
    }

    return {
      async charge(p) {
        await wait(latency);
        const sc = scenario();
        if (!p || !p.reference || !p.email || !(p.amount > 0)) throw err("invalid", "Missing email, amount or reference");
        // idempotency: the same reference never creates a second charge
        if (txns[p.reference]) { const t = tick(txns[p.reference]); return ok(Object.assign(view(t), pendingBits(t)), "Charge attempted (existing reference)"); }
        if (sc === "network" && !txns["__net_" + p.reference]) { txns["__net_" + p.reference] = { fired: true }; persist(); throw err("network", "Failed to fetch"); }

        const ch = channelOf(p);
        const t = txns[p.reference] = { reference: p.reference, amount: p.amount / 100, email: p.email, channel: ch, status: "pending", step: null, created: clock(), autoPass: true, gateway: "Pending" };
        if (p.card) { t.last4 = String(p.card.number).slice(-4); t.brand = /^4/.test(p.card.number) ? "visa" : /^(5061|5060|5078|6500)/.test(p.card.number) ? "verve" : /^3[47]/.test(p.card.number) ? "amex" : "mastercard"; }

        if (sc === "timeout") { succeed(t); persist(); await wait(latency); throw err("timeout", "Request timed out"); }

        if (ch === "card" || ch === "intl_card") {
          if (sc === "decline") { t.status = "failed"; t.gateway = "Insufficient Funds"; persist(); return ok(view(t), "Charge attempted"); }
          if (sc === "threeds") { t.autoPass = false; t.step = "3ds"; t.status = "pending"; persist(); return ok(view(t, { status: "open_url", url: "mock://3ds/" + t.reference, display_text: "Continue on your bank’s page" })); }
          if (sc === "challenge") {
            t.autoPass = false;
            if (ch === "intl_card") { t.step = "address"; persist(); return ok(view(t, { status: "send_address", display_text: "Enter your billing address" })); }
            t.step = "pin"; persist(); return ok(view(t, { status: "send_pin", display_text: "Enter your card PIN (test: 1234)" }));
          }
          return ok(view(succeed(t)), "Charge attempted");
        }
        if (ch === "apple_pay") return ok(view(succeed(t)));
        if (ch === "bank") {
          if (sc === "decline") { t.status = "failed"; t.gateway = "Declined"; persist(); return ok(view(t)); }
          if (sc === "challenge") { t.autoPass = false; t.step = "birthday"; persist(); return ok(view(t, { status: "send_birthday", display_text: "Enter your date of birth" })); }
          return ok(view(succeed(t)));
        }
        // offline channels
        if (sc === "decline") { t.status = "failed"; t.gateway = "Declined"; persist(); return ok(view(t)); }
        persist();
        return ok(Object.assign(view(t), pendingBits(t)), "Charge attempted");
      },

      async submit(kind, b) {
        await wait(latency);
        const t = txns[b && b.reference];
        if (!t) throw err("not_found", "Transaction reference not found");
        const wrong = (status, msg) => ({ status: false, message: msg, data: view(t, { status }) });
        if (kind === "pin") {
          if (t.step !== "pin") return wrong(stepStatus(t), "Unexpected step");
          if (String(b.pin) !== "1234") return wrong("send_pin", "Invalid PIN");
          t.step = "otp"; persist(); return ok(view(t, { status: "send_otp", display_text: "Enter the OTP sent to 080••••1234 (test: 123456)" }));
        }
        if (kind === "otp") {
          if (t.step !== "otp") return wrong(stepStatus(t), "Unexpected step");
          if (String(b.otp) !== "123456") return wrong("send_otp", "Invalid OTP");
          return ok(view(succeed(t)));
        }
        if (kind === "birthday") {
          if (t.step !== "birthday") return wrong(stepStatus(t), "Unexpected step");
          t.step = "otp"; persist(); return ok(view(t, { status: "send_otp", display_text: "Enter the OTP sent by your bank (test: 123456)" }));
        }
        if (kind === "address") {
          if (t.step !== "address") return wrong(stepStatus(t), "Unexpected step");
          t.step = "3ds"; persist(); return ok(view(t, { status: "open_url", url: "mock://3ds/" + t.reference, display_text: "Continue on your bank’s page" }));
        }
        if (kind === "phone") { t.step = "otp"; persist(); return ok(view(t, { status: "send_otp", display_text: "Enter the OTP (test: 123456)" })); }
        throw err("invalid", "Unknown step");
      },

      async check(ref) {                                   // GET /charge/:reference
        await wait(Math.min(latency, 350));
        const t = txns[ref]; if (!t) throw err("not_found", "Transaction reference not found");
        tick(t);
        return ok(view(t), "Charge attempted");
      },
      async verify(ref) {                                  // GET /transaction/verify/:reference
        await wait(Math.min(latency, 350));
        const t = txns[ref]; if (!t) throw err("not_found", "Transaction reference not found");
        tick(t);
        const st = t.status === "pending" ? "ongoing" : t.status;
        return { status: true, message: "Verification successful", data: Object.assign(view(t), { status: st }) };
      },

      // --- test helpers (the mock "bank page") ---
      approve3ds(ref, approve) {
        const t = txns[ref]; if (!t) return;
        if (approve) succeed(t); else { t.status = "failed"; t.gateway = "Declined by bank"; persist(); }
      },
      _txns: () => txns,
    };

    function stepStatus(t) { return t.step === "pin" ? "send_pin" : t.step === "otp" ? "send_otp" : t.step === "birthday" ? "send_birthday" : t.step === "address" ? "send_address" : "pending"; }

    // details the customer needs for offline channels
    function pendingBits(t) {
      if (t.status !== "pending") return {};
      if (t.step === "3ds") return { status: "open_url", url: "mock://3ds/" + t.reference };
      if (t.step && t.step !== "3ds") return { status: stepStatus(t) };
      if (t.channel === "bank_transfer") return { status: "pending", display_text: "Transfer the exact amount to the account below", account_number: t.acct || (t.acct = "99" + rnd(8)), account_name: "ETC – ENUGU TRANSIT CONTROL", bank: { name: "Wema Bank", slug: "wema-bank" }, account_expires_at: new Date(t.created + 30 * 60e3).toISOString() };
      if (t.channel === "ussd") return { status: "pay_offline", ussd_code: t.ussd || (t.ussd = "*737*000*" + rnd(5) + "#"), display_text: "Dial the code on your phone to complete the payment" };
      if (t.channel === "mobile_money") return { status: "pay_offline", display_text: "Approve the payment request on your wallet app" };
      if (t.channel === "qr") return { status: "pending", qr_payload: "ETCPAY|" + t.reference + "|" + t.amount, display_text: "Scan with your bank app" };
      return { status: "pending" };
    }
  }

  // ---------- real adapter skeleton (your backend, NOT Paystack directly) ----------
  function createHttp(base, headers) {
    const call = async (method, path, body) => {
      let res;
      try {
        res = await fetch(base + path, { method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: body ? JSON.stringify(body) : undefined });
      } catch (e) { throw err("network", e.message); }
      if (res.status >= 500) throw err("server", "Server error " + res.status);
      let j = null; try { j = await res.json(); } catch (_) {}
      if (res.status === 404) throw err("not_found", (j && j.message) || "Not found");
      if (res.status === 408 || res.status === 504) throw err("timeout", "Timed out");
      if (!j) throw err("server", "Bad response");
      return j;                                            // Paystack JSON: { status, message, data:{ status, … } }
    };
    return {
      charge: (p) => call("POST", "/charge", p),
      submit: (kind, b) => call("POST", "/charge/submit_" + kind, b),
      check: (ref) => call("GET", "/charge/" + encodeURIComponent(ref)),
      verify: (ref) => call("GET", "/transaction/verify/" + encodeURIComponent(ref)),
    };
  }

  return { createMock, createHttp, SCENARIOS };
});
