/**
 * ETC Chat - WhatsApp-style Gallery, Audio and Document pickers.
 *
 *  In the Capacitor app they list REAL files from the phone (Android MediaStore) through the
 *  native "DeviceFiles" plugin. In a normal browser they fall back to the system file chooser
 *  and to the files shared in the current chat.
 *
 *    EtcPickers.openGallery(cb)    cb(File)
 *    EtcPickers.openAudio(cb)      cb(File)
 *    EtcPickers.openDocuments(cb)  cb(File)
 *
 *  Follows the chat theme (localStorage etc_ui_mode = light | dark).
 */
(function () {
  var N = window.EtcNative;
  var cfg = window.ETC_CONFIG || {};
  var PAGE = 90;

  var AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.opus,.weba';
  var IMG_ACCEPT   = 'image/*,video/*';
  var DOC_ACCEPT   = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip,.rar,.7z,.epub,.json,.md';

  function devFiles() { return (N && N.isNative) ? N.deviceFiles() : null; }

  // ------------------------------------------------------------ theme + helpers
  function isLight() {
    try { return (localStorage.getItem('etc_ui_mode') || 'light') !== 'dark'; } catch (e) { return true; }
  }
  function pal() {
    return isLight()
      ? { bg: '#F3F4F6', sheet: '#FFFFFF', head: 'linear-gradient(135deg,#0B0F3A,#1a237e)', headTxt: '#fff', headSub: 'rgba(255,255,255,.7)',
          txt: '#111112', mut: '#6b7280', line: 'rgba(17,17,18,.08)', press: '#E5E7EB', accent: '#1a237e', iconBg: '#1a237e',
          btn: 'linear-gradient(135deg,#0B0F3A,#1a237e)', tabOff: '#8b8d93', tabBar: '#FFFFFF', chip: '#E5E7EB', input: '#FFFFFF',
          handle: '#C3C4C8', bannerBg: '#E8EAF6', bannerTxt: '#1a237e', bannerBtn: '#1a237e', ovBg: 'rgba(17,17,18,.45)' }
      : { bg: '#111b21', sheet: '#1f2c34', head: '#1f2c34', headTxt: '#fff', headSub: '#8696a0',
          txt: '#e9edef', mut: '#8696a0', line: 'rgba(255,255,255,.08)', press: '#1f2c34', accent: '#9fa8ff', iconBg: '#2a3942',
          btn: 'linear-gradient(135deg,#3949ab,#1a237e)', tabOff: '#8696a0', tabBar: '#1f2c34', chip: '#2a3942', input: '#111b21',
          handle: '#4b5563', bannerBg: '#1e3a5f', bannerTxt: '#93c5fd', bannerBtn: '#3b82f6', ovBg: 'rgba(0,0,0,.6)' };
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(b) {
    b = Number(b) || 0;
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' kB';
    if (b < 1073741824) return (b / 1048576).toFixed(b < 10485760 ? 2 : 1) + ' MB';
    return (b / 1073741824).toFixed(1) + ' GB';
  }
  function fmtDur(ms) {
    var s = Math.round((Number(ms) || 0) / 1000), m = Math.floor(s / 60);
    s = s % 60;
    if (m >= 60) { var h = Math.floor(m / 60); m = m % 60; return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2);
  }
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  function dayLabel(ms) {
    var now = new Date(), d = new Date(ms);
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= start) return 'TODAY';
    if (ms >= start - 864e5) return 'YESTERDAY';
    if (ms >= start - 6 * 864e5) return 'THIS WEEK';
    if (ms >= start - 13 * 864e5) return 'LAST WEEK';
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function toast(msg) {
    if (typeof showToast === 'function') { try { showToast(msg); return; } catch (e) {} }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#111112;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;z-index:99999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2500);
  }
  function chatTitle() { return (typeof friendName !== 'undefined' && friendName) ? friendName : 'Coal City Chat'; }
  function chatRoom() { return (typeof chatId !== 'undefined' && chatId) ? 'priv_' + chatId : 'public_chat'; }
  function extOf(name) {
    var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '').split('?')[0]);
    return m ? m[1].toLowerCase() : '';
  }
  function nameFromUrl(u) {
    try { return decodeURIComponent(String(u).split('?')[0].split('/').pop()) || 'file'; } catch (e) { return 'file'; }
  }

  var ICON_BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>';
  var ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var ICON_INFO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  var ICON_FOLDER = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
  var ICON_LINK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
  var ICON_PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  var ICON_PAUSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

  function injectCSS(P) {
    var s = document.getElementById('_pkCSS');
    if (!s) { s = document.createElement('style'); s.id = '_pkCSS'; document.head.appendChild(s); }
    s.textContent =
      '@keyframes _pkUp{from{transform:translateY(100%)}to{transform:translateY(0)}}' +
      '@keyframes _pkSpin{to{transform:rotate(360deg)}}' +
      '._pkRow{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid ' + P.line + ';cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '._pkRow:active{background:' + P.press + '}' +
      '._pkHead{color:' + P.mut + ';font-size:11px;font-weight:700;letter-spacing:1px;padding:14px 18px 6px;margin:0}' +
      '._pkEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 28px;text-align:center}' +
      '._pkEmpty p{color:' + P.mut + ';font-size:14px;margin:0;line-height:1.5}' +
      '._pkBtn{background:' + P.btn + ';color:#fff;border:none;padding:10px 20px;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer}' +
      '._pkCell{position:relative;background:' + P.chip + ';overflow:hidden;cursor:pointer;aspect-ratio:1;-webkit-tap-highlight-color:transparent}' +
      '._pkCell:active{opacity:.75}' +
      '._pkCell img,._pkCell video{width:100%;height:100%;object-fit:cover;display:block}' +
      '._pkBadge{position:absolute;left:5px;bottom:5px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;display:flex;align-items:center;gap:3px}' +
      '._pkSpin{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}' +
      '._pkSpin i{width:24px;height:24px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:_pkSpin .8s linear infinite}';
  }

  // ------------------------------------------------------------ system chooser (persistent inputs)
  var inputs = {};
  function browse(kind, accept, cb) {
    var inp = inputs[kind];
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px;pointer-events:none';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        var done = inp._cb; inp._cb = null;
        inp.value = '';
        if (f && done) done(f);
      });
      document.body.appendChild(inp);
      inputs[kind] = inp;
    }
    inp._cb = cb;
    inp.click();
  }

  // ------------------------------------------------------------ overlays + back button
  function mount(el, onClose) {
    document.body.appendChild(el);
    var closed = false;
    if (N && N.isNative) {                       // Capacitor: hardware back button
      var closer = function () { cleanupN(); };
      var cleanupN = function () {
        if (closed) return;
        closed = true; N.popBack(closer); el.remove();
        if (onClose) { try { onClose(); } catch (e) {} }
      };
      N.pushBack(closer);
      return cleanupN;
    }
    var st = { pk: Date.now() };                 // browser: history entry so Back closes the sheet
    try { history.pushState(st, ''); } catch (e) {}
    function cleanup(fromPop) {
      if (closed) return;
      closed = true;
      window.removeEventListener('popstate', onPop);
      el.remove();
      if (onClose) { try { onClose(); } catch (e) {} }
      if (!fromPop) { try { if (history.state && history.state.pk === st.pk) history.back(); } catch (e) {} }
    }
    function onPop() { cleanup(true); }
    window.addEventListener('popstate', onPop);
    return function () { cleanup(false); };
  }

  var resumeFn = null;
  if (N && N.onResume) N.onResume(function () { if (resumeFn) resumeFn(); });

  function emptyState(html, btnLabel, onBtn) {
    var d = document.createElement('div');
    d.className = '_pkEmpty';
    d.innerHTML = '<p>' + html + '</p>' + (btnLabel ? '<button class="_pkBtn">' + esc(btnLabel) + '</button>' : '');
    if (btnLabel) d.querySelector('button').onclick = onBtn;
    return d;
  }
  function spinnerRow() {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;justify-content:center;padding:30px';
    d.innerHTML = '<div style="position:relative;width:30px;height:30px"><div class="_pkSpin" style="background:none"><i style="border-color:rgba(128,128,128,.35);border-top-color:#1a237e"></i></div></div>';
    return d;
  }
  function actionRow(P, label, sub, icon, onClick) {
    var r = document.createElement('div');
    r.className = '_pkRow';
    r.innerHTML = '<div style="width:44px;height:52px;background:' + P.iconBg + ';border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + icon + '</div>' +
      '<div style="flex:1;min-width:0"><p style="color:' + P.txt + ';font-size:14px;font-weight:600;margin:0">' + esc(label) + '</p><p style="color:' + P.mut + ';font-size:12px;margin:2px 0 0">' + esc(sub) + '</p></div>';
    r.onclick = onClick;
    return r;
  }
  function headerHTML(P, title, sub, searchPh) {
    return '<div style="background:' + P.head + ';padding:12px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0">' +
      '<button id="_pkBack" aria-label="Back" style="width:38px;height:38px;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:' + P.headTxt + '">' + ICON_BACK + '</button>' +
      '<div id="_pkTitle" style="flex:1;min-width:0"><p style="color:' + P.headTxt + ';font-weight:700;font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(title) + '</p><p style="color:' + P.headSub + ';font-size:12px;margin:0">' + esc(sub) + '</p></div>' +
      '<input id="_pkQ" placeholder="' + esc(searchPh) + '" style="display:none;flex:1;min-width:0;background:' + P.input + ';border:1px solid ' + P.line + ';border-radius:10px;color:' + P.txt + ';padding:8px 12px;font-size:14px;outline:none"/>' +
      '<button id="_pkSearch" aria-label="Search" style="width:36px;height:36px;background:rgba(255,255,255,.14);border-radius:10px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:' + P.headTxt + '">' + ICON_SEARCH + '</button>' +
      '</div>';
  }
  function bannerHTML(P, text, id) {
    return '<div style="background:' + P.bannerBg + ';padding:10px 16px;display:flex;align-items:center;gap:10px;color:' + P.bannerTxt + '">' + ICON_INFO +
      '<span style="font-size:12.5px;flex:1">' + esc(text) + '</span>' +
      '<button id="' + id + '" style="background:' + P.bannerBtn + ';color:#fff;border:none;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;cursor:pointer">Allow</button></div>';
  }
  function ensureAccess(df, what) {
    var req = {}; req[what] = true;
    return df.getAccess().then(function (a) { return a[what] ? a : df.requestAccess(req); });
  }

  // ------------------------------------------------------------ real media grid (Gallery + Docs>Media)
  function MediaGrid(host, scroller, df, onPick) {
    var state = { albumId: '', offset: 0, loading: false, more: true, gen: 0 };
    var io = null;
    function observer() {
      if (io) io.disconnect();
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var cell = en.target; io.unobserve(cell);
          var it = cell._item;
          df.getThumbnail({ uri: it.uri, id: it.id, kind: it.kind, size: 256 }).then(function (r) {
            var img = document.createElement('img');
            img.alt = '';
            img.src = N.toWebUrl(r.path);
            cell.insertBefore(img, cell.firstChild);
          }).catch(function () {});
        });
      }, { root: scroller, rootMargin: '300px' });
    }
    function addCell(it) {
      var cell = document.createElement('div');
      cell.className = '_pkCell';
      cell._item = it;
      if (it.kind === 'video') {
        cell.innerHTML = '<div class="_pkBadge"><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><polygon points="6 4 20 12 6 20"/></svg>' + fmtDur(it.duration) + '</div>';
      }
      cell.onclick = function () {
        if (cell._busy) return;
        cell._busy = true;
        var sp = document.createElement('div'); sp.className = '_pkSpin'; sp.innerHTML = '<i></i>';
        cell.appendChild(sp);
        N.fileFromUri(it).then(onPick).catch(function (e) {
          cell._busy = false; sp.remove();
          toast('Could not read this file');
          console.warn('[picker]', e);
        });
      };
      host.appendChild(cell);
      io.observe(cell);
    }
    function load(reset) {
      if (reset) { state.offset = 0; state.more = true; state.gen++; host.innerHTML = ''; observer(); }
      if (state.loading || !state.more) return Promise.resolve();
      state.loading = true;
      var gen = state.gen;
      return df.listMedia({ kind: 'all', albumId: state.albumId || undefined, limit: PAGE, offset: state.offset }).then(function (r) {
        if (gen !== state.gen) return;
        (r.items || []).forEach(addCell);
        state.offset += (r.items || []).length;
        state.more = !!r.hasMore;
        if (!state.offset) host.appendChild(emptyState('No photos or videos found on this phone.'));
      }).then(function () { state.loading = false; }, function (e) { state.loading = false; throw e; });
    }
    function onScroll() {
      if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 600) load(false).catch(function () {});
    }
    scroller.addEventListener('scroll', onScroll);
    return {
      reset: function (albumId) { state.albumId = albumId || ''; return load(true); },
      stop: function () { if (io) io.disconnect(); scroller.removeEventListener('scroll', onScroll); }
    };
  }

  // ------------------------------------------------------------ GALLERY
  function openGallery(cb) {
    var df = devFiles();
    if (!df) { browse('gallery', IMG_ACCEPT, cb); return; }
    var P = pal(); injectCSS(P);

    var ov = document.createElement('div');
    ov.id = '_galOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9850;background:' + P.ovBg + ';display:flex;flex-direction:column;justify-content:flex-end';
    ov.innerHTML =
      '<div style="background:' + P.sheet + ';border-radius:20px 20px 0 0;height:85vh;display:flex;flex-direction:column;animation:_pkUp .28s cubic-bezier(.34,1.1,.64,1);color:' + P.txt + '">' +
        '<div style="padding:10px 0 6px;display:flex;justify-content:center;flex-shrink:0"><div style="width:36px;height:4px;background:' + P.handle + ';border-radius:2px"></div></div>' +
        '<div style="display:flex;align-items:center;padding:6px 14px 12px;flex-shrink:0">' +
          '<button id="_pkClose" aria-label="Close" style="width:38px;height:38px;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:' + P.mut + '"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div style="flex:1"><p style="color:' + P.txt + ';font-weight:700;font-size:16px;margin:0">Photos</p><p id="_pkSub" style="color:' + P.mut + ';font-size:12px;margin:1px 0 0">Recent</p></div>' +
          '<button id="_pkBrowse" style="background:' + P.btn + ';color:#fff;border:none;font-size:13px;font-weight:700;padding:8px 16px;border-radius:20px;cursor:pointer">Browse all</button>' +
        '</div>' +
        '<div id="_pkTabs" style="display:flex;padding:0 16px;gap:4px;flex-shrink:0;border-bottom:1px solid ' + P.line + '"></div>' +
        '<div id="_pkScroll" style="flex:1;overflow-y:auto;padding:2px">' +
          '<div id="_pkGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px"></div>' +
          '<div id="_pkAlbums" style="display:none"></div>' +
        '</div>' +
      '</div>';

    var done = false, grid, close;
    function finish(file) { if (done) return; done = true; if (grid) grid.stop(); close(); if (cb) cb(file); }
    close = mount(ov, function () { if (grid) grid.stop(); });

    var $ = function (s) { return ov.querySelector(s); };
    $('#_pkClose').onclick = function () { close(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    $('#_pkBrowse').onclick = function () { close(); browse('gallery', IMG_ACCEPT, cb); };

    var gridEl = $('#_pkGrid'), albumsEl = $('#_pkAlbums'), scroll = $('#_pkScroll');
    grid = MediaGrid(gridEl, scroll, df, finish);

    var current = 'photos';
    function tab(which) {
      current = which;
      $('#_pkTabs').innerHTML = [['photos', 'Photos'], ['albums', 'Albums']].map(function (t) {
        var on = t[0] === which;
        return '<button data-t="' + t[0] + '" style="background:none;border:none;border-bottom:2px solid ' + (on ? P.accent : 'transparent') + ';color:' + (on ? P.accent : P.tabOff) + ';font-weight:' + (on ? 700 : 600) + ';font-size:14px;padding:8px 14px;cursor:pointer">' + t[1] + '</button>';
      }).join('');
      $('#_pkTabs').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { var t = b.getAttribute('data-t'); tab(t); if (t === 'albums') loadAlbums(); };
      });
      gridEl.style.display = which === 'photos' ? 'grid' : 'none';
      albumsEl.style.display = which === 'photos' ? 'none' : 'block';
    }
    tab('photos');

    var albumsLoaded = false;
    function albumRow(name, sub, onClick) {
      var row = document.createElement('div');
      row.className = '_pkRow';
      row.innerHTML = '<div style="flex:1;min-width:0"><p style="color:' + P.txt + ';font-size:15px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + '</p><p style="color:' + P.mut + ';font-size:12px;margin:2px 0 0">' + esc(sub) + '</p></div>';
      row.onclick = onClick;
      return row;
    }
    function loadAlbums() {
      if (albumsLoaded) return;
      albumsLoaded = true;
      df.listAlbums().then(function (r) {
        albumsEl.innerHTML = '';
        albumsEl.appendChild(albumRow('Recent', 'All photos and videos', function () { $('#_pkSub').textContent = 'Recent'; tab('photos'); grid.reset(''); }));
        (r.albums || []).forEach(function (a) {
          albumsEl.appendChild(albumRow(a.name, a.count + ' item' + (a.count === 1 ? '' : 's'), function () { $('#_pkSub').textContent = a.name; tab('photos'); grid.reset(a.id); }));
        });
      }).catch(function () { albumsLoaded = false; });
    }

    function start() {
      gridEl.innerHTML = '';
      ensureAccess(df, 'media').then(function (a) {
        if (!a.media) {
          gridEl.style.display = 'block';
          gridEl.appendChild(emptyState('Allow access to your photos and videos so you can choose them here.', 'Allow access', function () {
            df.requestAccess({ media: true }).then(function (r) {
              if (r.media) { gridEl.style.display = 'grid'; start(); }
              else { df.openAppSettings(); toast('Turn on Photos and videos permission, then come back'); }
            });
          }));
          return;
        }
        gridEl.style.display = current === 'photos' ? 'grid' : 'none';
        grid.reset('').catch(function () { toast('Could not load photos'); });
      }).catch(function () { toast('Could not request permission'); });
    }
    start();
  }

  // ------------------------------------------------------------ AUDIO
  function openAudio(cb) {
    var df = devFiles();
    if (!df) { browse('audio', AUDIO_ACCEPT, cb); return; }
    var P = pal(); injectCSS(P);

    var ov = document.createElement('div');
    ov.id = '_aAudUI';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9850;background:' + P.bg + ';display:flex;flex-direction:column;font-family:inherit;color:' + P.txt;
    ov.innerHTML = headerHTML(P, 'Send to ~ Audio', 'Tap to select', 'Search audio') + '<div id="_pkBanner"></div><div id="_pkList" style="flex:1;overflow-y:auto"></div>';

    var player = null, playingId = null;
    function stopPlayer() {
      if (player) { try { player.pause(); } catch (e) {} player = null; }
      if (playingId != null) { var b = ov.querySelector('[data-play="' + playingId + '"]'); if (b) b.innerHTML = ICON_PLAY; }
      playingId = null;
    }
    var close = mount(ov, stopPlayer);
    var $ = function (s) { return ov.querySelector(s); };
    var list = $('#_pkList'), q = $('#_pkQ');
    var st = { offset: 0, more: true, loading: false, gen: 0, query: '', last: '' };
    function finish(file) { stopPlayer(); close(); if (cb) cb(file); }

    $('#_pkBack').onclick = function () { close(); };
    $('#_pkSearch').onclick = function () {
      var open = q.style.display === 'none';
      q.style.display = open ? 'block' : 'none';
      $('#_pkTitle').style.display = open ? 'none' : 'block';
      if (open) q.focus(); else { q.value = ''; reload(''); }
    };
    var qt = null;
    q.oninput = function () { clearTimeout(qt); qt = setTimeout(function () { reload(q.value); }, 250); };

    function row(a) {
      var el = document.createElement('div');
      el.className = '_pkRow'; el.style.gap = '14px';
      var sub = a.artist || a.album || '';
      el.innerHTML =
        '<button data-play="' + a.id + '" aria-label="Preview" style="width:48px;height:48px;background:linear-gradient(145deg,#f59e0b,#d97706);border:none;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(245,158,11,.3);cursor:pointer">' + ICON_PLAY + '</button>' +
        '<div style="flex:1;min-width:0"><p style="color:' + P.txt + ';font-size:14.5px;font-weight:500;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.title || a.name) + '</p>' +
          (sub ? '<p style="color:' + P.mut + ';font-size:12px;margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sub) + '</p>' : '') + '</div>' +
        '<div style="text-align:right;flex-shrink:0"><p style="color:' + P.txt + ';font-size:13px;margin:0">' + fmtDur(a.duration) + '</p><p style="color:' + P.mut + ';font-size:11.5px;margin:2px 0 0">' + fmtSize(a.size) + '</p></div>';
      el.querySelector('button').onclick = function (e) {
        e.stopPropagation();
        var btn = e.currentTarget;
        if (playingId === a.id) { stopPlayer(); return; }
        stopPlayer();
        playingId = a.id; btn.innerHTML = ICON_PAUSE;
        df.copyToCache({ uri: a.uri, name: a.name }).then(function (r) {
          if (playingId !== a.id) return;
          player = new Audio(N.toWebUrl(r.path));
          player.onended = stopPlayer;
          player.onerror = function () { stopPlayer(); toast('Cannot preview this audio'); };
          return player.play();
        }).catch(function () { stopPlayer(); });
      };
      el.onclick = function () {
        if (el._busy) return; el._busy = true; el.style.opacity = '.5';
        N.fileFromUri(a).then(finish).catch(function () { el._busy = false; el.style.opacity = '1'; toast('Could not read this file'); });
      };
      return el;
    }
    function top() {
      return actionRow(P, 'Browse other audio…', 'Choose from your files', ICON_FOLDER, function () { close(); browse('audio', AUDIO_ACCEPT, cb); });
    }
    function load() {
      if (st.loading || !st.more) return;
      st.loading = true;
      var gen = st.gen, sp = spinnerRow(); list.appendChild(sp);
      df.listAudio({ limit: 120, offset: st.offset, query: st.query }).then(function (r) {
        if (gen !== st.gen) return;
        sp.remove();
        (r.items || []).forEach(function (a) {
          var lab = dayLabel(a.dateAdded * 1000);
          if (lab !== st.last) { st.last = lab; var h = document.createElement('p'); h.className = '_pkHead'; h.textContent = lab; list.appendChild(h); }
          list.appendChild(row(a));
        });
        st.offset += (r.items || []).length;
        st.more = !!r.hasMore; st.loading = false;
        if (!st.offset) list.appendChild(emptyState(st.query ? 'No audio matches your search.' : 'No audio files found on this phone.'));
      }).catch(function () { sp.remove(); st.loading = false; });
    }
    function reload(query) {
      st.gen++; st.offset = 0; st.more = true; st.loading = false; st.query = query || ''; st.last = '';
      list.innerHTML = ''; list.appendChild(top()); load();
    }
    list.addEventListener('scroll', function () {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - 500) load();
    });

    function banner(show) {
      var b = $('#_pkBanner');
      if (!show) { b.innerHTML = ''; return; }
      b.innerHTML = bannerHTML(P, 'Allow storage access to see your audio files', '_pkAllow');
      $('#_pkAllow').onclick = function () {
        df.requestAccess({ audio: true }).then(function (a) {
          if (a.audio) { banner(false); reload(''); } else { df.openAppSettings(); toast('Turn on Music and audio permission, then come back'); }
        });
      };
    }
    ensureAccess(df, 'audio').then(function (a) {
      banner(!a.audio);
      if (a.audio) reload(''); else list.appendChild(top());
    }).catch(function () { banner(true); list.appendChild(top()); });

    resumeFn = function () {
      if (!document.getElementById('_aAudUI')) return;
      df.getAccess().then(function (a) { if (a.audio && $('#_pkBanner').innerHTML) { banner(false); reload(''); } });
    };
  }

  // ------------------------------------------------------------ chat files (web fallback + Links tab)
  function mimeOf(m) {
    var t = String(m.fileType || '');
    if (t) return t;
    var e = extOf(m.fileName || m.fileUrl);
    if (/^(jpg|jpeg|png|gif|webp|heic)$/.test(e)) return 'image/' + e;
    if (/^(mp4|mov|webm|mkv|3gp)$/.test(e)) return 'video/' + e;
    if (/^(mp3|m4a|ogg|wav|aac|opus|weba)$/.test(e)) return 'audio/' + e;
    return '';
  }
  function loadChatFiles() {
    var p = (window.OfflineCache && OfflineCache.getMsgs) ? OfflineCache.getMsgs(chatRoom(), 500) : Promise.resolve([]);
    return p.then(function (msgs) {
      msgs = (msgs || []).slice().sort(function (a, b) { return (b.ts || b.timestamp || 0) - (a.ts || a.timestamp || 0); });
      var docs = [], media = [], links = [], seenF = {}, seenL = {};
      msgs.forEach(function (m) {
        var ts = Number(m.ts || m.timestamp || 0) || Date.now();
        if (m.fileUrl && !seenF[m.fileUrl]) {
          seenF[m.fileUrl] = 1;
          var mime = mimeOf(m);
          var it = { url: m.fileUrl, name: m.fileName || nameFromUrl(m.fileUrl), size: m.fileSize || 0, ts: ts, type: mime };
          it.ext = extOf(it.name);
          if (/^(image|video)\//.test(mime)) media.push(it);
          else if (!/^audio\//.test(mime)) docs.push(it);
        }
        var txt = String(m.text || m.message || '');
        (txt.match(/https?:\/\/[^\s<>"']+/g) || []).forEach(function (u) {
          if (!seenL[u]) { seenL[u] = 1; links.push({ url: u, ts: ts }); }
        });
      });
      return { docs: docs, media: media, links: links };
    }).catch(function () { return { docs: [], media: [], links: [] }; });
  }
  function remoteToFile(it) {
    return fetch(it.url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (b) {
      return new File([b], it.name || 'file', { type: it.type || b.type || 'application/octet-stream' });
    });
  }

  var TYPE_ICONS = {
    doc: { bg: '#1e40af', t: 'W' }, docx: { bg: '#1e40af', t: 'W' }, rtf: { bg: '#1e40af', t: 'W' }, odt: { bg: '#1e40af', t: 'W' },
    pdf: { bg: '#b91c1c', t: 'PDF' },
    xls: { bg: '#166534', t: 'X' }, xlsx: { bg: '#166534', t: 'X' }, ods: { bg: '#166534', t: 'X' }, csv: { bg: '#065f46', t: 'CSV' },
    ppt: { bg: '#9a3412', t: 'P' }, pptx: { bg: '#9a3412', t: 'P' }, odp: { bg: '#9a3412', t: 'P' },
    txt: { bg: '#374151', t: 'T' }, md: { bg: '#374151', t: 'MD' }, json: { bg: '#374151', t: '{}' },
    zip: { bg: '#4c1d95', t: 'ZIP' }, rar: { bg: '#4c1d95', t: 'RAR' }, '7z': { bg: '#4c1d95', t: '7Z' }, epub: { bg: '#78350f', t: 'E' }
  };
  function docIcon(ext) {
    var ic = TYPE_ICONS[ext] || { bg: '#374151', t: (ext || 'FILE').slice(0, 4).toUpperCase() };
    return '<div style="width:44px;height:52px;background:' + ic.bg + ';border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.25);position:relative">' +
      '<div style="position:absolute;top:0;right:0;width:10px;height:10px;background:rgba(255,255,255,.25);border-radius:0 8px 0 8px"></div>' +
      '<span style="color:#fff;font-size:' + (ic.t.length > 2 ? 11 : 14) + 'px;font-weight:800">' + esc(ic.t) + '</span></div>';
  }

  // ------------------------------------------------------------ DOCUMENTS  (Docs | Media | Links)
  function openDocuments(cb) {
    var df = devFiles();
    var P = pal(); injectCSS(P);

    var ov = document.createElement('div');
    ov.id = '_aDocUI';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9850;background:' + P.bg + ';display:flex;flex-direction:column;font-family:inherit;color:' + P.txt;
    ov.innerHTML = headerHTML(P, chatTitle(), 'Send a document', 'Search') +
      '<div id="_pkBanner"></div>' +
      '<div id="_pkTabs" style="display:flex;background:' + P.tabBar + ';border-bottom:1px solid ' + P.line + ';flex-shrink:0"></div>' +
      '<div id="_pkBody" style="flex:1;overflow-y:auto"></div>';

    var close = mount(ov);
    var $ = function (s) { return ov.querySelector(s); };
    var body = $('#_pkBody'), q = $('#_pkQ');
    var tab = 'Docs', chat = null, mediaGrid = null;
    var access = { allFiles: false, sdk: 0 };
    function finish(file) { close(); if (cb) cb(file); }

    $('#_pkBack').onclick = function () { close(); };
    $('#_pkSearch').onclick = function () {
      var open = q.style.display === 'none';
      q.style.display = open ? 'block' : 'none';
      $('#_pkTitle').style.display = open ? 'none' : 'block';
      if (open) { q.focus(); if (tab !== 'Docs') { tab = 'Docs'; drawTabs(); render(); } } else { q.value = ''; render(); }
    };
    var qt = null;
    q.oninput = function () { clearTimeout(qt); qt = setTimeout(render, 220); };

    function drawTabs() {
      $('#_pkTabs').innerHTML = ['Docs', 'Media', 'Links'].map(function (t) {
        var on = t === tab;
        return '<button data-tab="' + t + '" style="flex:1;background:none;border:none;border-bottom:2px solid ' + (on ? P.accent : 'transparent') + ';color:' + (on ? P.accent : P.tabOff) + ';font-size:14px;font-weight:' + (on ? 700 : 500) + ';padding:12px 0;cursor:pointer">' + t + '</button>';
      }).join('');
      $('#_pkTabs').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { tab = b.getAttribute('data-tab'); drawTabs(); render(); };
      });
    }
    function busy(el, on) {
      el._busy = on;
      var isCell = el.classList.contains('_pkCell');
      var sp = el.querySelector('._pkSpin');
      if (isCell) {
        if (on && !sp) { sp = document.createElement('div'); sp.className = '_pkSpin'; sp.innerHTML = '<i></i>'; el.appendChild(sp); }
        if (!on && sp) sp.remove();
      } else { el.style.opacity = on ? '.5' : '1'; }
    }
    function pickRemote(el, it) {
      if (el._busy) return;
      busy(el, true);
      remoteToFile(it).then(finish).catch(function () { busy(el, false); toast('Could not load this file. Open it from the chat instead.'); });
    }
    function pickDevice(el, it) {
      if (el._busy) return;
      busy(el, true);
      N.fileFromUri(it).then(finish).catch(function () { busy(el, false); toast('Could not read this file'); });
    }
    function browseRow() {
      return actionRow(P, 'Browse other docs…', 'Open the Android file chooser', ICON_FOLDER, function () { close(); browse('doc', DOC_ACCEPT, cb); });
    }

    // ---- Docs: real device documents (native) or files shared in this chat (browser)
    var dev = { offset: 0, more: true, loading: false, gen: 0, query: '', last: '' };
    function devDocRow(d) {
      var row = document.createElement('div');
      row.className = '_pkRow';
      row.innerHTML = docIcon(d.ext) +
        '<div style="flex:1;min-width:0"><p style="color:' + P.txt + ';font-size:13.5px;font-weight:500;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.name) + '</p>' +
        '<p style="color:' + P.mut + ';font-size:11.5px;margin:3px 0 0">' + [fmtSize(d.size), (d.ext || '').toUpperCase(), fmtDate((d.dateModified || d.dateAdded) * 1000)].filter(Boolean).join(' · ') + '</p></div>';
      row.onclick = function () { pickDevice(row, d); };
      return row;
    }
    function loadDevDocs() {
      if (dev.loading || !dev.more) return;
      dev.loading = true;
      var gen = dev.gen, sp = spinnerRow(); body.appendChild(sp);
      df.listDocuments({ limit: 120, offset: dev.offset, query: dev.query }).then(function (r) {
        if (gen !== dev.gen || tab !== 'Docs') return;
        sp.remove();
        (r.items || []).forEach(function (d) {
          var lab = dayLabel((d.dateModified || d.dateAdded) * 1000);
          if (lab !== dev.last) { dev.last = lab; var h = document.createElement('p'); h.className = '_pkHead'; h.textContent = lab; body.appendChild(h); }
          body.appendChild(devDocRow(d));
        });
        dev.offset += (r.items || []).length;
        dev.more = !!r.hasMore; dev.loading = false;
        if (!dev.offset) {
          body.appendChild(emptyState(dev.query ? 'No documents match your search.' :
            (access.allFiles ? 'No documents found on this phone.' :
              (cfg.ALL_FILES_ACCESS === false ? 'Use “Browse other docs” to pick a file from your phone.' :
                'Android only lets this app list its own documents.<br>Allow storage access above, or use “Browse other docs”.'))));
        }
      }).catch(function () { sp.remove(); dev.loading = false; });
    }
    body.addEventListener('scroll', function () {
      if (df && tab === 'Docs' && body.scrollTop + body.clientHeight > body.scrollHeight - 500) loadDevDocs();
    });

    function renderDocs(text) {
      body.appendChild(browseRow());
      if (df) {
        dev.gen++; dev.offset = 0; dev.more = true; dev.loading = false; dev.query = text; dev.last = '';
        loadDevDocs();
        return;
      }
      var list = (chat ? chat.docs : []).filter(function (d) { return !text || d.name.toLowerCase().indexOf(text.toLowerCase()) !== -1; });
      if (!list.length) { body.appendChild(emptyState(text ? 'No documents match your search.' : (chat ? 'No documents have been shared in this chat yet.<br>Use “Browse other docs” to send one.' : 'Loading…'))); return; }
      var last = '';
      list.forEach(function (d) {
        var lab = dayLabel(d.ts);
        if (lab !== last) { last = lab; var h = document.createElement('p'); h.className = '_pkHead'; h.textContent = lab; body.appendChild(h); }
        var row = document.createElement('div');
        row.className = '_pkRow';
        row.innerHTML = docIcon(d.ext) +
          '<div style="flex:1;min-width:0"><p style="color:' + P.txt + ';font-size:13.5px;font-weight:500;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.name) + '</p>' +
          '<p style="color:' + P.mut + ';font-size:11.5px;margin:3px 0 0">' + [fmtSize(d.size), (d.ext || '').toUpperCase(), fmtDate(d.ts)].filter(Boolean).join(' · ') + '</p></div>';
        row.onclick = function () { pickRemote(row, d); };
        body.appendChild(row);
      });
    }

    // ---- Media: recent photos/videos (native) or media shared in this chat (browser)
    function renderMedia() {
      if (df) {
        var host = document.createElement('div');
        host.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:2px';
        body.appendChild(host);
        ensureAccess(df, 'media').then(function (a) {
          if (!a.media) {
            host.style.display = 'block';
            host.appendChild(emptyState('Allow access to your photos and videos to see them here.', 'Allow access', function () {
              df.requestAccess({ media: true }).then(function (r) { if (r.media) render(); else df.openAppSettings(); });
            }));
            return;
          }
          mediaGrid = MediaGrid(host, body, df, finish);
          mediaGrid.reset('').catch(function () {});
        });
        return;
      }
      body.appendChild(actionRow(P, 'Choose a photo or video', 'Opens your phone gallery', ICON_FOLDER, function () { close(); browse('gallery', IMG_ACCEPT, cb); }));
      var items = chat ? chat.media : [];
      if (!items.length) { body.appendChild(emptyState(chat ? 'No photos or videos have been shared in this chat yet.' : 'Loading…')); return; }
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:2px';
      items.forEach(function (it) {
        var cell = document.createElement('div');
        cell.className = '_pkCell';
        if (/^video\//.test(it.type)) cell.innerHTML = '<video src="' + esc(it.url) + '#t=0.1" preload="metadata" muted playsinline></video><div class="_pkBadge">▶ Video</div>';
        else cell.innerHTML = '<img loading="lazy" alt="" src="' + esc(it.url) + '">';
        cell.onclick = function () { pickRemote(cell, it); };
        grid.appendChild(cell);
      });
      body.appendChild(grid);
    }

    // ---- Links: from this chat (SQLite / cache)
    function renderLinks(text) {
      var ls = (chat ? chat.links : []).filter(function (l) { return !text || l.url.toLowerCase().indexOf(text.toLowerCase()) !== -1; });
      if (!ls.length) { body.appendChild(emptyState(text ? 'No links match your search.' : (chat ? 'No links have been shared in this chat yet.' : 'Loading…'))); return; }
      ls.forEach(function (l) {
        var host = l.url.replace(/^https?:\/\//, '').split('/')[0];
        var row = document.createElement('div');
        row.className = '_pkRow';
        row.innerHTML = '<div style="width:44px;height:44px;background:' + P.iconBg + ';border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + ICON_LINK + '</div>' +
          '<div style="flex:1;min-width:0"><p style="color:' + P.txt + ';font-size:13.5px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.url) + '</p>' +
          '<p style="color:' + P.mut + ';font-size:11.5px;margin:3px 0 0">' + esc(host) + ' · ' + fmtDate(l.ts) + '</p></div>';
        row.onclick = function () { close(); if (typeof _textCB === 'function') _textCB(l.url); };
        body.appendChild(row);
      });
    }

    function render() {
      if (mediaGrid) { mediaGrid.stop(); mediaGrid = null; }
      body.innerHTML = '';
      var text = (q.value || '').trim();
      if (tab === 'Docs') renderDocs(text);
      else if (tab === 'Media') renderMedia();
      else renderLinks(text);
    }

    // ---- "Allow storage access to browse your documents" (Android 11+ All files access)
    function banner(show) {
      var b = $('#_pkBanner');
      if (!show) { b.innerHTML = ''; return; }
      b.innerHTML = bannerHTML(P, 'Allow storage access to browse your documents', '_pkAllow');
      $('#_pkAllow').onclick = function () {
        if (access.sdk >= 30) df.openAllFilesSettings();
        else df.requestAccess({ documents: true }).then(function () { recheck(); });
      };
    }
    function recheck() {
      return df.getAccess().then(function (a) {
        access = a;
        banner(cfg.ALL_FILES_ACCESS !== false && !a.allFiles);
        return a;
      });
    }

    drawTabs();
    if (df) {
      recheck().then(render, render);
      resumeFn = function () {
        if (!document.getElementById('_aDocUI')) return;
        var was = access.allFiles;
        recheck().then(function (a) { if (a.allFiles && !was && tab === 'Docs') render(); });
      };
    } else {
      render();
    }
    loadChatFiles().then(function (d) { chat = d; if (tab === 'Links' || !df) render(); });
  }

  window.EtcPickers = { openGallery: openGallery, openAudio: openAudio, openDocuments: openDocuments };
})();
