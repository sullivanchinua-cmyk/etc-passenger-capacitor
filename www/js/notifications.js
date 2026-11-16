// Notifications: every ticket that was generated lands here with its live QR.
(function () {
  const S = window.ETC_Store, I = window.ETC_ICONS, esc = window.ETC_UI.esc, box = document.getElementById("list");
  const ago = (ms) => { const s = Math.max(1, Math.round((Date.now() - ms) / 1000)); if (s < 60) return "Just now"; const m = Math.round(s / 60); if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + " hr ago"; return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
  /* boot */ (async function () {
    const notes = await S.listNotes();
    if (!notes.length) { box.innerHTML = `<div class="nt-empty">${I.bell}<h3>No notifications yet</h3><p>When you book a ticket, it shows up here with its QR code.</p></div>`; return; }
    const rows = [];
    for (const n of notes) {
      const t = n.ticketIds && n.ticketIds[0] ? await S.getTicket(n.ticketIds[0]) : null;
      const a = document.createElement("a");
      a.className = "nt" + (n.read ? "" : " unread"); a.href = t ? "ticket.html?id=" + encodeURIComponent(t.id) : "events.html";
      a.innerHTML = `<span class="ic">${t ? I.ticket : I.bell}</span><span class="tx"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${ago(n.createdAt)}${t && t.seat ? ` · Bus ${t.bus || 1} · Seat ${esc(t.seat)}` : ""}</small></span>${t ? '<span class="thumb" aria-hidden="true"></span>' : ""}`;
      box.appendChild(a); rows.push([a, t]);
    }
    rows.forEach(([a, t]) => { if (t) /* mount */ window.ETC_QRLive.mount(a.querySelector(".thumb"), t, 66); });
    setTimeout(() => S.markAllRead(), 1500);                 // dots stay visible for a moment, then clear (also clears the Home bell)
  })();
})();

// Label USED on notification QR thumbs after Firestore status sync
(function () {
  async function markUsedThumbs() {
    if (!window.ETC_Tickets || !window.ETC_Store) return;
    try {
      const all = await window.ETC_Store.listTickets();
      const used = new Set(all.filter((t) => {
        const s = String(t.status || "").toLowerCase();
        return s === "boarded" || s === "used" || s === "void";
      }).map((t) => t.id));
      document.querySelectorAll(".nt, .note, [data-tid], a[href*=\"ticket.html\"]").forEach((row) => {
        const href = row.getAttribute("href") || "";
        const m = /id=([^&]+)/.exec(href);
        const id = m ? decodeURIComponent(m[1]) : (row.dataset && row.dataset.tid);
        if (!id || !used.has(id)) return;
        let thumb = row.querySelector(".thumb, .qr, canvas") && row.querySelector(".thumb, .nt-qr, .thumb");
        thumb = row.querySelector(".thumb") || row.querySelector("[class*=qr]");
        if (!thumb) return;
        thumb.style.position = "relative";
        if (!thumb.querySelector(".nt-used-stamp")) {
          const s = document.createElement("span");
          s.className = "nt-used-stamp";
          s.textContent = "USED";
          thumb.appendChild(s);
        }
      });
    } catch (_) {}
  }
  setTimeout(markUsedThumbs, 1200);
  setTimeout(markUsedThumbs, 3000);
})();
