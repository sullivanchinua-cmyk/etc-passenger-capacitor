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
