/**
 * ETC Chat — Full RTDB → Firestore bridge (from Krisfeet v50 pattern)
 * Mapped from standalone-chat actual db.ref() usage (no guessed paths).
 *
 * RTDB paths used by standalone:
 *   public_chat, public_chat/{id}, public_chat/{id}/reactions/{uid}
 *   fun_chat
 *   chats/{chatId}, chats/{chatId}/{msgId}, chats/{chatId}/{msgId}/reactions/...
 *   users, users/{uid}, users/{uid}/photoURL|name|displayName
 *   friends/{uid}, friends/{uid}/{friendUid}
 *   friend_requests, friend_requests/{targetUid}/{fromUid}
 *   stories, stories/{id}
 *   typing/{chatId}/{uid}, typing/public_chat
 *   starred/{uid}/{chatId}/{msgId}, starred/{uid}/public/{msgId}
 *   chat_pins/{chatId}, chat_pins/public
 *   fcm_tokens/{uid}
 *
 * Firestore layout:
 *   rtdb_{root} / {docId}  (+ optional subcollection "items" for list children)
 *   Nested field paths for leaf keys (reactions, photoURL, etc.)
 */
(function () {
  'use strict';

  if (typeof firebase === 'undefined' || !firebase.firestore) {
    console.warn('[FS-bridge] Firestore unavailable');
    return;
  }

  var fs;
  try { fs = firebase.firestore(); } catch (e) { return; }
  // Offline: keep chat data in Firestore's local cache so chats open and queue sends with no internet.
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}

  // Prefix etc_rtdb_ so ETC chat never mixes with krisfeet/physio/other app collections
  function colName(root) {
    return 'etc_rtdb_' + String(root || 'root').replace(/[\/#.$\[\]]/g, '_');
  }

  function partsOf(path) {
    return String(path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  }

  function deepGet(obj, segs) {
    var cur = obj;
    for (var i = 0; i < segs.length; i++) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[segs[i]];
    }
    return cur === undefined ? null : cur;
  }

  function deepSet(obj, segs, val) {
    var cur = obj;
    for (var i = 0; i < segs.length - 1; i++) {
      var k = segs[i];
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    if (segs.length) cur[segs[segs.length - 1]] = val;
    return obj;
  }

  function deepDel(obj, segs) {
    if (!segs.length) return;
    var cur = obj;
    for (var i = 0; i < segs.length - 1; i++) {
      if (!cur[segs[i]]) return;
      cur = cur[segs[i]];
    }
    delete cur[segs[segs.length - 1]];
  }

  // Roots that use a messages subcollection under a chat/thread doc
  var LIST_ROOTS = {
    public_chat: true,
    work_public_chat: true,
    fun_chat: true,
    stories: true
  };

  function isChatMessagesRoot(segs) {
    // chats/{chatId}/...
    return segs[0] === 'chats' && segs.length >= 1;
  }

  function snapVal(data) {
    return {
      val: function () { return data; },
      forEach: function (fn) {
        if (!data || typeof data !== 'object') return;
        Object.keys(data).forEach(function (k) {
          fn(childSnap(k, data[k]));
        });
      },
      numChildren: function () {
        return data && typeof data === 'object' ? Object.keys(data).length : 0;
      },
      exists: function () { return data != null; }
    };
  }

  function childSnap(key, data) {
    return {
      key: key,
      val: function () { return data; },
      exists: function () { return data != null; },
      child: function (k) {
        var v = (data && typeof data === 'object') ? data[k] : null;
        return childSnap(k, v);
      },
      forEach: function (fn) {
        if (!data || typeof data !== 'object') return;
        Object.keys(data).forEach(function (k) { fn(childSnap(k, data[k])); });
      },
      numChildren: function () {
        return data && typeof data === 'object' ? Object.keys(data).length : 0;
      }
    };
  }

  function FsRef(path) {
    this.path = path || '';
    this._segs = partsOf(path);
    this._limit = null;
    this._order = null;
    this._start = null;
    this._equal = null;
    this._dir = 'asc';
  }

  FsRef.prototype.child = function (c) {
    return new FsRef(this.path ? this.path + '/' + c : c);
  };

  FsRef.prototype.limitToLast = function (n) {
    this._limit = n;
    this._dir = 'desc';
    return this;
  };
  FsRef.prototype.limitToFirst = function (n) {
    this._limit = n;
    this._dir = 'asc';
    return this;
  };
  FsRef.prototype.orderByChild = function (c) {
    this._order = c;
    return this;
  };
  FsRef.prototype.startAt = function (v) {
    this._start = v;
    return this;
  };
  FsRef.prototype.equalTo = function (v) {
    this._equal = v;
    return this;
  };

  // ── push ──────────────────────────────────────────────────────────
  FsRef.prototype.push = function (data) {
    var segs = this._segs;
    var payload = Object.assign({}, data || {});
    if (payload.ts == null && payload.timestamp == null && payload.createdAt == null) {
      payload.createdAt = Date.now();
    }
    if (payload.ts == null && data && data.ts) payload.ts = data.ts;
    if (payload.ts == null) payload.ts = Date.now();

    var key = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var ret = { key: key };

    var p;
    // chats/{chatId} → messages subcollection
    if (segs[0] === 'chats' && segs.length === 2) {
      var chatId = segs[1];
      p = fs.collection(colName('chats')).doc(chatId).collection('messages').add(payload)
        .then(function (ref) {
          ret.key = ref.id;
          // Auto-friend both sides (ETC behaviour) so conversation appears in Friends
          try {
            var me = (window.currentUser && window.currentUser.uid) || (payload && payload.senderId);
            var parts = String(chatId).split('_');
            if (me && parts.length === 2 && String(me).indexOf('guest_') !== 0) {
              var other = parts[0] === me ? parts[1] : parts[0];
              if (other && other !== me) {
                var ts = Date.now();
                fs.collection(colName('friends')).doc(me).set(
                  (function () { var o = {}; o[other] = { friendUid: other, since: ts }; return o; })(),
                  { merge: true }
                );
                fs.collection(colName('friends')).doc(other).set(
                  (function () { var o = {}; o[me] = { friendUid: me, since: ts }; return o; })(),
                  { merge: true }
                );
              }
            }
          } catch (eFr) {}
          return ret;
        });
    }
    // public_chat / fun_chat / stories root push
    else if (segs.length === 1 && LIST_ROOTS[segs[0]]) {
      p = fs.collection(colName(segs[0])).add(payload)
        .then(function (ref) { ret.key = ref.id; return ret; });
    }
    // chats/{chatId}/{msgId}/reactions → subcollection reactions
    else if (segs[0] === 'chats' && segs.length === 4 && segs[3] === 'reactions') {
      p = fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2])
        .collection('reactions').add(payload)
        .then(function (ref) { ret.key = ref.id; return ret; });
    }
    // public_chat/{id}/reactions style — map field push with auto key
    else if (segs.length === 3 && segs[2] === 'reactions') {
      var rid = key;
      var patch = {};
      patch['reactions.' + rid] = payload;
      p = fs.collection(colName(segs[0])).doc(segs[1]).set(patch, { merge: true })
        .then(function () { ret.key = rid; return ret; });
    }
    else if (segs.length === 1) {
      p = fs.collection(colName(segs[0])).add(payload)
        .then(function (ref) { ret.key = ref.id; return ret; });
    }
    else {
      // fallback: store under parent as map entry
      var root = segs[0];
      var id = segs[1] || key;
      p = fs.collection(colName(root)).doc(id).set(payload, { merge: true })
        .then(function () { ret.key = id; return ret; });
    }

    p = p.catch(function (err) {
      console.warn('[FS-bridge] push', this && this.path, err);
      // local fallback
      try {
        var store = JSON.parse(localStorage.getItem('_chatStore') || '{}');
        var bucket = this.path || 'root';
        if (!store[bucket]) store[bucket] = {};
        store[bucket][ret.key] = payload;
        localStorage.setItem('_chatStore', JSON.stringify(store));
      } catch (e) {}
      return ret;
    }.bind(this));

    ret.then = p.then.bind(p);
    ret.catch = p.catch.bind(p);
    return ret;
  };

  // ── set ───────────────────────────────────────────────────────────
  FsRef.prototype.set = function (data) {
    var segs = this._segs;
    if (!segs.length) return Promise.resolve();

    // Single field leaf: users/uid/photoURL
    if (segs.length >= 3) {
      // chats/chatId/msgId/read or reactions/uid
      if (segs[0] === 'chats' && segs.length >= 3) {
        var chatId = segs[1];
        var msgId = segs[2];
        if (segs.length === 3) {
          return fs.collection(colName('chats')).doc(chatId).collection('messages').doc(msgId)
            .set(data, { merge: typeof data === 'object' && data !== null });
        }
        // nested field under message
        var fieldPath = segs.slice(3).join('.');
        var upd = {};
        upd[fieldPath] = data;
        return fs.collection(colName('chats')).doc(chatId).collection('messages').doc(msgId)
          .set(upd, { merge: true });
      }
      // friend_requests/target/from
      if (segs[0] === 'friend_requests' && segs.length === 3) {
        return fs.collection(colName('friend_requests')).doc(segs[1])
          .set(deepSet({}, [segs[2]], data), { merge: true });
      }
      // friends/uid/friendUid
      if (segs[0] === 'friends' && segs.length === 3) {
        return fs.collection(colName('friends')).doc(segs[1])
          .set(deepSet({}, [segs[2]], data), { merge: true });
      }
      // typing/chatId/uid
      if (segs[0] === 'typing' && segs.length === 3) {
        return fs.collection(colName('typing')).doc(segs[1])
          .set(deepSet({}, [segs[2]], data), { merge: true });
      }
      // starred/uid/chatId/msgId
      if (segs[0] === 'starred' && segs.length >= 3) {
        var starId = segs.slice(1).join('__');
        return fs.collection(colName('starred')).doc(starId)
          .set(Object.assign({ _segs: segs.slice(1) }, typeof data === 'object' ? data : { value: data }), { merge: true });
      }
      // generic nested field on doc
      var patch = {};
      patch[segs.slice(2).join('.')] = data;
      return fs.collection(colName(segs[0])).doc(segs[1]).set(patch, { merge: true });
    }

    if (segs.length === 2) {
      return fs.collection(colName(segs[0])).doc(segs[1])
        .set(typeof data === 'object' && data !== null ? data : { value: data }, { merge: false });
    }

    if (segs.length === 1) {
      // replace whole collection not supported — write meta doc
      return fs.collection(colName(segs[0])).doc('_root').set(
        typeof data === 'object' && data !== null ? data : { value: data },
        { merge: true }
      );
    }
    return Promise.resolve();
  };

  // ── update ────────────────────────────────────────────────────────
  FsRef.prototype.update = function (data) {
    var segs = this._segs;
    if (!data || typeof data !== 'object') return Promise.resolve();

    // Multi-path update from accept friend: { 'friends/a/b': {...}, 'friend_requests/x/y': null }
    var keys = Object.keys(data);
    if (keys.some(function (k) { return k.indexOf('/') !== -1; })) {
      var batch = fs.batch();
      var ops = [];
      keys.forEach(function (k) {
        ops.push(new FsRef(k).set(data[k]));
      });
      return Promise.all(ops);
    }

    if (segs[0] === 'chats' && segs.length === 3) {
      return fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2])
        .set(data, { merge: true });
    }
    if (segs.length === 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).set(data, { merge: true });
    }
    if (segs.length > 2) {
      var patch = {};
      Object.keys(data).forEach(function (k) {
        patch[segs.slice(2).join('.') + '.' + k] = data[k];
      });
      // simpler: merge into nested object via read-modify-write
      var col = colName(segs[0]);
      var id = segs[1];
      return fs.collection(col).doc(id).get().then(function (doc) {
        var base = doc.exists ? doc.data() : {};
        deepSet(base, segs.slice(2), Object.assign(deepGet(base, segs.slice(2)) || {}, data));
        return fs.collection(col).doc(id).set(base, { merge: true });
      });
    }
    return Promise.resolve();
  };

  // ── remove ────────────────────────────────────────────────────────
  FsRef.prototype.remove = function () {
    var segs = this._segs;
    if (!segs.length) return Promise.resolve();

    if (segs[0] === 'chats' && segs.length === 3) {
      return fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2]).delete();
    }
    // public_chat/{id}, poll_votes nested, users/{id}, etc.
    if (segs.length === 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).delete();
    }
    if (segs.length === 3) {
      // Nested field clear: e.g. poll_votes/{pid}/{uid}
      return fs.collection(colName(segs[0])).doc(segs[1]).get().then(function (doc) {
        if (!doc.exists) return;
        var data = doc.data() || {};
        delete data[segs[2]];
        return fs.collection(colName(segs[0])).doc(segs[1]).set(data);
      });
    }
    if (segs[0] === 'chats' && segs.length === 2) {
      // delete all messages in chat
      var cref = fs.collection(colName('chats')).doc(segs[1]).collection('messages');
      return cref.limit(400).get().then(function (snap) {
        var batch = fs.batch();
        snap.forEach(function (d) { batch.delete(d.ref); });
        return batch.commit();
      });
    }
    if (segs[0] === 'chats' && segs.length >= 5 && segs[3] === 'reactions') {
      return fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2])
        .collection('reactions').doc(segs[4]).delete();
    }
    if (segs.length === 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).delete().catch(function () {});
    }
    if (segs.length >= 3) {
      // delete nested field
      var col = colName(segs[0]);
      var id = segs[1];
      return fs.collection(col).doc(id).get().then(function (doc) {
        if (!doc.exists) return;
        var base = doc.data() || {};
        deepDel(base, segs.slice(2));
        return fs.collection(col).doc(id).set(base);
      });
    }
    return Promise.resolve();
  };

  // ── once ──────────────────────────────────────────────────────────
  FsRef.prototype.once = function (event) {
    var segs = this._segs;
    var self = this;

    // list roots: users, stories, public_chat, friend_requests, ...
    if (segs.length === 1) {
      var q = fs.collection(colName(segs[0]));
      try {
        if (self._order && self._equal != null) {
          q = q.where(self._order, '==', self._equal);
        } else if (self._order && self._start != null) {
          q = q.where(self._order, '>=', self._start).orderBy(self._order, 'asc');
        } else if (self._order) {
          q = q.orderBy(self._order, self._dir === 'desc' ? 'desc' : 'asc');
        } else if (self._limit && self._dir === 'desc') {
          try { q = q.orderBy('timestamp', 'desc'); } catch (e0) {
            try { q = q.orderBy('ts', 'desc'); } catch (e1) {
              try { q = q.orderBy('createdAt', 'desc'); } catch (e2) {}
            }
          }
        }
      } catch (eOrd) { console.warn('[FS-bridge] once order', eOrd); }
      if (self._limit) q = q.limit(self._limit);
      return q.get().then(function (snap) {
        var obj = {};
        snap.forEach(function (d) { obj[d.id] = d.data(); });
        return snapVal(obj);
      }).catch(function (err) {
        console.warn('[FS-bridge] once', self.path, err);
        // Fallback without composite index: fetch all and filter client-side
        return fs.collection(colName(segs[0])).get().then(function (snap2) {
          var obj = {};
          snap2.forEach(function (d) {
            var data = d.data() || {};
            if (self._order && self._start != null) {
              if ((data[self._order] || 0) < self._start) return;
            }
            obj[d.id] = data;
          });
          return snapVal(obj);
        }).catch(function () { return snapVal(null); });
      });
    }

    // chats/{id}/messages query
    if (segs[0] === 'chats' && segs.length === 2) {
      var mq = fs.collection(colName('chats')).doc(segs[1]).collection('messages');
      if (self._order) mq = mq.orderBy(self._order, self._dir === 'desc' ? 'desc' : 'asc');
      if (self._equal != null && self._order) mq = fs.collection(colName('chats')).doc(segs[1]).collection('messages').where(self._order, '==', self._equal);
      if (self._limit) mq = mq.limit(self._limit);
      return mq.get().then(function (snap) {
        var obj = {};
        snap.forEach(function (d) { obj[d.id] = d.data(); });
        return snapVal(obj);
      }).catch(function () { return snapVal({}); });
    }

    if (segs[0] === 'chats' && segs.length === 3) {
      return fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2])
        .get().then(function (doc) {
          return snapVal(doc.exists ? doc.data() : null);
        });
    }

    if (segs.length === 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).get().then(function (doc) {
        return snapVal(doc.exists ? doc.data() : null);
      }).catch(function () { return snapVal(null); });
    }

    if (segs.length > 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).get().then(function (doc) {
        var base = doc.exists ? doc.data() : null;
        return snapVal(deepGet(base, segs.slice(2)));
      }).catch(function () { return snapVal(null); });
    }

    return Promise.resolve(snapVal(null));
  };

  // ── on ────────────────────────────────────────────────────────────
  FsRef.prototype.on = function (event, cb) {
    var segs = this._segs;
    var self = this;
    if (typeof cb !== 'function') return cb;

    function attachQuery(query, mode) {
      var _first = true;
      return query.onSnapshot(function (snap) {
        if (event === 'value') {
          var obj = {};
          snap.forEach(function (d) { obj[d.id] = d.data(); });
          cb(snapVal(obj));
        } else {
          var changes = snap.docChanges();
          // Initial snapshot with limitToLast (desc): deliver oldest→newest so chat UI order is correct
          if (_first && event === 'child_added' && self._dir === 'desc') {
            _first = false;
            var adds = [];
            changes.forEach(function (change) {
              if (change.type === 'added') adds.push(change);
            });
            adds.reverse();
            adds.forEach(function (change) {
              cb(childSnap(change.doc.id, change.doc.data()));
            });
            return;
          }
          _first = false;
          changes.forEach(function (change) {
            var map = { added: 'child_added', modified: 'child_changed', removed: 'child_removed' };
            if (map[change.type] === event) {
              cb(childSnap(change.doc.id, change.doc.data()));
            }
          });
        }
      }, function (err) {
        console.warn('[FS-bridge] on', self.path, err);
        if (event === 'value') cb(snapVal({}));
      });
    }

    // public_chat / fun_chat / stories list
    if (segs.length === 1 && (LIST_ROOTS[segs[0]] || segs[0] === 'users' || segs[0] === 'friend_requests' || segs[0] === 'friends')) {
      var q = fs.collection(colName(segs[0]));
      if (self._order) {
        try {
          q = q.orderBy(self._order, self._dir === 'desc' ? 'desc' : 'asc');
        } catch (e) {}
      } else {
        var dir = self._dir === 'desc' ? 'desc' : 'asc';
        try { q = q.orderBy('timestamp', dir); } catch (e1) {
          try { q = q.orderBy('ts', dir); } catch (e2) {
            try { q = q.orderBy('createdAt', dir); } catch (e3) {}
          }
        }
      }
      if (self._start != null && self._order) {
        try { q = q.where(self._order, '>=', self._start); } catch (e) {}
      }
      if (self._limit) q = q.limit(self._limit);
      return attachQuery(q);
    }

    // typing/public_chat or typing/{chatId}
    if (segs[0] === 'typing' && segs.length === 2) {
      return fs.collection(colName('typing')).doc(segs[1]).onSnapshot(function (doc) {
        cb(snapVal(doc.exists ? doc.data() : null));
      }, function () { cb(snapVal(null)); });
    }

    // chats/{chatId}
    if (segs[0] === 'chats' && segs.length === 2) {
      var mq = fs.collection(colName('chats')).doc(segs[1]).collection('messages');
      if (self._order) {
        try { mq = mq.orderBy(self._order, 'asc'); } catch (e) {}
      } else {
        try { mq = mq.orderBy('ts', 'asc'); } catch (e) {}
      }
      if (self._equal != null && self._order) {
        try { mq = fs.collection(colName('chats')).doc(segs[1]).collection('messages').where(self._order, '==', self._equal); } catch (e) {}
      }
      if (self._limit) mq = mq.limit(self._limit);
      return attachQuery(mq);
    }

    // chats/{chatId}/{msgId} or nested
    if (segs[0] === 'chats' && segs.length === 3) {
      return fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2])
        .onSnapshot(function (doc) {
          cb(snapVal(doc.exists ? doc.data() : null));
        }, function () { cb(snapVal(null)); });
    }

    if (segs[0] === 'chats' && segs.length === 4 && segs[3] === 'reactions') {
      return fs.collection(colName('chats')).doc(segs[1]).collection('messages').doc(segs[2])
        .collection('reactions').onSnapshot(function (snap) {
          var obj = {};
          snap.forEach(function (d) { obj[d.id] = d.data(); });
          cb(snapVal(obj));
        }, function () { cb(snapVal({})); });
    }

    // doc ref depth 2
    if (segs.length === 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).onSnapshot(function (doc) {
        cb(snapVal(doc.exists ? doc.data() : null));
      }, function () { cb(snapVal(null)); });
    }

    // nested field listen — listen parent, project field
    if (segs.length > 2) {
      return fs.collection(colName(segs[0])).doc(segs[1]).onSnapshot(function (doc) {
        var base = doc.exists ? doc.data() : null;
        cb(snapVal(deepGet(base, segs.slice(2))));
      }, function () { cb(snapVal(null)); });
    }

    return function () {};
  };

  FsRef.prototype.off = function () {
    // Snapshot unsubs are held per-callback in full RTDB; simplified no-op is ok for this app
  };

  // Multi-path update helper used by some standalone code
  function rtdbUpdate(updates) {
    if (!updates || typeof updates !== 'object') return Promise.resolve();
    return Promise.all(Object.keys(updates).map(function (path) {
      var val = updates[path];
      if (val === null) return new FsRef(path).remove();
      return new FsRef(path).set(val);
    }));
  }

  window.db = {
    ref: function (path) { return new FsRef(path || ''); },
    update: rtdbUpdate
  };
  try { db = window.db; } catch (e) {}
  try { window.ETC_FS_BRIDGE = true; } catch (e) {}

  // Re-publish current user into users/ so Friends / people list populate (Krisfeet kfWriteChatUser)
  try {
    setTimeout(function () {
      try {
        if (typeof _registerMe === 'function' && window.currentUser) _registerMe(window.currentUser);
        else if (typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.uid) {
          var u = window.currentUser;
          if (String(u.uid).indexOf('guest_') === 0) return;
          window.db.ref('users/' + u.uid).set({
            uid: u.uid,
            name: u.displayName || 'ETC user',
            displayName: u.displayName || 'ETC user',
            email: u.email || null,
            photoURL: u.photoURL || null,
            role: window.ETC_CHAT_ROLE || 'passenger',
            bio: u.bio || '',
            terminal: u.terminal || null,
            lastSeen: Date.now(),
            updatedAt: Date.now()
          });
        }
      } catch (e2) {}
    }, 400);
  } catch (e3) {}

  console.log('✅ ETC Firestore RTDB bridge active (etc_rtdb_* collections)');
})();
