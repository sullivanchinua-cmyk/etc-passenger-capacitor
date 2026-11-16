// =========================================================
// Tiny finite-state machine (no dependencies, ~120 lines).
//
//   const m = ETC_Machine.create({
//     id: "pay", initial: "idle", context: { n: 0 },
//     on: { FATAL: "fatal" },                                 // global transitions
//     states: {
//       idle: { on: { GO: { target: "busy", guard: (c, p) => p.ok, action: (c, p) => { c.n++; } } } },
//       busy: { entry: (c, send) => {...}, exit: (c) => {...},
//               after: [{ ms: 30000, event: "TIMEOUT" }],     // watchdog – cleared on exit
//               on: { DONE: "idle", TIMEOUT: "idle" } },
//     },
//   });
//   m.send("GO", { ok: true });  →  true if handled, false if ignored
//
// Rules that keep a payment screen from crashing or getting stuck:
//   • an event that is not valid in the current state is IGNORED (never throws)
//   • events sent from inside entry/action are queued and run in order (no re-entrancy)
//   • a guard / action / entry that throws is caught and reported to onError
//   • watchdog timers belong to a state and die with it
// =========================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ETC_Machine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function create(def, opts) {
    opts = opts || {};
    const timers = opts.timers || { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) };
    const ctx = Object.assign({}, def.context || {});
    const listeners = new Set();
    const queue = [];
    const history = [];
    let state = def.initial, running = false, stopped = false, seq = 0;
    let active = [];                                        // timers of the current state

    const log = (type, extra) => { history.push(Object.assign({ n: ++seq, state, type }, extra || {})); if (history.length > 40) history.shift(); };
    const fail = (where, err) => {
      log("error", { where, msg: String((err && err.message) || err) });
      if (def.onError) { try { def.onError(err, where, ctx, state); } catch (_) {} }
    };
    const clearTimers = () => { active.forEach((t) => timers.clear(t)); active = []; };
    const notify = () => listeners.forEach((fn) => { try { fn(state, ctx); } catch (e) { fail("subscriber", e); } });

    function pick(type, payload) {
      const s = def.states[state] || {};
      const cand = [].concat((s.on && s.on[type]) || [], (def.on && def.on[type]) || []);
      for (const c of cand) {
        const t = typeof c === "string" ? { target: c } : c;
        try { if (!t.guard || t.guard(ctx, payload)) return t; } catch (e) { fail("guard:" + type, e); }
      }
      return null;
    }

    function enter(name) {
      state = name;
      const s = def.states[name] || {};
      (s.after || []).forEach((a) => {
        const ms = typeof a.ms === "function" ? a.ms(ctx) : a.ms;
        if (ms == null || ms < 0) return;
        active.push(timers.set(() => send(a.event, a.payload), Math.max(0, ms)));
      });
      if (s.entry) { try { s.entry(ctx, send); } catch (e) { fail("entry:" + name, e); } }
    }

    function step(ev) {
      const t = pick(ev.type, ev.payload);
      if (!t) { log("ignored", { event: ev.type }); return false; }
      const from = state;
      try {
        if (t.target && t.target !== from || (t.target && t.reenter)) {
          const s = def.states[from] || {};
          clearTimers();
          if (s.exit) s.exit(ctx);
          if (t.action) t.action(ctx, ev.payload);
          log("transition", { event: ev.type, from, to: t.target });
          enter(t.target);
        } else {
          if (t.action) t.action(ctx, ev.payload);
          log("internal", { event: ev.type });
        }
      } catch (e) { fail("action:" + ev.type, e); }
      notify();
      return true;
    }

    function send(type, payload) {
      if (stopped) return false;
      queue.push({ type, payload });
      if (running) return true;
      running = true;
      let handled = false, first = true;
      try {
        while (queue.length) { const r = step(queue.shift()); if (first) { handled = r; first = false; } }
      } finally { running = false; }
      return handled;
    }

    const api = {
      send,
      get state() { return state; },
      get context() { return ctx; },
      matches: (...names) => names.indexOf(state) >= 0,
      can: (type, payload) => !!pick(type, payload),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      history: () => history.slice(),
      stop: () => { stopped = true; clearTimers(); listeners.clear(); },
      // run entry of the initial state (kept separate so subscribers can attach first)
      start: () => { enter(state); notify(); return api; },
    };
    return api;
  }
  return { create };
});
