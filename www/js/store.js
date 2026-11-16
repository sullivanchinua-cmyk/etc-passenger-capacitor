// =========================================================
// Local store for tickets + notifications.
//   Always persists to localStorage immediately (never blocks payment).
//   Dexie/IndexedDB is a best-effort mirror when it loads quickly.
// =========================================================
window.ETC_Store = (function () {
  const LS = { tickets: "etc_tickets", notes: "etc_notifications" };
  const rd = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (_) { return []; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  function lsPut(table, row) {
    const k = LS[table];
    const a = rd(k).filter((x) => x.id !== row.id);
    a.unshift(row);
    wr(k, a);
  }
  function lsGet(table, id) {
    return rd(LS[table]).find((x) => x.id === id) || null;
  }
  function lsAll(table) {
    return rd(LS[table]);
  }

  let dexieDb = null;
  let dexieTried = false;

  function tryInitDexie() {
    if (dexieTried) return;
    dexieTried = true;
    try {
      if (!window.ETC_LIB || !window.ETC_LIB.load) return;
      // Fire-and-forget; never block callers
      Promise.race([
        window.ETC_LIB.load("dexie"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("dexie-timeout")), 2000)),
      ]).then(function (D) {
        if (!D) return;
        const db = new D("etc_passenger");
        db.version(1).stores({ tickets: "id, reference, date, createdAt", notes: "id, createdAt" });
        return db.open().then(function () {
          dexieDb = db;
          // import anything from localStorage once
          ["tickets", "notes"].forEach(function (t) {
            const old = lsAll(t);
            if (old.length) {
              db[t].bulkPut(old).catch(function () {});
            }
          });
        });
      }).catch(function () { /* stay on localStorage */ });
    } catch (_) {}
  }

  // Kick off Dexie in background on first access
  setTimeout(tryInitDexie, 0);

  const setUnread = (n) => { try { localStorage.setItem("etc_unread", String(Math.max(0, n))); } catch (_) {} };
  const sortNew = (a) => a.slice().sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));

  return {
    backendName: async () => (dexieDb ? "dexie" : "localStorage"),
    async putTicket(t) {
      // Always local first (sync path under async)
      lsPut("tickets", t);
      if (dexieDb) {
        try { dexieDb.tickets.put(t).catch(function () {}); } catch (_) {}
      } else {
        tryInitDexie();
      }
    },
    async getTicket(id) {
      const local = lsGet("tickets", id);
      if (local) return local;
      if (dexieDb) {
        try { return (await dexieDb.tickets.get(id)) || null; } catch (_) {}
      }
      return null;
    },
    async listTickets() {
      let list = lsAll("tickets");
      if (dexieDb) {
        try {
          const dx = await dexieDb.tickets.orderBy("createdAt").reverse().toArray();
          // Merge by id, prefer localStorage copy
          const byId = {};
          dx.forEach(function (t) { byId[t.id] = t; });
          list.forEach(function (t) { byId[t.id] = t; });
          list = Object.values(byId);
        } catch (_) {}
      }
      return sortNew(list);
    },
    async ticketsByRef(ref) {
      return (await this.listTickets())
        .filter((t) => t.reference === ref)
        .sort((a, b) => (a.index || 0) - (b.index || 0));
    },
    async putNote(n) {
      const had = lsGet("notes", n.id);
      lsPut("notes", n);
      if (!had && !n.read) setUnread((parseInt(localStorage.getItem("etc_unread"), 10) || 0) + 1);
      if (dexieDb) {
        try { dexieDb.notes.put(n).catch(function () {}); } catch (_) {}
      }
    },
    async listNotes() {
      return sortNew(lsAll("notes"));
    },
    async markAllRead() {
      const all = lsAll("notes").map((n) => Object.assign({}, n, { read: true }));
      wr(LS.notes, all);
      setUnread(0);
      if (dexieDb) {
        try {
          for (const n of all) dexieDb.notes.put(n).catch(function () {});
        } catch (_) {}
      }
    },
    async markRead(id) {
      const n = lsGet("notes", id);
      if (n && !n.read) {
        lsPut("notes", Object.assign({}, n, { read: true }));
        const left = lsAll("notes").filter((x) => !x.read).length;
        setUnread(left);
        if (dexieDb) {
          try { dexieDb.notes.put(Object.assign({}, n, { read: true })).catch(function () {}); } catch (_) {}
        }
      }
    },
  };
})();
