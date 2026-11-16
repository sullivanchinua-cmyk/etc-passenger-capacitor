/* ETC native alarm bridge
 * In the Capacitor app the alarm bridge lives in native/alarm-bridge.js (loaded on every page) and talks to the
 * EtcAlarm plugin. This file stays only so the page's <script> tag keeps working; in a normal browser there is no
 * native alarm and window.ETC_NativeAlarm.isNative() is false.
 */
(function () {
  if (window.ETC_NativeAlarm) return;
  window.ETC_NativeAlarm = { isNative: function () { return false; }, handles: function () { return false; }, sync: function () { return false; } };
})();
