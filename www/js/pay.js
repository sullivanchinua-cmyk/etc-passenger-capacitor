// =========================================================
// Checkout sheet (custom UI over the Paystack Charge API – dummy backend for now)
//   ETC_Pay.open({ order:{id,amount,description,summary}, onSuccess(result)->Promise<{url}> })
// All logic is in pay-flow.js (state machine). This file only draws the current state and turns
// taps into flow events, so a redraw can never lose or double a payment.
// =========================================================
try {
  document.addEventListener("DOMContentLoaded", function () {
    try { document.body.style.overflow = ""; } catch (_) {}
  });
  window.addEventListener("pageshow", function () {
    try { document.body.style.overflow = ""; } catch (_) {}
  });
} catch (_) {}
// ETC pay overflow reset
window.ETC_Pay = (function () {
  const V = window.ETC_PayValidate, PF = window.ETC_PayFlow, PS = window.ETC_Paystack, UI = window.ETC_UI, I = window.ETC_ICONS;
  const TEST_MODE = true;                                   // ← set false when the real backend is connected (hides the test pill + hints)
  const esc = UI.esc;
  const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };

  const ICONS = Object.assign({}, I, {
    transfer: '<svg viewBox="0 0 24 24"><path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/></svg>',
    apple: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M9.2 12.2l2 2 3.6-3.9"/></svg>',
    debit: '<svg viewBox="0 0 24 24"><path d="M3 9.5L12 4l9 5.5M5.5 11v6M18.5 11v6M3 20.5h18M9 14h6"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    tick: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    bang: '<svg viewBox="0 0 24 24"><path d="M12 6v8M12 18.2h.01"/></svg>',
    clockb: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  });
  const icon = (n) => ICONS[n] || "";
  const METHOD_ICON = { card: "card", intl_card: "globe", transfer: "transfer", ussd: "dial", wallet: "wallet", qr: "qr", apple_pay: "apple", bank_debit: "debit" };

  // Stand-in for the Paystack wordmark (bars + name). Swap for the official asset from Paystack's brand kit before launch.
  const LOGO = '<span class="pay-logo"><svg viewBox="0 0 15 18" aria-hidden="true"><g fill="#00C3F7"><rect x="0" y="1" width="11" height="2.8" rx="1.4"/><rect x="0" y="5.6" width="15" height="2.8" rx="1.4"/><rect x="0" y="10.2" width="15" height="2.8" rx="1.4"/><rect x="0" y="14.8" width="7" height="2.4" rx="1.2"/></g></svg><b>paystack</b></span>';

  let active = null;                                        // only one sheet at a time

  function open(opts) {
    if (active) return active;
    const order = Object.assign({ email: ls.get("etc_pay_email") || "" }, opts.order);
    const ui = { ticket: null, sel: { ussd: "737", wallet: "opay" }, lastKey: "", pushed: false, ignorePop: false, auto: 0 };

    // ---- mock backend + flow ----
    const mock = PS.createMock({
      storage: (function () { try { return sessionStorage; } catch (_) { return null; } })(),
      scenario: () => ls.get("etc_pay_scenario") || "pass", latency: 750, passAfter: 5500,
    });
    const flow = PF.create({
      api: mock, storage: (function () { try { return localStorage; } catch (_) { return null; } })(),
      isHidden: () => document.hidden,
      onSuccess: async (result) => {
        ui.ticket = "working";
        try { render(); } catch (_) {}
        const ref = (result && result.reference) || "";
        const fallbackUrl = ref ? ("ticket.html?id=" + encodeURIComponent(ref + "-1")) : null;
        let r = null;
        try {
          r = await Promise.race([
            Promise.resolve().then(function () { return opts.onSuccess(result); }),
            new Promise(function (res) {
              setTimeout(function () { res({ url: fallbackUrl, timedOut: true }); }, 2500);
            }),
          ]);
        } catch (e) {
          console.warn("[ETC pay] ticket create", e);
          r = { url: fallbackUrl };
        }
        if (!r || !r.url) r = { url: fallbackUrl };
        ui.ticket = r.url ? r : { error: true };
        try { render(); } catch (_) {}
        if (r && r.url) {
          // Go to ticket right away (don't leave user on spinner)
          ui.auto = setTimeout(function () {
            try { if (active) location.href = r.url; } catch (_) {}
          }, 400);
        }
      },
    });
    flow.start();
    const m = flow.machine;

    // ---- shell ----
    const root = document.createElement("div");
    root.className = "pay"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Payment");
    root.innerHTML = `
      <div class="pay-sheet">
        <div class="pay-top">
          <button class="pay-circle" id="pBack" type="button" aria-label="Back"></button>
          <div class="pay-secure"><svg class="lk" viewBox="0 0 24 24">${icon("lock").replace(/<\/?svg[^>]*>/g, "")}</svg><span class="pay-secure-txt">Secured by</span>${LOGO}</div>
          <button class="pay-test" id="pTest" type="button" ${TEST_MODE ? "" : "hidden"}></button>
        </div>
        <div class="pay-hero" id="pHero"></div>
        <div id="pWarn"></div>
        <div class="pay-body" id="pBody"></div>
        <div class="pay-foot"><svg viewBox="0 0 24 24">${icon("shield").replace(/<\/?svg[^>]*>/g, "")}</svg>Encrypted · PCI DSS compliant · Payments by Paystack</div>
        <div class="pay-toast" id="pToast" role="status"></div>
      </div>`;
    document.body.appendChild(root);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => root.classList.add("show"));
    const $ = (s) => root.querySelector(s);
    const body = $("#pBody"), hero = $("#pHero"), warn = $("#pWarn"), backBtn = $("#pBack");

    function toast(t) { const el = $("#pToast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 1900); }
    const copy = async (text, label) => { try { await navigator.clipboard.writeText(text); toast((label || "Copied") + " ✓"); } catch (_) { toast("Press and hold to copy"); } };

    // ---------- pieces ----------
    const field = (id, label, o) => { o = o || {}; return `<label class="pf" data-f="${id}"><span>${esc(label)}</span><div class="wrap"><input id="${id}" type="${o.type || "text"}" ${o.mode ? `inputmode="${o.mode}"` : ""} ${o.ac ? `autocomplete="${o.ac}"` : 'autocomplete="off"'} placeholder="${esc(o.ph || "")}" ${o.max ? `maxlength="${o.max}"` : ""} value="${esc(o.val || "")}" />${o.brand ? '<em class="brand" id="brandTag"></em>' : ""}</div><div class="err"></div></label>`; };
    const state = () => m.state, ctx = () => m.context;
    const payLabel = () => `Pay ${naira(order.amount)}`;
    const dots = '<span class="spin" aria-hidden="true"></span>';

    function methodsHTML(c) {
      const applePay = TEST_MODE || (window.ApplePaySession && ApplePaySession.canMakePayments && ApplePaySession.canMakePayments());
      return `
        ${c.saved ? `<div class="pm-resume"><span>${icon("clock").replace("<svg", '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"')}</span><div>You have a payment that hasn’t been confirmed. Check it before paying again.</div><button type="button" data-a="resume">Check</button></div>` : ""}
        ${field("f_email", "Email for your receipt", { type: "email", mode: "email", ac: "email", ph: "you@example.com", val: c.order.email })}
        <p class="pay-h">Choose how to pay</p>
        ${flow.METHODS.filter((x) => x.id !== "apple_pay" || applePay).map((x) => `
          <button class="pm" type="button" data-a="pick" data-m="${x.id}">
            <span class="ic">${icon(METHOD_ICON[x.id])}</span><span><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></span>
            <svg class="go" viewBox="0 0 24 24">${ICONS.chev.replace(/<\/?svg[^>]*>/g, "")}</svg>
          </button>`).join("")}`;
    }

    function detailsHTML(c) {
      const i = c.input || {}, mth = c.method;
      const testChip = TEST_MODE ? `<button type="button" class="hint" data-a="testcard" style="cursor:pointer;background:rgba(250,204,21,.1)">Fill test details</button>` : "";
      if (mth === "card" || mth === "intl_card") {
        const intl = mth === "intl_card";
        return `<p class="pay-h">${intl ? "International card" : "Debit or credit card"}</p>
          <div class="pg">
            ${field("f_number", "Card number", { mode: "numeric", ac: "cc-number", ph: intl ? "Visa, Mastercard or Amex" : "Visa, Mastercard or Verve", max: 23, val: i.number ? V.formatCard(i.number) : "", brand: true })}
            <div class="pf-row">${field("f_expiry", "Expiry", { mode: "numeric", ac: "cc-exp", ph: "MM/YY", max: 5, val: i.expiry || "" })}${field("f_cvv", "CVV", { mode: "numeric", ac: "cc-csc", ph: "•••", max: 4, type: "password" })}</div>
            ${intl ? `<div class="pf-row"><label class="pf" data-f="f_country"><span>Billing country</span><select id="f_country">${["United States", "United Kingdom", "Canada", "Ghana", "South Africa", "United Arab Emirates", "Germany", "France", "Other"].map((n) => `<option ${i.country === n ? "selected" : ""}>${n}</option>`).join("")}</select><div class="err"></div></label>${field("f_postal", "Postal / ZIP", { ph: "10001", max: 10, val: i.postal || "" })}</div>` : ""}
          </div>
          <p class="pay-note">${intl ? "Your bank may ask you to confirm on a secure page (3-D Secure). " : ""}We never store your card details.</p>
          ${testChip}
          <button class="pay-btn" type="button" data-a="submit">${icon("lock").replace("<svg", '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"')}${payLabel()}</button>`;
      }
      if (mth === "transfer") return `<p class="pay-h">Bank transfer</p><div class="pg"><ol class="steps"><li>We give you a one-time account number.</li><li>Send exactly ${naira(order.amount)} from any bank app or USSD.</li><li>Your ticket is created the moment the money lands.</li></ol></div><button class="pay-btn" type="button" data-a="submit">Get account number</button>`;
      if (mth === "ussd") return `<p class="pay-h">Pick your bank</p><div class="po" id="ussdOpts">${flow.USSD_BANKS.map((b) => `<button type="button" data-a="ussd" data-v="${b.id}" class="${ui.sel.ussd === b.id ? "on" : ""}">${esc(b.bank)}<small>${esc(b.code)}</small></button>`).join("")}</div><p class="pay-note">We’ll show a code to dial on the phone linked to your account. No data needed.</p><button class="pay-btn" type="button" data-a="submit">Get USSD code</button>`;
      if (mth === "wallet") return `<p class="pay-h">Mobile money &amp; wallets</p><div class="po" id="walletOpts">${flow.WALLETS.map((w) => `<button type="button" data-a="wallet" data-v="${w.id}" class="${ui.sel.wallet === w.id ? "on" : ""}">${esc(w.name)}</button>`).join("")}</div>${field("f_phone", "Phone number on the wallet", { type: "tel", mode: "tel", ac: "tel", ph: "080 1234 5678", max: 17, val: i.phone || "" })}${TEST_MODE ? `<button type="button" class="hint" data-a="testcard" style="cursor:pointer">Fill test number</button>` : ""}<button class="pay-btn" type="button" data-a="submit">Send payment request</button>`;
      if (mth === "qr") return `<p class="pay-h">Scan to pay</p><div class="pg"><ol class="steps"><li>We show a QR code.</li><li>Open your bank or wallet app and choose <b>Scan to pay</b>.</li><li>Confirm ${naira(order.amount)} in the app.</li></ol></div><button class="pay-btn" type="button" data-a="submit">Show QR code</button>`;
      if (mth === "apple_pay") return `<p class="pay-h">Apple Pay</p><p class="pay-note">Double-click the side button or use Face ID to confirm. ${TEST_MODE ? "(Test mode: no real Apple Pay sheet – tap to simulate.)" : ""}</p><button class="pay-btn apple native" type="button" data-a="submit"> Pay with Apple Pay</button>`;
      if (mth === "bank_debit") return `<p class="pay-h">Direct bank debit</p><div class="pg"><label class="pf" data-f="f_bank"><span>Your bank</span><select id="f_bank"><option value="">Select bank</option>${flow.BANKS.map((b) => `<option value="${b.code}" ${i.bank === b.code ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select><div class="err"></div></label>${field("f_account", "Account number", { mode: "numeric", ph: "10 digits", max: 10, val: i.account || "" })}</div><p class="pay-note">Your bank will ask you to authorise this one-time debit of ${naira(order.amount)}.</p>${TEST_MODE ? `<button type="button" class="hint" data-a="testcard" style="cursor:pointer">Fill test account</button>` : ""}<button class="pay-btn" type="button" data-a="submit">Authorise debit</button>`;
      return "";
    }

    function challengeHTML(c) {
      const ch = c.challenge, hint = (t) => (TEST_MODE ? `<div style="text-align:center"><span class="hint">Test: ${t}</span></div>` : "");
      const err = ch.message ? `<p class="pay-note" style="color:#FCA5A5;font-weight:700;text-align:center">${esc(ch.message)}${ch.tries ? ` (${Math.max(0, 3 - ch.tries)} left)` : ""}</p>` : "";
      const head = (t, s) => `<div class="pay-state" style="padding-bottom:14px"><div class="orb"><i></i><i></i><i></i><span class="core">${icon("lock")}</span></div><h3>${t}</h3><p>${esc(s)}</p></div>`;
      let inner = "";
      if (ch.kind === "pin") inner = head("Enter your card PIN", ch.text || "Your 4-digit card PIN") + err + `<input class="otp pin" id="f_ans" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Card PIN" />` + hint("1234");
      else if (ch.kind === "otp") inner = head("Enter the code", ch.text || "We sent a one-time code to your phone") + err + `<input class="otp" id="f_ans" inputmode="numeric" maxlength="8" autocomplete="one-time-code" aria-label="One-time code" />` + hint("123456");
      else if (ch.kind === "phone") inner = head("Confirm your phone", ch.text || "Enter the phone number linked to your account") + err + field("f_ans", "Phone number", { type: "tel", mode: "tel", ph: "080 1234 5678", max: 17 });
      else if (ch.kind === "birthday") inner = head("Date of birth", ch.text || "Your bank needs this to confirm it’s you") + err + field("f_ans", "Date of birth", { type: "date" });
      else inner = head("Billing address", ch.text || "Enter the address your card statement goes to") + err + field("f_addr", "Address", { ph: "1 High Street", ac: "address-line1" }) + `<div class="pf-row">${field("f_city", "City", { ph: "London", ac: "address-level2" })}${field("f_state", "State", { ph: "LDN", ac: "address-level1" })}</div>` + field("f_zip", "Postal / ZIP", { ph: "E1 6AN", ac: "postal-code", max: 10, val: (c.input && c.input.postal) || "" });
      return inner + `<button class="pay-btn" type="button" data-a="answer">Continue</button>`;
    }

    function threedsHTML(c) {
      return `<div class="bankpage"><div class="bar">${icon("bank").replace("<svg", '<svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2"')} Your bank · Secure check</div>
        <div class="in"><b>Approve payment of ${naira(order.amount)}</b><br>to <b>ETC – Enugu Transit Control</b>. This page is your bank’s, not ours.${TEST_MODE ? '<br><span class="hint" style="color:#7A5B00;background:#FFF6D1">Test bank page</span>' : ""}</div></div>
        <button class="pay-btn" type="button" data-a="3ds-ok">Approve</button><button class="pay-btn ghost" type="button" data-a="3ds-no">Decline</button>`;
    }

    const cd = (t) => `<span class="timer" aria-live="off">${icon("clock")}<span data-countdown="${t}">--:--</span></span>`;
    function awaitingHTML(c) {
      const p = c.pending || {}, ref = c.reference;
      const poor = c.pollErrors >= 2 ? `<p class="pay-note" style="text-align:center;color:#FDE68A">Slow connection – still trying…</p>` : "";
      if (p.kind === "transfer") return `<p class="pay-h">Send ${naira(order.amount)} to</p>
          <div class="big-code"><div><div class="k">${esc(p.transfer.bank || "Bank")} · Account number</div><div class="v">${esc(p.transfer.account || "")}</div></div><button class="copy" type="button" data-a="copy" data-t="${esc(p.transfer.account || "")}" data-l="Account number copied">${icon("copy")}Copy</button></div>
          <div class="big-code"><div><div class="k">Account name</div><div class="v sm">${esc(p.transfer.name || "")}</div></div></div>
          <div class="big-code"><div><div class="k">Exact amount</div><div class="v sm">${naira(order.amount)}</div></div><button class="copy" type="button" data-a="copy" data-t="${order.amount}" data-l="Amount copied">${icon("copy")}Copy</button></div>
          <div style="text-align:center;margin-top:6px">${cd("exp")}</div>
          <div class="wait-line">${dots}Waiting for your transfer…</div>${poor}
          <button class="pay-btn" type="button" data-a="check">I’ve sent the money</button><p class="pay-note" style="text-align:center;margin-top:10px">Use this account once, for this booking only.</p>`;
      if (p.kind === "ussd") { const code = (p.ussd && p.ussd.code) || ""; return `<p class="pay-h">Dial this on your phone</p>
          <div class="big-code"><div><div class="k">${esc((p.ussd && p.ussd.bank) || "Bank")} USSD code</div><div class="v" style="font-size:22px">${esc(code)}</div></div><button class="copy" type="button" data-a="copy" data-t="${esc(code)}" data-l="Code copied">${icon("copy")}Copy</button></div>
          <a class="pay-btn white" style="text-decoration:none" href="tel:${encodeURIComponent(code)}">Dial now</a>
          <ol class="steps" style="margin-top:14px"><li>Dial the code from the phone linked to your bank account.</li><li>Follow the prompts and confirm ${naira(order.amount)}.</li><li>Come back here – we’ll update by ourselves.</li></ol>
          <div style="text-align:center">${cd("exp")}</div><div class="wait-line">${dots}Waiting for confirmation…</div>${poor}<button class="pay-btn ghost" type="button" data-a="check">I’ve completed it</button>`; }
      if (p.kind === "wallet") return `<div class="pay-state"><div class="orb"><i></i><i></i><i></i><span class="core">${icon("phone")}</span></div><h3>Check your ${esc((p.wallet && p.wallet.name) || "wallet")} app</h3><p>${esc(p.text || "Approve the payment request we just sent to")} ${p.wallet && p.wallet.phone ? `<b>${esc(p.wallet.phone)}</b>` : ""}.</p><div style="margin-top:16px">${cd("exp")}</div></div>${poor}<button class="pay-btn ghost" type="button" data-a="check">I’ve approved it</button>`;
      if (p.kind === "qr") return `<p class="pay-h" style="text-align:center">Scan with your bank app</p><div class="qr-box" id="qrBox" aria-label="Payment QR code"><div class="spin"></div></div><div style="text-align:center">${cd("exp")}</div><div class="wait-line">${dots}Waiting for your scan…</div>${poor}<button class="pay-btn ghost" type="button" data-a="check">I’ve paid</button>`;
      return processingHTML("Confirming your payment…", "This usually takes a few seconds.");
    }

    const processingHTML = (t, s) => `<div class="pay-state"><div class="orb"><i></i><i></i><i></i><span class="core"><span class="spin"></span></span></div><h3>${esc(t)}</h3><p>${esc(s)}</p><p class="sub">Please keep this screen open.</p></div>`;
    const statusHTML = (kind, ic, t, s, btns) => `<div class="pay-state"><div class="badge-ring ${kind}">${icon(ic)}</div><h3>${esc(t)}</h3><p>${esc(s)}</p></div>${btns}`;

    function successHTML(c) {
      const r = c.result || {}, tk = ui.ticket;
      const rows = [["Amount", naira(r.amount)], ["Reference", r.reference], ["Paid with", methodName(r.method) + (r.last4 ? ` ·· ${r.last4}` : "")], ["Time", new Date(r.paidAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })]];
      const cta = tk === "working" || !tk ? `<button class="pay-btn" type="button" disabled>${dots} Creating your ticket…</button>`
        : tk.error ? `<p class="pay-note" style="text-align:center;color:#FCA5A5">Payment is done, but we couldn’t create the ticket on this device. Your reference is above – contact support.</p>`
        : `<button class="pay-btn white" type="button" data-a="ticket">View my ticket &amp; QR</button><button class="pay-link" type="button" data-a="home">Back to home</button>`;
      return `<div class="pay-state"><div class="badge-ring ok">${icon("tick")}</div><h3>Payment successful</h3><p>Your ticket and receipt are ready. Show the live QR at the boarding gate.</p></div>
        <div class="pay-receipt pg">${rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>${cta}`;
    }
    const methodName = (id) => (flow.METHODS.find((x) => x.id === id) || {}).title || id || "";

    // ---------- render ----------
    const nokey = () => (state() === "success" ? "s" + (ui.ticket && ui.ticket.url ? 2 : ui.ticket ? 1 : 0) : "");
    function keyOf() {
      const c = ctx();
      return [state(), c.method, c.challenge && c.challenge.kind + ":" + c.challenge.tries, c.pending && c.pending.kind, c.error && c.error.code, c.saved ? "sv" : "", nokey()].join("|");
    }
    function chrome() {
      const s = state(), c = ctx();
      hero.innerHTML = `<div class="l">${esc(order.description || "ETC bus ticket")}</div><div class="amt">${naira(order.amount)}</div><div class="sum">${esc(order.summary || "")}</div>`;
      const showBack = s === "details", showClose = ["method", "challenge", "threeds", "awaiting", "unconfirmed", "failed", "fatal"].indexOf(s) >= 0;
      backBtn.hidden = !(showBack || showClose);
      backBtn.innerHTML = showBack ? icon("back") : icon("x");
      backBtn.setAttribute("aria-label", showBack ? "Back" : "Close");
      backBtn.dataset.a = showBack ? "back" : "close";
      const sc = ls.get("etc_pay_scenario") || "pass";
      $("#pTest").textContent = "TEST · " + ((PS.SCENARIOS.find((x) => x[0] === sc) || [])[1] || sc);
    }
    function full() {
      const s = state(), c = ctx();
      chrome();
      let html = "";
      switch (s) {
        case "method": html = methodsHTML(c); break;
        case "details": html = detailsHTML(c); break;
        case "submitting": html = processingHTML(c.answer || c.challenge ? "Verifying…" : c.method === "card" || c.method === "intl_card" ? "Charging your card…" : "Contacting your bank…", "This usually takes a few seconds."); break;
        case "verifying": html = processingHTML("Confirming your payment…", "We’re checking with the bank so you’re never charged twice."); break;
        case "challenge": html = challengeHTML(c); break;
        case "threeds": html = threedsHTML(c); break;
        case "awaiting": html = awaitingHTML(c); break;
        case "unconfirmed": html = statusHTML("wait", "clockb", "Still confirming", (c.error && c.error.message) || "", `<button class="pay-btn" type="button" data-a="verify">Check payment status</button><button class="pay-btn ghost" type="button" data-a="close">Close – we’ll keep it safe</button>`); break;
        case "failed": html = statusHTML("bad", "bang", "Payment didn’t go through", (c.error && c.error.message) || "", `${c.error && c.error.retryable ? `<button class="pay-btn" type="button" data-a="retry">Try again</button>` : ""}<button class="pay-btn ghost" type="button" data-a="change">Use another method</button><button class="pay-link" type="button" data-a="close">Cancel</button>`); break;
        case "success": html = successHTML(c); break;
        case "fatal": html = statusHTML("bad", "bang", "Something went wrong", "This screen hit a problem, but your payment wasn’t affected.", `${c.reference ? `<button class="pay-btn" type="button" data-a="verify">Check payment status</button>` : ""}<button class="pay-btn ghost" type="button" data-a="close">Close</button>`); break;
        default: html = "";
      }
      body.innerHTML = html; body.scrollTop = 0;
      warn.innerHTML = ctx().warn === "offline" ? `<div class="pay-offline">${icon("alert").replace("<svg", '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"')}You’re offline – we’ll carry on when you’re back.</div>` : "";
      if (s === "awaiting" && c.pending && c.pending.kind === "qr") drawQR(c.pending.qr.payload);
      if (s === "awaiting" || s === "challenge") { const f = body.querySelector("#f_ans, #f_addr"); if (f) setTimeout(() => { try { f.focus(); } catch (_) {} }, 350); }
      tickCountdown();
    }
    async function drawQR(text) {
      const box = body.querySelector("#qrBox"); if (!box) return;
      const Q = await window.ETC_LIB.load("qrcode");
      const live = body.querySelector("#qrBox"); if (!live || live !== box) return;
      if (!Q) { box.innerHTML = `<div style="color:#111;font:700 12px monospace;word-break:break-all;text-align:center">${esc(text)}</div>`; return; }
      box.innerHTML = ""; new Q(box, { text, width: 200, height: 200, correctLevel: Q.CorrectLevel.M });
    }
    function patch() {                                       // same screen, tiny changes (poll tick, offline banner)
      warn.innerHTML = ctx().warn === "offline" ? `<div class="pay-offline">${icon("alert").replace("<svg", '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"')}You’re offline – we’ll carry on when you’re back.</div>` : "";
    }
    function render() {
      if (!active) return;
      try {
        const k = keyOf();
        if (k === ui.lastKey) patch(); else { ui.lastKey = k; full(); }
      } catch (e) {
        try { body.innerHTML = `<div class="pay-state"><div class="badge-ring bad">${icon("bang")}</div><h3>Something went wrong</h3><p>Your payment wasn’t affected.</p></div><button class="pay-btn ghost" type="button" data-a="close">Close</button>`; } catch (_) {}
        throw e;                                             // → machine.onError → fatal state (verify/close stay available)
      }
    }
    const unsub = m.subscribe(render);

    // countdown text
    const tick = setInterval(tickCountdown, 1000);
    function tickCountdown() {
      const p = ctx().pending; if (!p) return;
      const left = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000));
      root.querySelectorAll("[data-countdown]").forEach((el) => { el.textContent = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0"); });
    }

    // ---------- input formatting ----------
    root.addEventListener("input", (e) => {
      const t = e.target, wrap = t.closest(".pf"); if (wrap) wrap.classList.remove("bad");
      if (t.id === "f_number") {
        t.value = V.formatCard(t.value);
        const b = V.brandOf(t.value), tag = root.querySelector("#brandTag");
        if (tag) { tag.classList.toggle("on", !!b); tag.textContent = b ? V.BRANDS[b].name.replace("American Express", "AMEX").toUpperCase() : ""; }
      } else if (t.id === "f_expiry") { t.value = V.formatExpiry(t.value, t.dataset.prev); t.dataset.prev = t.value; }
      else if (t.id === "f_email") { if (V.validEmail(t.value).ok) { order.email = t.value.trim(); ls.set("etc_pay_email", order.email); flow.setEmail(order.email); } }
      else if (t.id === "f_ans" && t.classList.contains("otp")) t.value = t.value.replace(/\D/g, "");
      else if (t.id === "f_cvv" || t.id === "f_account") t.value = t.value.replace(/\D/g, "");
    });

    function bad(id, msg) { const w = root.querySelector(`[data-f="${id}"]`); if (w) { w.classList.add("bad"); const e = w.querySelector(".err"); if (e) e.textContent = msg; } }
    const val = (id) => { const el = root.querySelector("#" + id); return el ? el.value : ""; };
    function focusFirstBad() { const w = root.querySelector(".pf.bad input, .pf.bad select"); if (w) w.focus(); }

    function collect(mth) {
      let ok = true, input = {}; const need = (id, r) => { if (!r.ok) { bad(id, r.msg); ok = false; } return r; };
      if (mth === "card" || mth === "intl_card") {
        const allowed = mth === "card" ? ["visa", "mastercard", "verve"] : ["visa", "mastercard", "amex"];
        const n = need("f_number", V.validCard(val("f_number"), allowed));
        need("f_expiry", V.validExpiry(val("f_expiry")));
        need("f_cvv", V.validCvv(val("f_cvv"), n.brand || V.brandOf(val("f_number"))));
        input = { number: val("f_number"), expiry: val("f_expiry"), cvv: val("f_cvv") };
        if (mth === "intl_card") { need("f_postal", V.validText(val("f_postal"), "your postal / ZIP code", 3)); input.country = val("f_country"); input.postal = val("f_postal"); }
      } else if (mth === "ussd") input = { bank: ui.sel.ussd };
      else if (mth === "wallet") { const r = need("f_phone", V.validPhoneNG(val("f_phone"))); input = { provider: ui.sel.wallet, phone: val("f_phone") }; }
      else if (mth === "bank_debit") { need("f_bank", val("f_bank") ? { ok: true } : { ok: false, msg: "Choose your bank" }); need("f_account", V.validAccount(val("f_account"))); input = { bank: val("f_bank"), account: val("f_account") }; }
      else if (mth === "apple_pay") input = { token: "mock_apple_pay_" + Date.now() };
      return { ok, input };
    }
    function collectAnswer(kind) {
      let r;
      if (kind === "pin") { r = V.validPin(val("f_ans")); if (!r.ok) return toast(r.msg), null; return val("f_ans"); }
      if (kind === "otp") { r = V.validOtp(val("f_ans")); if (!r.ok) return toast(r.msg), null; return val("f_ans"); }
      if (kind === "phone") { r = V.validPhoneNG(val("f_ans")); if (!r.ok) return bad("f_ans", r.msg), null; return val("f_ans"); }
      if (kind === "birthday") { r = V.validBirthday(val("f_ans")); if (!r.ok) return bad("f_ans", r.msg), null; return val("f_ans"); }
      const a = [["f_addr", V.validText(val("f_addr"), "your address", 4)], ["f_city", V.validText(val("f_city"), "your city")], ["f_state", V.validText(val("f_state"), "your state")], ["f_zip", V.validText(val("f_zip"), "your postal code", 3)]];
      let good = true; a.forEach(([id, x]) => { if (!x.ok) { bad(id, x.msg); good = false; } });
      return good ? { address: val("f_addr"), city: val("f_city"), state: val("f_state"), zipcode: val("f_zip") } : null;
    }

    // ---------- taps ----------
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]"); if (!b || b.disabled) return;
      const a = b.dataset.a, c = ctx();
      switch (a) {
        case "pick": { const r = V.validEmail(val("f_email") || c.order.email); if (!r.ok) { bad("f_email", r.msg); focusFirstBad(); return; } order.email = (val("f_email") || c.order.email).trim(); ls.set("etc_pay_email", order.email); flow.setEmail(order.email); flow.pick(b.dataset.m); break; }
        case "back": flow.back(); break;
        case "close": if (!requestClose()) toast("Payment in progress – please wait a moment"); break;
        case "submit": { const r = collect(c.method); if (!r.ok) { focusFirstBad(); return; } flow.submit(r.input); break; }
        case "ussd": ui.sel.ussd = b.dataset.v; root.querySelectorAll("#ussdOpts button").forEach((x) => x.classList.toggle("on", x === b)); break;
        case "wallet": ui.sel.wallet = b.dataset.v; root.querySelectorAll("#walletOpts button").forEach((x) => x.classList.toggle("on", x === b)); break;
        case "answer": { const v = collectAnswer(c.challenge.kind); if (v) flow.answer(v); break; }
        case "3ds-ok": mock.approve3ds(c.reference, true); flow.threeDS(true); break;
        case "3ds-no": mock.approve3ds(c.reference, false); flow.threeDS(true); break;
        case "check": flow.checkNow(); toast("Checking…"); break;
        case "verify": flow.verify(); break;
        case "resume": flow.resume(); break;
        case "retry": flow.retry(); break;
        case "change": flow.changeMethod(); break;
        case "copy": copy(b.dataset.t, b.dataset.l); break;
        case "ticket": clearTimeout(ui.auto); if (ui.ticket && ui.ticket.url) location.href = ui.ticket.url; break;
        case "home": clearTimeout(ui.auto); location.href = "index.html"; break;
        case "testcard": fillTest(c.method); break;
      }
    });
    function fillTest(mth) {
      const set = (id, v) => { const el = root.querySelector("#" + id); if (el) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };
      if (mth === "card" || mth === "intl_card") { set("f_number", "4084 0840 8408 4081"); set("f_expiry", "12/40"); set("f_cvv", "408"); if (mth === "intl_card") { set("f_postal", "10001"); } }
      if (mth === "wallet") set("f_phone", "08031234567");
      if (mth === "bank_debit") { set("f_bank", "058"); set("f_account", "0123456789"); }
    }
    $("#pTest").addEventListener("click", () => {
      const list = PS.SCENARIOS.map((x) => x[0]), cur = ls.get("etc_pay_scenario") || "pass";
      ls.set("etc_pay_scenario", list[(list.indexOf(cur) + 1) % list.length]); chrome();
      toast("Test scenario: " + ((PS.SCENARIOS.find((x) => x[0] === ls.get("etc_pay_scenario")) || [])[1]));
    });
    root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { const btn = body.querySelector(".pay-btn[data-a='submit'], .pay-btn[data-a='answer']"); if (btn) { e.preventDefault(); btn.click(); } } });

    // ---------- lifecycle ----------
    function requestClose() {
      const s = state();
      if (s === "success") { flow.done(); teardown(true); return true; }
      const ok = flow.close(); if (ok) teardown(true); return ok;
    }
    function teardown(pop) {
      if (!active) return;
      active = null; clearInterval(tick); clearTimeout(ui.auto); unsub();
      window.removeEventListener("online", on); window.removeEventListener("offline", off); document.removeEventListener("visibilitychange", vis); window.removeEventListener("popstate", pop_);
      flow.destroy(); root.classList.remove("show"); document.body.style.overflow = "";
      setTimeout(() => root.remove(), 260);
      if (pop && ui.pushed) { ui.ignorePop = true; history.back(); }
      if (opts.onClose) opts.onClose();
    }
    const on = () => flow.setOnline(true), off = () => flow.setOnline(false), vis = () => { if (!document.hidden) flow.onVisible(); };
    const pop_ = () => { if (ui.ignorePop) { ui.ignorePop = false; return; } ui.pushed = false; if (!requestCloseFromPop()) { history.pushState({ etcPay: 1 }, ""); ui.pushed = true; toast("Payment in progress – please wait"); } };
    function requestCloseFromPop() { const s = state(); if (s === "success") { flow.done(); teardown(false); return true; } const ok = flow.close(); if (ok) teardown(false); return ok; }
    window.addEventListener("online", on); window.addEventListener("offline", off); document.addEventListener("visibilitychange", vis); window.addEventListener("popstate", pop_);
    try { history.pushState({ etcPay: 1 }, ""); ui.pushed = true; } catch (_) {}
    if (navigator.onLine === false) flow.setOnline(false);

    active = { close: requestClose, flow };
    flow.open(order);
    return active;
  }
  return { open };
})();
