// Makes the app work with NO internet. Runs after `npm install` and before every `cap sync`.
//   - compiles Tailwind to www/css/tailwind.css (the pages used the Tailwind CDN before)
//   - copies Firebase SDK, Leaflet, jsPDF, QR, Dexie and the Plus Jakarta Sans font into www/vendor
// Anything missing is only a warning: the pages fall back to the CDN while online.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const www = (...p) => path.join(root, 'www', ...p);
let ok = 0, miss = 0;

function copy(label, candidates, dest) {
  const src = candidates.find((c) => fs.existsSync(c));
  if (!src) { console.warn('[offline] missing:', label); miss++; return false; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  ok++;
  return true;
}
function copyDir(label, srcDir, destDir) {
  if (!fs.existsSync(srcDir)) { console.warn('[offline] missing:', label); miss++; return; }
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  ok++;
}

// ---- Firebase (v10 compat) -------------------------------------------------
for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js', 'firebase-database-compat.js']) {
  copy('firebase/' + f, [nm('firebase', f), nm('firebase', 'dist', f)], www('vendor', 'v10', f));
}

// ---- Libraries the pages load ----------------------------------------------
copy('leaflet.js', [nm('leaflet', 'dist', 'leaflet.js')], www('vendor', 'leaflet', 'leaflet.js'));
copy('leaflet.css', [nm('leaflet', 'dist', 'leaflet.css')], www('vendor', 'leaflet', 'leaflet.css'));
copyDir('leaflet images', nm('leaflet', 'dist', 'images'), www('vendor', 'leaflet', 'images'));
copy('jspdf', [nm('jspdf', 'dist', 'jspdf.umd.min.js')], www('vendor', 'jspdf.umd.min.js'));
copy('qrcodejs', [nm('qrcodejs', 'qrcode.min.js')], www('vendor', 'qrcode.min.js'));
copy('dexie', [nm('dexie', 'dist', 'dexie.min.js')], www('vendor', 'dexie.min.js'));

// ---- Plus Jakarta Sans (latin + latin-ext, includes the Naira sign) ----------------
const RANGES = {
  'latin': 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
};
let css = '';
for (const w of [400, 500, 600, 700, 800]) {
  for (const subset of ['latin-ext', 'latin']) {
    const file = `plus-jakarta-sans-${subset}-${w}-normal.woff2`;
    if (copy('font ' + file, [nm('@fontsource', 'plus-jakarta-sans', 'files', file)], www('vendor', 'fonts', file))) {
      css += `@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-display:swap;font-weight:${w};src:url(${file}) format('woff2');unicode-range:${RANGES[subset]}}\n`;
    }
  }
}
if (css) { fs.mkdirSync(www('vendor', 'fonts'), { recursive: true }); fs.writeFileSync(www('vendor', 'fonts', 'plus-jakarta-sans.css'), css); }

// ---- Tailwind ---------------------------------------------------------------
try {
  const cli = require.resolve('tailwindcss/lib/cli.js', { paths: [root] });
  fs.mkdirSync(www('css'), { recursive: true });
  execFileSync(process.execPath, [cli, '-c', path.join(root, 'tailwind.config.js'), '-i', path.join(root, 'tailwind-input.css'), '-o', www('css', 'tailwind.css'), '--minify'], { cwd: root, stdio: 'pipe' });
  console.log('[offline] tailwind.css built (' + Math.round(fs.statSync(www('css', 'tailwind.css')).size / 1024) + ' kB)');
  ok++;
} catch (e) {
  console.warn('[offline] tailwind build failed (CDN fallback will be used):', String(e.stderr || e.message).split('\n')[0]);
  miss++;
}

console.log('[offline] done: ' + ok + ' ok, ' + miss + ' missing');
