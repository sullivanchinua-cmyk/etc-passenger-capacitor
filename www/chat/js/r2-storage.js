// ============================================================================
// ETC CHAT — Cloudflare R2 file storage  (replaces Firebase Storage — not used)
// ----------------------------------------------------------------------------
// Flow:  file picked in chat  →  signed PUT to Cloudflare R2  →  signed GET link  →
//        link (+ fileKey) saved in the Firebase Realtime Database message.
//
// This is its OWN part, separate from hybrid-config.js (Firebase wiring):
//   • every ETC file lives under the folder  R2_ETC.prefix  ("etc-chat/…") so it never
//     mixes with the other app that uses the same bucket;
//   • to move ETC to its own bucket / API token later, change ONLY the R2_ETC block below.
//
// Loaded right after hybrid-config.js. Same function names the chat code already calls:
//   uploadFile · uploadFileWithProgress · deleteFile · getMimeFromName · refreshExpiredUrls
// ============================================================================
(function (window) {
  'use strict';

  // ───────────────────────── EDIT HERE ONLY ─────────────────────────
  var R2_ETC = {
    accountId : "42da38481c29c9c967c3af6ecd7e67cb",
    accessKey : "044ac113440b8ce3e6fb549c840aa8e7",
    secretKey : "b549940c43a73c60fd18f172d6b40d56a82fcccfe3bab077cfc537d2ac00a2d9",
    bucket    : "physio-app-files",          // → set to your new ETC bucket (e.g. "etc-chat-files") when you create it
    prefix    : "etc-chat/"        // ETC's own folder inside the bucket
  };
  // ──────────────────────────────────────────────────────────────────

  var HOST = R2_ETC.accountId + '.r2.cloudflarestorage.com';
  var URL_LIFE = 604800;                     // pre-signed link lifetime: 7 days (R2 maximum)
  var REFRESH_AFTER_MS = 5 * 24 * 3600 * 1000; // re-sign links older than 5 days (2-day safety buffer)
  var EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  var R2_MIME = {
    jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp", svg:"image/svg+xml", heic:"image/heic",
    mp4:"video/mp4", mov:"video/quicktime", webm:"video/webm", '3gp':"video/3gpp",
    mp3:"audio/mpeg", wav:"audio/wav", ogg:"audio/ogg", m4a:"audio/mp4", aac:"audio/aac",
    pdf:"application/pdf", doc:"application/msword",
    docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:"application/vnd.ms-excel",
    xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:"application/vnd.ms-powerpoint",
    pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    apk:"application/vnd.android.package-archive", zip:"application/zip", txt:"text/plain", csv:"text/csv"
  };

  // ── AWS Signature V4 with Web Crypto (no libraries) ──
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  async function sha256(data) { return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)); }
  async function hmac(key, msg) {
    var k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  }
  async function signingKey(ymd) {
    var a = await hmac('AWS4' + R2_ETC.secretKey, ymd); a = await hmac(a, 'auto'); a = await hmac(a, 's3'); return hmac(a, 'aws4_request');
  }
  function stamp() {            // 20260314 / 20260314T120000Z
    var iso = new Date().toISOString().replace(/[-:]/g, '');
    return { ymd: iso.slice(0, 8), dt: iso.slice(0, 8) + 'T' + iso.slice(9, 15) + 'Z' };
  }
  function encPath(key) { return '/' + R2_ETC.bucket + '/' + key.split('/').map(encodeURIComponent).join('/'); }

  // signed header set for PUT / DELETE → returns {url, headers}
  async function signRequest(method, key, contentType, bodyHash) {
    var s = stamp(), path = encPath(key), scope = s.ymd + '/auto/s3/aws4_request';
    var signed = contentType ? 'content-type;host;x-amz-content-sha256;x-amz-date' : 'host;x-amz-content-sha256;x-amz-date';
    var canon = [method, path, '',
      (contentType ? 'content-type:' + contentType + '\n' : '') + 'host:' + HOST + '\n' + 'x-amz-content-sha256:' + bodyHash + '\n' + 'x-amz-date:' + s.dt + '\n',
      signed, bodyHash].join('\n');
    var sts = 'AWS4-HMAC-SHA256\n' + s.dt + '\n' + scope + '\n' + await sha256(canon);
    var sig = hex(await hmac(await signingKey(s.ymd), sts));
    var headers = { 'x-amz-date': s.dt, 'x-amz-content-sha256': bodyHash,
      'Authorization': 'AWS4-HMAC-SHA256 Credential=' + R2_ETC.accessKey + '/' + scope + ', SignedHeaders=' + signed + ', Signature=' + sig };
    if (contentType) headers['Content-Type'] = contentType;
    return { url: 'https://' + HOST + path, headers: headers };
  }

  // pre-signed GET link – works in <img>, <video>, <audio>, <a> with no public bucket
  async function signedGetUrl(key) {
    var s = stamp(), path = encPath(key), scope = s.ymd + '/auto/s3/aws4_request';
    var q = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=' + encodeURIComponent(R2_ETC.accessKey + '/' + scope) +
            '&X-Amz-Date=' + s.dt + '&X-Amz-Expires=' + URL_LIFE + '&X-Amz-SignedHeaders=host';
    var canon = ['GET', path, q, 'host:' + HOST + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    var sts = 'AWS4-HMAC-SHA256\n' + s.dt + '\n' + scope + '\n' + await sha256(canon);
    var sig = hex(await hmac(await signingKey(s.ymd), sts));
    return 'https://' + HOST + path + '?' + q + '&X-Amz-Signature=' + sig;
  }

  function mimeOf(name, fallback) { var e = String(name || '').split('.').pop().toLowerCase(); return R2_MIME[e] || fallback || 'application/octet-stream'; }
  function roleFolder() { return String(window.ETC_CHAT_ROLE || 'user').replace(/[^a-z]/g, ''); }
  function makeKey(file, category) {
    var safe = String(file.name || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_').substring(0, 80);
    var folder = String(category || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
    return R2_ETC.prefix + folder + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + safe;
  }
  function fail(e) { console.error('[R2] ' + (e && e.message || e)); return { success: false, error: (e && e.message) || String(e) }; }

  async function uploadFile(file, category) {
    try {
      if (!file) throw new Error('No file');
      var key = makeKey(file, category), ct = mimeOf(file.name, file.type), buf = await file.arrayBuffer();
      var r = await signRequest('PUT', key, ct, await sha256(buf));
      var res = await fetch(r.url, { method: 'PUT', headers: r.headers, body: buf });
      if (!res.ok) {
        var t = await res.text();
        throw new Error('R2 ' + ((t.match(/<Code>(.*?)<\/Code>/) || [])[1] || res.status) + ': ' + ((t.match(/<Message>(.*?)<\/Message>/) || [])[1] || res.statusText));
      }
      return { success: true, url: await signedGetUrl(key), fileUrl: undefined, fileName: file.name, fileType: ct, key: key, fileKey: key };
    } catch (e) { return fail(e); }
  }

  async function uploadFileWithProgress(file, category, onProgress) {
    try {
      if (!file) throw new Error('No file');
      var key = makeKey(file, category), ct = mimeOf(file.name, file.type), buf = await file.arrayBuffer();
      var r = await signRequest('PUT', key, ct, await sha256(buf));
      await new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest(); x.open('PUT', r.url);
        Object.keys(r.headers).forEach(function (h) { x.setRequestHeader(h, r.headers[h]); });
        if (x.upload && onProgress) x.upload.onprogress = function (ev) { if (ev.lengthComputable) onProgress(Math.round(ev.loaded / ev.total * 100)); };
        x.onload = function () { (x.status >= 200 && x.status < 300) ? resolve() : reject(new Error('R2 upload failed (' + x.status + ')')); };
        x.onerror = function () { reject(new Error('R2 network error – check the bucket CORS settings')); };
        x.send(buf);
      });
      return { success: true, url: await signedGetUrl(key), fileKey: key, key: key, fileType: ct, fileName: file.name };
    } catch (e) { return fail(e); }
  }

  async function deleteFile(key) {
    if (!key) return { success: false };
    try { var r = await signRequest('DELETE', key, null, EMPTY_SHA); var res = await fetch(r.url, { method: 'DELETE', headers: r.headers }); return { success: res.ok || res.status === 404 }; }
    catch (e) { console.warn('[R2] delete failed', e.message); return { success: false, error: e.message }; }
  }

  // key from any link we have produced (signed link, r2.dev link)
  function keyFromUrl(url) {
    try {
      var p = decodeURIComponent(new URL(url).pathname), b = '/' + R2_ETC.bucket + '/';
      if (p.indexOf(b) === 0) return p.slice(b.length);
      if (p.charAt(0) === '/') return p.slice(1);
    } catch (e) {}
    return null;
  }

  // Re-sign every file link older than 5 days in one chat path, e.g. refreshExpiredUrls('public_chat') or ('chats/uidA_uidB')
  async function refreshExpiredUrls(chatPath) {
    var _db = window.db; if (!_db || !chatPath) return;
    try {
      var snap = await _db.ref(chatPath).once('value'); if (!snap.exists()) return;
      var now = Date.now(), jobs = [];
      snap.forEach(function (c) {
        var m = c.val(); if (!m || !m.fileUrl) return;
        if (String(m.fileUrl).indexOf('blob:') === 0) return;                         // old local-only links can't be recovered
        var key = m.fileKey || keyFromUrl(m.fileUrl); if (!key) return;
        if (R2_ETC.prefix && key.indexOf(R2_ETC.prefix) !== 0 && !m.fileKey) return; // not an ETC file
        if (String(m.fileUrl).indexOf('X-Amz-') === -1 || now - (m.timestamp || m.ts || 0) >= REFRESH_AFTER_MS) jobs.push({ id: c.key, key: key });
      });
      for (var i = 0; i < jobs.length; i++) {
        try { await _db.ref(chatPath + '/' + jobs[i].id).update({ fileUrl: await signedGetUrl(jobs[i].key), fileKey: jobs[i].key }); }
        catch (e) { console.warn('[R2] could not refresh', jobs[i].id, e.message); }
      }
    } catch (e) { console.warn('[R2] refreshExpiredUrls', e.message); }
  }

  window.R2_ETC = { bucket: R2_ETC.bucket, prefix: R2_ETC.prefix };   // (secret stays inside this closure)
  window.R2_MIME = R2_MIME;
  window.R2_FORCE_DOWNLOAD = ["apk", "zip", "aia", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  window.getMimeFromName = function (n) { return mimeOf(n); };
  window.uploadFile = uploadFile;
  window.uploadFileWithProgress = uploadFileWithProgress;
  window.deleteFile = deleteFile;
  window.refreshExpiredUrls = refreshExpiredUrls;
  window.uploadToR2 = uploadFile;                       // old names kept so nothing else breaks
  window.deleteFromR2 = deleteFile;
  window.getR2SignedUrl = signedGetUrl;
  console.log('✅ ETC chat: Cloudflare R2 storage ready →', R2_ETC.bucket + '/' + R2_ETC.prefix);
})(window);
