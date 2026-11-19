// Run ONCE after `npx cap add android`  (npm run android:patch)
// Adds the permissions and notification settings the app needs to AndroidManifest.xml.
//   --play-store   leaves out MANAGE_EXTERNAL_STORAGE ("All files access")
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  console.error('android/ folder not found. Run:  npx cap add android');
  process.exit(1);
}
const playStore = process.argv.includes('--play-store');
let xml = fs.readFileSync(manifestPath, 'utf8');

const perms = [
  'android.permission.INTERNET',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_CONTACTS'
];
if (!playStore) perms.push('android.permission.MANAGE_EXTERNAL_STORAGE');

const add = [];
for (const p of perms) {
  if (!xml.includes('android:name="' + p + '"')) add.push('    <uses-permission android:name="' + p + '" />');
}
if (!xml.includes('android:name="android.permission.READ_EXTERNAL_STORAGE"')) {
  add.push('    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />');
}
if (!xml.includes('android.hardware.camera')) {
  add.push('    <uses-feature android:name="android.hardware.camera" android:required="false" />');
  add.push('    <uses-feature android:name="android.hardware.microphone" android:required="false" />');
}
if (add.length) {
  xml = xml.replace('</manifest>', '\n    <!-- ETC Chat -->\n' + add.join('\n') + '\n</manifest>');
}

const channelMeta = 'com.google.firebase.messaging.default_notification_channel_id';
if (!xml.includes(channelMeta)) {
  xml = xml.replace('</application>',
    '    <meta-data android:name="' + channelMeta + '" android:value="messages" />\n    </application>');
}

// notification icon for Firebase pushes (white bus silhouette from resources/android/res/drawable)
const fcmIcon = 'com.google.firebase.messaging.default_notification_icon';
if (!xml.includes(fcmIcon)) {
  xml = xml.replace('</application>',
    '    <meta-data android:name="' + fcmIcon + '" android:resource="@drawable/ic_stat_etc" />\n    </application>');
}

// ---------------------------------------------------------------------------
// Ticket links open the app (like a TikTok link)
//   https://<SHARE_BASE_URL host>/ticket.html#d=...   -> Android App Link (autoVerify)
//   etcbus://ticket?d=...                              -> fallback scheme ("Open in ETC app" button on the web page)
// MainActivity MUST be launchMode="singleTask": a tapped link then reuses the running app instead of
// stacking a second Activity/WebView on top (that was the open/close flicker of the earlier attempt).
// www/native/deeplink.js receives the link (Capacitor appUrlOpen / getLaunchUrl) and opens the ticket.
// ---------------------------------------------------------------------------
(function () {
  let host = '';
  try {
    const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'www', 'native', 'config.js'), 'utf8');
    const m = /SHARE_BASE_URL:\s*['"]([^'"]+)['"]/.exec(cfgSrc);
    if (m) host = new URL(m[1]).host;
  } catch (e) {}
  const am = /<activity\b[^>]*android:name="[^"]*MainActivity"[^>]*>/.exec(xml);
  if (!am) { console.warn('MainActivity not found in AndroidManifest.xml - ticket links NOT registered.'); return; }
  let tag = am[0];
  if (/android:launchMode="[^"]*"/.test(tag)) tag = tag.replace(/android:launchMode="[^"]*"/, 'android:launchMode="singleTask"');
  else tag = tag.replace('<activity', '<activity android:launchMode="singleTask"');
  xml = xml.replace(am[0], tag);
  if (xml.includes('android:scheme="etcbus"')) return;
  const filters =
    (host
      ? '\n            <intent-filter android:autoVerify="true">\n' +
        '                <action android:name="android.intent.action.VIEW" />\n' +
        '                <category android:name="android.intent.category.DEFAULT" />\n' +
        '                <category android:name="android.intent.category.BROWSABLE" />\n' +
        '                <data android:scheme="https" android:host="' + host + '" android:pathPrefix="/ticket.html" />\n' +
        '            </intent-filter>'
      : '') +
    '\n            <intent-filter>\n' +
    '                <action android:name="android.intent.action.VIEW" />\n' +
    '                <category android:name="android.intent.category.DEFAULT" />\n' +
    '                <category android:name="android.intent.category.BROWSABLE" />\n' +
    '                <data android:scheme="etcbus" />\n' +
    '            </intent-filter>\n        ';
  const start = xml.indexOf(tag);
  const end = xml.indexOf('</activity>', start);
  if (end < 0) return;
  xml = xml.slice(0, end) + filters + xml.slice(end);
  console.log('Ticket links registered' + (host ? ' for https://' + host + '/ticket.html' : '') + ' + etcbus://');
})();

fs.writeFileSync(manifestPath, xml);
console.log('AndroidManifest.xml patched (' + add.length + ' entries added' + (playStore ? ', Play Store mode' : '') + ').');


// ---------------------------------------------------------------------------
// Firebase file + launcher icons + Google-services Gradle plugin
// ---------------------------------------------------------------------------
const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const appDir = path.join(androidDir, 'app');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

// 1) google-services.json  (resources/ -> android/app/)
const gsSrc = path.join(root, 'resources', 'google-services.json');
const gs = path.join(appDir, 'google-services.json');
if (fs.existsSync(gsSrc)) {
  fs.copyFileSync(gsSrc, gs);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  const pkgs = (JSON.parse(fs.readFileSync(gs, 'utf8')).client || [])
    .map(c => c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name);
  if (!pkgs.includes(cfg.appId)) {
    console.error('google-services.json has package ' + pkgs.join(', ') + ' but capacitor.config.json appId is ' + cfg.appId + '. They must match.');
    process.exit(1);
  }
  console.log('google-services.json installed (package ' + cfg.appId + ').');
} else {
  console.log('\nNote: resources/google-services.json is missing - Firebase push will not work.');
}

// 2) launcher icons  (resources/android/res -> android/app/src/main/res)
const iconSrc = path.join(root, 'resources', 'android', 'res');
const resDir = path.join(appDir, 'src', 'main', 'res');
if (fs.existsSync(iconSrc)) {
  // remove the default Capacitor icon files so only ours remain
  for (const f of [
    'drawable/ic_launcher_background.xml',
    'drawable-v24/ic_launcher_foreground.xml'
  ]) {
    const fp = path.join(resDir, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  // drop default ic_launcher* images in any format (.webp next to our .png would be a duplicate resource)
  for (const d of fs.existsSync(resDir) ? fs.readdirSync(resDir) : []) {
    if (!d.startsWith('mipmap-')) continue;
    for (const f of fs.readdirSync(path.join(resDir, d))) {
      if (/^ic_launcher.*\.(png|webp|jpg|xml)$/.test(f)) fs.unlinkSync(path.join(resDir, d, f));
    }
  }
  copyDir(iconSrc, resDir);
  console.log('Launcher icons installed.');
}

// 3) Google-services Gradle plugin (only needed if the Capacitor template did not already add it)
const rootGradle = path.join(androidDir, 'build.gradle');
const appGradle = path.join(appDir, 'build.gradle');
if (fs.existsSync(gs) && fs.existsSync(rootGradle) && fs.existsSync(appGradle)) {
  let rg = fs.readFileSync(rootGradle, 'utf8');
  if (!rg.includes('com.google.gms:google-services')) {
    rg = rg.replace(/(buildscript\s*\{[\s\S]*?dependencies\s*\{)/,
      "$1\n        classpath 'com.google.gms:google-services:4.4.2'");
    fs.writeFileSync(rootGradle, rg);
    console.log('Added google-services classpath to android/build.gradle.');
  }
  let ag = fs.readFileSync(appGradle, 'utf8');
  if (!ag.includes('com.google.gms.google-services')) {
    ag += "\napply plugin: 'com.google.gms.google-services'\n";
    fs.writeFileSync(appGradle, ag);
    console.log('Applied google-services plugin in android/app/build.gradle.');
  }
}


// ---------------------------------------------------------------------------
// 4) No white flash / white strip: paint the native window + WebView in the app's base colour.
//    The white bar that showed at the bottom while the keyboard closed was the Activity window background
//    (white by default) peeking through until the WebView finished resizing. #DCDDE0 = www/js/render-guard.js BG.
//    Idempotent - safe to run again.
// ---------------------------------------------------------------------------
(function () {
  const BG = '#DCDDE0';
  const valuesDir = path.join(resDir, 'values');
  if (!fs.existsSync(valuesDir)) { console.warn('res/values not found - window background NOT patched.'); return; }
  fs.writeFileSync(path.join(valuesDir, 'etc_colors.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="etc_window_bg">' + BG + '</color>\n</resources>\n');
  const stylesPath = path.join(valuesDir, 'styles.xml');
  if (!fs.existsSync(stylesPath)) { console.warn('styles.xml not found - window background NOT patched.'); return; }
  let st = fs.readFileSync(stylesPath, 'utf8');
  let n = 0;
  // every non-launch theme gets the window background (the splash theme keeps its own)
  st = st.replace(/(<style\s+name="AppTheme(?:\.NoActionBar)?"[^>]*>)([\s\S]*?)(<\/style>)/g, (m, open, body, close) => {
    if (/name="android:windowBackground"/.test(body)) {
      n++;
      return open + body.replace(/(<item\s+name="android:windowBackground">)[^<]*(<\/item>)/, '$1@color/etc_window_bg$2') + close;
    }
    n++;
    return open + '\n        <item name="android:windowBackground">@color/etc_window_bg</item>' + body + close;
  });
  fs.writeFileSync(stylesPath, st);
  console.log('Window background set to ' + BG + ' in ' + n + ' theme(s).');
})();
