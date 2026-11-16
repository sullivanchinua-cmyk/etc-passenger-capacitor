// =========================================================
// Payment flow = state machine + side effects.
//
// The UI never talks to Paystack. It only:
//   • calls flow.open / pick / submit / answer / retry …   (user intent)
//   • renders from flow.machine.state + flow.machine.context
// Everything risky (network, timers, polling, reloads) lives here, so a
// screen can be thrown away and redrawn at any moment without breaking a payment.
//
// STATES
//   idle → method → details → submitting ─┬→ success            (final)
//                                         ├→ challenge (PIN / OTP / phone / birthday / address) → submitting
//                                         ├→ threeds  (bank page) → verifying
//                                         ├→ awaiting (transfer / USSD / wallet / QR; polls)
//                                         ├→ failed   (retry / change method)
//                                         └→ unconfirmed (timeout: verify BEFORE any retry)
//   verifying → success | failed | unconfirmed        fatal (error boundary → verify or close)
//
// DESIGN RULES (from Paystack's Charge docs + payment-integration best practice)
//   1. One `reference` per payment attempt = the idempotency key.
//        network error / timeout  → SAME reference (never a second charge)
//        declined / failed        → NEW reference
//   2. Only the server says "paid". The client trusts `success` from api.charge/check/verify,
//      and after any doubt (timeout, reload, coming back from a bank app) it VERIFIES first.
//   3. Stale answers are dropped: every async job carries a run-id; leaving a state bumps it.
//   4. Unknown statuses are treated as "still pending", never as failure.
//   5. Card data lives in memory only – never in storage, never in the transition history.
//   6. Polling backs off, pauses when offline / tab hidden, and has a hard expiry per method.
//   7. onSuccess fires once per flow (ctx.finalized) and ticket issuance is idempotent by reference.
// =========================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./machine.js"), require("./pay-validate.js"));
  else root.ETC_PayFlow = factory(root.ETC_Machine, root.ETC_PayValidate);
})(typeof self !== "undefined" ? self : this, function (Machine, V) {

  // ---------- catalogue (UI reads these) ----------
  const METHODS = [
    { id: "card",       title: "Debit or credit card", sub: "Visa · Mastercard · Verve",              icon: "card" },
    { id: "intl_card",  title: "International card",   sub: "Visa · Mastercard · American Express",   icon: "globe" },
    { id: "transfer",   title: "Bank transfer",        sub: "Pay into a one-time account number",     icon: "bank" },
    { id: "ussd",       title: "USSD",                 sub: "*737# · *894# · *966# and more",          icon: "dial" },
    { id: "wallet",     title: "Mobile money & wallets", sub: "OPay · PalmPay · MTN MoMo",            icon: "wallet" },
    { id: "qr",         title: "QR code",              sub: "Scan to pay with your bank app",         icon: "qr" },
    { id: "apple_pay",  title: "Apple Pay",            sub: "Pay with Face ID or Touch ID",           icon: "apple" },
    { id: "bank_debit", title: "Direct bank debit",    sub: "Authorise a debit from your account",    icon: "debit" },
  ];
  // Paystack's Charge API lists USSD types 737 (GTBank), 919 (UBA), 822 (Sterling), 966 (Zenith).
  // *894# (First Bank) and *901# (Access) are shown for the demo only – set live:false-safe by `paystack:false`.
  const USSD_BANKS = [
    { id: "737", bank: "GTBank",      code: "*737#", paystack: true },
    { id: "894", bank: "First Bank",  code: "*894#", paystack: false },
    { id: "966", bank: "Zenith Bank", code: "*966#", paystack: true },
    { id: "919", bank: "UBA",         code: "*919#", paystack: true },
    { id: "822", bank: "Sterling",    code: "*822#", paystack: true },
    { id: "901", bank: "Access Bank", code: "*901#", paystack: false },
  ];
  const WALLETS = [
    { id: "opay",     name: "OPay" },
    { id: "palmpay",  name: "PalmPay" },
    { id: "mtn_momo", name: "MTN MoMo" },
    { id: "moniepoint", name: "Moniepoint" },
  ];
  const BANKS = [
    ["044", "Access Bank"], ["058", "GTBank"], ["057", "Zenith Bank"], ["033", "UBA"], ["011", "First Bank"],
    ["214", "FCMB"], ["070", "Fidelity Bank"], ["232", "Sterling Bank"], ["221", "Stanbic IBTC"], ["032", "Union Bank"],
    ["035", "Wema Bank"], ["076", "Polaris Bank"], ["50211", "Kuda"], ["999992", "OPay"], ["999991", "PalmPay"], ["50515", "Moniepoint"],
  ].map(([code, name]) => ({ code, name }));

  const CFG = {
    submitTimeoutMs: 30000,
    challengeTtlMs: 5 * 60e3,
    threedsTtlMs: 10 * 60e3,
    verifyTimeoutMs: 45000,
    verifyDelays: [0, 2500, 4500],
    ttl: { transfer: 30 * 60e3, ussd: 15 * 60e3, wallet: 4 * 60e3, qr: 5 * 60e3, processing: 3 * 60e3 },
    pollDelays: [2500, 3000, 4000, 5000, 6000],
    maxPollErrors: 6,
    maxChallengeTries: 3,
    sessionMaxAgeMs: 45 * 60e3,
  };

  const SESSION_KEY = "etc_pay_session";
  const memStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
  const BUSY = ["submitting", "verifying", "threeds", "challenge", "awaiting"];

  function friendly(msg) {
    const m = String(msg || "").toLowerCase();
    if (/insufficient/.test(m)) return "Your account doesn’t have enough money for this payment.";
    if (/declin|do not honou?r|not permitted/.test(m)) return "The bank declined this payment. Try another card or method.";
    if (/expired/.test(m)) return "This attempt expired. Start again.";
    if (/invalid|incorrect|wrong/.test(m)) return "Some details didn’t match. Check them and try again.";
    if (/limit/.test(m)) return "This payment is above your card limit.";
    return msg ? String(msg) : "The payment didn’t go through.";
  }

  function newReference(now) {
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return "ETC-" + (now || Date.now()).toString(36).toUpperCase() + "-" + rnd;      // alphanumeric + "-" only (Paystack rule)
  }

  // ---------- Paystack payload for each method ----------
  function buildCharge(ctx) {
    const i = ctx.input || {}, o = ctx.order;
    const p = { email: o.email, amount: Math.round(o.amount * 100), reference: ctx.reference, currency: "NGN",
                metadata: { order_id: o.id, app: "etc-passenger", description: o.description || "" } };
    switch (ctx.method) {
      case "card": case "intl_card": {
        const e = V.validExpiry(i.expiry);
        p.card = { number: V.digits(i.number), cvv: V.digits(i.cvv), expiry_month: e.month, expiry_year: e.year };
        if (ctx.method === "intl_card") p.metadata.billing = { country: i.country, postal_code: i.postal };
        break;
      }
      case "transfer":   p.bank_transfer = { account_expires_at: new Date(Date.now() + CFG.ttl.transfer).toISOString() }; break;
      case "ussd":       p.ussd = { type: i.bank }; break;
      case "wallet":     p.mobile_money = { phone: V.normPhoneNG(i.phone), provider: i.provider }; break;
      case "qr":         p.qr = { provider: "visa" }; break;
      case "apple_pay":  p.apple_pay = { token: i.token || "" }; break;
      case "bank_debit": p.bank = { code: i.bank, account_number: V.digits(i.account) }; break;
    }
    return p;
  }

  function create(deps) {
    const api = deps.api;
    const storage = deps.storage || memStorage();
    const timers = deps.timers || { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) };
    const now = deps.now || (() => Date.now());
    const cfg = Object.assign({}, CFG, deps.config || {});
    if (deps.config && deps.config.ttl) cfg.ttl = Object.assign({}, CFG.ttl, deps.config.ttl);
    const hidden = deps.isHidden || (() => false);
    const onSuccess = deps.onSuccess || (() => {});
    const onEvent = deps.onEvent || (() => {});

    let run = 0, pollTimer = null;
    const bump = () => { run++; stopPoll(); };
    function stopPoll() { if (pollTimer) { timers.clear(pollTimer); pollTimer = null; } }

    // ---------- persistence (no card data, ever) ----------
    const save = (ctx, st) => { try { storage.setItem(SESSION_KEY, JSON.stringify({ v: 1, ref: ctx.reference, method: ctx.method, orderId: ctx.order.id, amount: ctx.order.amount, email: ctx.order.email, state: st, at: now() })); } catch (_) {} };
    const clearSaved = () => { try { storage.removeItem(SESSION_KEY); } catch (_) {} };
    function loadSaved(orderId) {
      try {
        const s = JSON.parse(storage.getItem(SESSION_KEY));
        if (!s || s.v !== 1 || !s.ref) return null;
        if (now() - s.at > cfg.sessionMaxAgeMs) { clearSaved(); return null; }
        if (orderId && s.orderId !== orderId) return null;
        return s;
      } catch (_) { return null; }
    }

    // ---------- async helper: result is dropped if the state changed meanwhile ----------
    function job(fn, ok, bad) {
      const my = run;
      Promise.resolve().then(fn).then(
        (r) => { if (my === run) ok(r); },
        (e) => { if (my === run) (bad || onError)(e); }
      );
    }
    function onError(e) {
      const kind = (e && e.kind) || "network";
      if (kind === "timeout") return machine.send("TIMEOUT");
      if (kind === "network" || kind === "server") return machine.send("R_NETWORK", { message: e && e.message });
      return machine.send("R_FAILED", { message: e && e.message, code: kind });
    }

    // ---------- route a Paystack-shaped response into an event ----------
    function route(res) {
      const d = (res && res.data) || {}, st = d.status;
      switch (st) {
        case "success": return machine.send("R_SUCCESS", { data: d });
        case "send_pin": case "send_otp": case "send_phone": case "send_birthday": case "send_address":
          return machine.send("R_CHALLENGE", { kind: st.slice(5), text: d.display_text, message: res.status === false ? res.message : null });
        case "open_url": return machine.send("R_3DS", { url: d.url, text: d.display_text });
        case "pay_offline": case "pending": case "ongoing": case "queued": return machine.send("R_WAIT", { data: d });
        case "failed": case "abandoned": case "reversed": case "timeout":
          return machine.send("R_FAILED", { message: d.gateway_response || res.message, code: st });
        default: // unknown status → keep waiting and let verify decide; never guess "failed"
          return res && res.status === false && !st ? machine.send("R_FAILED", { message: res.message, code: "rejected" }) : machine.send("R_WAIT", { data: d, unknown: st });
      }
    }

    // ---------- polling (awaiting) ----------
    function poll(my, i, delayOverride) {
      stopPoll();
      const base = cfg.pollDelays[Math.min(i, cfg.pollDelays.length - 1)];
      const delay = delayOverride != null ? delayOverride : Math.round(base * (0.9 + Math.random() * 0.2));
      pollTimer = timers.set(() => {
        pollTimer = null;
        if (my !== run) return;
        const c = machine.context;
        if (!c.online || hidden()) return poll(my, i, 1500);                // paused – look again shortly, don't burn attempts
        Promise.resolve().then(() => api.check(c.reference)).then((res) => {
          if (my !== run) return;
          c.pollErrors = 0;
          const st = res && res.data && res.data.status;
          if (st === "success") return machine.send("POLL_OK", { data: res.data });
          if (st === "failed" || st === "abandoned" || st === "reversed") return machine.send("POLL_FAIL", { message: res.data.gateway_response, code: st });
          c.pollCount = (c.pollCount || 0) + 1; machine.send("TICK");
          poll(my, i + 1);
        }, (e) => {
          if (my !== run) return;
          c.pollErrors = (c.pollErrors || 0) + 1;
          if (c.pollErrors >= cfg.maxPollErrors) return machine.send("POLL_STALL");
          machine.send("TICK"); poll(my, i + 1);
        });
      }, delay);
    }

    // ---------- verify (after doubt) ----------
    function runVerify(my, ctx) {
      const tries = cfg.verifyDelays.slice();
      (function attempt(k) {
        if (my !== run) return;
        timers.set(() => {
          if (my !== run) return;
          Promise.resolve().then(() => api.verify(ctx.reference)).then((res) => {
            if (my !== run) return;
            const st = res && res.data && res.data.status;
            if (st === "success") return machine.send("V_SUCCESS", { data: res.data });
            if (st === "failed" || st === "abandoned" || st === "reversed") return machine.send("V_FAILED", { message: res.data.gateway_response, code: st });
            if (k + 1 < tries.length) return attempt(k + 1);
            machine.send("V_PENDING", { data: res.data });
          }, (e) => {
            if (my !== run) return;
            if (e && e.kind === "not_found") return machine.send("V_FAILED", { message: "No payment was made for this attempt.", code: "not_found", noCharge: true });
            if (k + 1 < tries.length) return attempt(k + 1);
            machine.send("V_PENDING", {});
          });
        }, tries[k]);
      })(0);
    }

    // ---------- pending details per method ----------
    function pendingFor(ctx, d) {
      const i = ctx.input || {}, m = ctx.method;
      const kind = m === "transfer" ? "transfer" : m === "ussd" ? "ussd" : m === "wallet" ? "wallet" : m === "qr" ? "qr" : "processing";
      const ttl = cfg.ttl[kind] || cfg.ttl.processing;
      const p = { kind, text: d.display_text || "", expiresAt: d.account_expires_at ? Math.min(Date.parse(d.account_expires_at) || Infinity, now() + ttl) : now() + ttl, startedAt: now() };
      if (kind === "transfer") p.transfer = { account: d.account_number, name: d.account_name, bank: d.bank && d.bank.name, amount: ctx.order.amount };
      if (kind === "ussd") { p.ussd = { code: d.ussd_code, bank: (USSD_BANKS.find((b) => b.id === i.bank) || {}).bank }; }
      if (kind === "wallet") p.wallet = { name: (WALLETS.find((w) => w.id === i.provider) || {}).name, phone: V.normPhoneNG(i.phone) };
      if (kind === "qr") p.qr = { payload: d.qr_payload || d.url || ctx.reference };
      return p;
    }

    const S = (o) => Object.assign({ exit: bump }, o);
    const resetPayment = (c) => { c.reference = null; c.error = null; c.challenge = null; c.pending = null; c.result = null; c.pollCount = 0; c.pollErrors = 0; c.warn = null; };

    const machine = Machine.create({
      id: "pay", initial: "idle",
      context: { order: null, reference: null, method: null, input: null, challenge: null, pending: null, error: null, result: null,
                 online: true, pollCount: 0, pollErrors: 0, finalized: false, warn: null, saved: null },
      on: {
        FATAL:   { target: "fatal", action: (c, p) => { c.error = { code: "fatal", message: "Something went wrong on this screen. Your payment was not affected.", retryable: false }; c.fatalMsg = p && p.message; } },
        OFFLINE: { action: (c) => { c.online = false; c.warn = "offline"; } },
        ONLINE:  { action: (c) => { c.online = true; c.warn = null; } },
      },
      states: {
        idle: S({
          on: {
            OPEN: { target: "method", action: (c, p) => { resetPayment(c); c.order = p.order; c.method = null; c.input = null; c.finalized = false; c.saved = loadSaved(p.order.id); } },
          },
        }),

        method: S({
          on: {
            PICK:   { target: "details", guard: (c, p) => METHODS.some((m) => m.id === p.method), action: (c, p) => { if (c.method !== p.method) c.input = null; c.method = p.method; c.error = null; } },
            RESUME: { target: "verifying", guard: (c) => !!c.saved, action: (c) => { c.reference = c.saved.ref; c.method = c.saved.method; c.order.email = c.order.email || c.saved.email; } },
            SET_EMAIL: { action: (c, p) => { c.order.email = p.email; } },
            CLOSE:  { target: "idle", action: (c) => { c.input = null; } },
          },
        }),

        details: S({
          on: {
            SUBMIT: { target: "submitting", guard: (c, p) => !!(p && p.input), action: (c, p) => { c.input = p.input; c.error = null; if (!c.reference) c.reference = newReference(now()); } },
            SET_EMAIL: { action: (c, p) => { c.order.email = p.email; } },
            BACK:   { target: "method" },
            CLOSE:  { target: "idle", action: (c) => { c.input = null; } },
          },
        }),

        submitting: S({
          entry: (c) => {
            save(c, "submitting");
            const step = c.answer; c.answer = null;
            onEvent("submitting", { method: c.method, step: step ? step.kind : "charge" });
            job(() => (step ? api.submit(step.kind, Object.assign({ reference: c.reference }, step.body)) : api.charge(buildCharge(c))), route);
          },
          after: [{ ms: cfg.submitTimeoutMs, event: "TIMEOUT" }],
          on: {
            R_SUCCESS:   { target: "success", action: (c, p) => finish(c, p.data) },
            R_CHALLENGE: [
              { target: "failed", guard: (c, p) => c.challenge && c.challenge.kind === p.kind && c.challenge.tries >= cfg.maxChallengeTries - 1,
                action: (c) => { c.error = { code: "too_many", message: "Too many wrong attempts. Start a new payment.", retryable: true, fresh: true }; clearSaved(); } },
              { target: "challenge", action: (c, p) => { const same = c.challenge && c.challenge.kind === p.kind; c.challenge = { kind: p.kind, text: p.text, message: p.message ? friendly(p.message) : null, tries: same && p.message ? c.challenge.tries + 1 : 0, at: now() }; } },
            ],
            R_3DS:  { target: "threeds", action: (c, p) => { c.pending = { kind: "3ds", url: p.url, text: p.text, expiresAt: now() + cfg.threedsTtlMs }; } },
            R_WAIT: { target: "awaiting", action: (c, p) => { c.pending = pendingFor(c, p.data || {}); c.pollCount = 0; c.pollErrors = 0; } },
            R_FAILED:  { target: "failed", action: (c, p) => { c.error = { code: p.code || "failed", message: friendly(p.message), retryable: true, fresh: true }; clearSaved(); } },
            R_NETWORK: { target: "failed", action: (c) => { c.error = { code: "network", message: "We lost the connection. You have not been charged twice – tap Try again and we’ll pick up where we stopped.", retryable: true, fresh: false }; } },
            TIMEOUT:   { target: "unconfirmed", action: (c) => { c.error = { code: "timeout", message: "The bank hasn’t answered yet. Don’t pay again – check the status first." }; } },
          },
        }),

        challenge: S({
          entry: (c) => { save(c, "challenge"); },
          after: [{ ms: cfg.challengeTtlMs, event: "EXPIRED" }],
          on: {
            ANSWER: { target: "submitting", guard: (c, p) => !!(p && p.value), action: (c, p) => {
              const k = c.challenge.kind;
              const body = k === "pin" ? { pin: p.value } : k === "otp" ? { otp: p.value } : k === "phone" ? { phone: V.normPhoneNG(p.value) } : k === "birthday" ? { birthday: p.value } : { address: p.value.address, city: p.value.city, state: p.value.state, zipcode: p.value.zipcode };
              c.answer = { kind: k, body };
            } },
            EXPIRED: { target: "failed", action: (c) => { c.error = { code: "expired", message: "This step timed out. Start again.", retryable: true, fresh: true }; clearSaved(); } },
            CLOSE:   { target: "idle", action: (c) => { c.input = null; } },            // session stays saved → "Check status" next time
          },
        }),

        threeds: S({
          entry: (c) => { save(c, "threeds"); },
          after: [{ ms: cfg.threedsTtlMs, event: "TIMEOUT" }],
          on: {
            R_3DS_DONE:   { target: "verifying" },
            R_3DS_CANCEL: { target: "failed", action: (c) => { c.error = { code: "cancelled", message: "You cancelled the bank check. No money was taken.", retryable: true, fresh: true }; clearSaved(); } },
            TIMEOUT:      { target: "unconfirmed", action: (c) => { c.error = { code: "timeout", message: "We didn’t hear back from your bank. Check the status before trying again." }; } },
            CLOSE:        { target: "idle", action: (c) => { c.input = null; } },
          },
        }),

        awaiting: S({
          entry: (c) => { save(c, "awaiting"); poll(run, 0, 900); },
          after: [{ ms: (c) => Math.max(0, (c.pending ? c.pending.expiresAt : now() + cfg.ttl.processing) - now()), event: "EXPIRED" }],
          on: {
            TICK:      { action: () => {} },
            CHECK_NOW: { action: () => { poll(run, 0, 0); } },
            POLL_OK:   { target: "success", action: (c, p) => finish(c, p.data) },
            POLL_FAIL: { target: "failed", action: (c, p) => { c.error = { code: p.code || "failed", message: friendly(p.message), retryable: true, fresh: true }; clearSaved(); } },
            POLL_STALL:{ target: "unconfirmed", action: (c) => { c.error = { code: "stalled", message: "We can’t reach the payment server right now. If you already paid, don’t pay again – check the status in a moment." }; } },
            EXPIRED:   { target: "verifying", action: (c) => { c.expiring = true; } },    // one last look before giving up
            CLOSE:     { target: "idle", action: (c) => { c.input = null; } },
          },
        }),

        verifying: S({
          entry: (c) => { save(c, "verifying"); runVerify(run, c); },
          after: [{ ms: cfg.verifyTimeoutMs, event: "TIMEOUT" }],
          on: {
            V_SUCCESS: { target: "success", action: (c, p) => finish(c, p.data) },
            V_FAILED:  { target: "failed", action: (c, p) => { c.error = { code: p.code || "failed", message: friendly(p.message), retryable: true, fresh: true }; c.expiring = false; clearSaved(); } },
            V_PENDING: [
              { target: "failed", guard: (c) => c.expiring, action: (c) => { c.expiring = false; c.error = { code: "expired", message: "This payment window has closed. If you already paid, it will show up in a few minutes.", retryable: true, fresh: true }; clearSaved(); } },
              { target: "unconfirmed", action: (c) => { c.error = { code: "pending", message: "Your payment is still being confirmed. Don’t pay again." }; } },
            ],
            TIMEOUT:   { target: "unconfirmed", action: (c) => { c.error = { code: "timeout", message: "The payment server is slow to answer. Don’t pay again – check again in a moment." }; } },
          },
        }),

        unconfirmed: S({
          entry: (c) => { save(c, "unconfirmed"); },
          on: {
            VERIFY: { target: "verifying" },
            CLOSE:  { target: "idle", action: (c) => { c.input = null; } },
          },
        }),

        failed: S({
          on: {
            RETRY: [
              { target: "submitting", guard: (c) => c.error && c.error.retryable && c.error.fresh === false && !!c.input },   // same reference, same details
              { target: "details",    guard: (c) => c.error && c.error.retryable, action: (c) => { if (c.error.fresh !== false) c.reference = null; c.error = null; c.pending = null; c.challenge = null; } },
            ],
            CHANGE_METHOD: { target: "method", action: (c) => { c.reference = null; c.error = null; c.pending = null; c.challenge = null; c.saved = null; } },
            CLOSE: { target: "idle", action: (c) => { c.input = null; } },
          },
        }),

        success: S({
          entry: (c) => { clearSaved(); c.input = null; },
          on: { DONE: { target: "idle" }, CLOSE: { target: "idle" } },
        }),

        fatal: S({
          on: {
            VERIFY: { target: "verifying", guard: (c) => !!c.reference },
            CLOSE:  { target: "idle", action: (c) => { c.input = null; } },
          },
        }),
      },
      onError: (e, where) => { if (/^(entry|action|subscriber)/.test(where) && machine.state !== "fatal") setTimeout(() => machine.send("FATAL", { message: String(e && e.message || e) }), 0); },
    }, { timers });

    // success → result (once)
    function finish(c, d) {
      const a = (d && d.authorization) || {};
      c.result = { reference: c.reference, amount: c.order.amount, method: c.method, channel: (d && d.channel) || c.method,
                   paidAt: (d && d.paid_at) || new Date(now()).toISOString(), gateway: (d && d.gateway_response) || "Successful",
                   brand: a.brand || a.card_type || null, last4: a.last4 || null, bank: a.bank || null, email: c.order.email };
      if (!c.finalized) {
        c.finalized = true;
        setTimeout(() => { try { onSuccess(c.result); } catch (e) { machine.send("FATAL", { message: String(e && e.message || e) }); } }, 0);
      }
    }

    const flow = {
      machine,
      METHODS, USSD_BANKS, WALLETS, BANKS, cfg,
      start: () => machine.start(),
      open: (order) => machine.send("OPEN", { order }),
      close: () => machine.send("CLOSE"),
      pick: (method) => machine.send("PICK", { method }),
      back: () => machine.send("BACK"),
      setEmail: (email) => machine.send("SET_EMAIL", { email }),
      submit: (input) => machine.send("SUBMIT", { input }),
      answer: (value) => machine.send("ANSWER", { value }),
      retry: () => machine.send("RETRY"),
      changeMethod: () => machine.send("CHANGE_METHOD"),
      verify: () => machine.send("VERIFY"),
      resume: () => machine.send("RESUME"),
      checkNow: () => machine.send("CHECK_NOW"),
      threeDS: (ok) => machine.send(ok ? "R_3DS_DONE" : "R_3DS_CANCEL"),
      done: () => machine.send("DONE"),
      setOnline: (on) => { machine.send(on ? "ONLINE" : "OFFLINE"); if (on) machine.send("CHECK_NOW"); },
      onVisible: () => { if (machine.matches("awaiting")) machine.send("CHECK_NOW"); },
      isBusy: () => BUSY.indexOf(machine.state) >= 0,
      destroy: () => { bump(); machine.stop(); },
    };
    return flow;
  }

  return { create, METHODS, USSD_BANKS, WALLETS, BANKS, CFG, buildCharge, newReference, friendly, SESSION_KEY };
});
