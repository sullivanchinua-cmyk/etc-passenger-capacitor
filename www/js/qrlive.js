// Live QR helper: draws a ticket's 30-second token with qrcode.js and re-draws it
// the moment the window changes. Stops rotating when ticket is USED/boarded.
window.ETC_QRLive = (function () {
  const T = window.ETC_Tokens;
  const items = new Set();
  let timer = 0;

  function isUsed(ticket) {
    const st = String((ticket && ticket.status) || "").toLowerCase();
    return st === "boarded" || st === "used" || st === "void" || st === "noshow";
  }

  async function paint(it) {
    if (!it.el || !it.el.isConnected) return;
    const used = isUsed(it.ticket);
    // Freeze payload for used tickets (static code + stamp overlay handled by parent)
    const ticket = it.groupBoard ? Object.assign({}, it.ticket, { groupBoard: true }) : it.ticket;
    const text = used
      ? ("USED:" + (it.ticket.id || ""))
      : T.payload(ticket);
    it.w = used ? -999 : T.windowOf();
    const Q = await window.ETC_LIB.load("qrcode");
    if (!it.el.isConnected) return;
    if (!Q) { it.el.innerHTML = `<span class="qr-fallback">${text}</span>`; return; }
    if (it.qr) {
      try { it.qr.makeCode(text); } catch (_) {
        it.el.innerHTML = "";
        it.qr = new Q(it.el, { text: text, width: it.size, height: it.size, colorDark: "#0B1224", colorLight: "#ffffff", correctLevel: Q.CorrectLevel.M });
      }
    } else {
      it.el.innerHTML = "";
      it.qr = new Q(it.el, { text: text, width: it.size, height: it.size, colorDark: "#0B1224", colorLight: "#ffffff", correctLevel: Q.CorrectLevel.M });
    }
    const c = it.el.querySelector("canvas"), i = it.el.querySelector("img");
    [c, i].forEach((n) => { if (n) { n.style.width = it.size + "px"; n.style.height = it.size + "px"; } });
    // Grey out used QR
    // Keep QR crisp under USED stamp (no grey-out)
    it.el.style.opacity = "1";
    it.el.style.filter = "";
  }

  function mount(el, ticket, size, opts) {
    opts = opts || {};
    const it = { el: el, ticket: ticket, size: size || 200, qr: null, w: -1, groupBoard: !!opts.groupBoard };
    items.add(it);
    paint(it);
    start();
    return it;
  }

  function updateTicket(el, ticket) {
    items.forEach((it) => {
      if (it.el === el || (ticket && it.ticket && it.ticket.id === ticket.id)) {
        it.ticket = ticket || it.ticket;
        paint(it);
      }
    });
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      const w = T.windowOf();
      items.forEach((it) => {
        if (!it.el.isConnected) { items.delete(it); return; }
        if (isUsed(it.ticket)) {
          // keep frozen – only paint once if needed
          if (it.w !== -999) paint(it);
          return;
        }
        if (it.w !== w) paint(it);
      });
      tickers.forEach((f) => f(T.secondsLeft()));
      if (!items.size && !tickers.size) { clearInterval(timer); timer = 0; }
    }, 1000);
  }

  const tickers = new Set();
  const onTick = (f) => { tickers.add(f); start(); f(T.secondsLeft()); };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) items.forEach((it) => paint(it));
  });
  return { mount: mount, onTick: onTick, updateTicket: updateTicket, isUsed: isUsed };
})();
