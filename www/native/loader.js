/**
 * One tag per page loads the whole native layer, in the right order.
 * <script src="js/native/loader.js"></script>   (after hybrid-config.js)
 */
(function () {
  var cur = document.currentScript;
  var base = cur.src.replace(/loader\.js(\?.*)?$/, '');
  // inside a cached view (see js/spa.js) the shell already runs the native layer: only mirror this view's storage writes
  var list = window.__etcChild
    ? ['offline-kv.js']
    : ['config.js', 'native-core.js', 'sqlite-store.js', 'offline-kv.js', 'notifications.js', 'alarm-bridge.js', 'setup.js', 'deeplink.js'];
  list.forEach(function (f) {
    document.write('<script src="' + base + f + '"><\/script>');
  });
})();
