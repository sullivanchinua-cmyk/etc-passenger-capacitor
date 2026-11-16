// ONE-TIME step (needs internet): downloads the remote pictures the app uses (chat wallpapers from Unsplash,
// avatars) into www/assets/remote and rewrites the links, so they show with no internet.
//   npm run localize
//   node scripts/localize-remote.js --hosts images.unsplash.com,i.pravatar.cc,api.dicebear.com
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', 'www');
const arg = process.argv.indexOf('--hosts');
const hosts = (arg > -1 ? process.argv[arg + 1] : 'images.unsplash.com,i.pravatar.cc,api.dicebear.com').split(',');
const outDir = path.join(root, 'assets', 'remote');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const urlRe = new RegExp('https?://(?:' + hosts.map(esc).join('|') + ')[^"\'\\s)\\\\<>]*', 'g');

function walk(dir, out) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!['vendor', 'remote', 'node_modules'].includes(f.name)) walk(p, out); }
    else if (/\.(html|js|css)$/.test(f.name)) out.push(p);
  }
  return out;
}
const extFor = (ct, url) => {
  if (/svg/.test(ct)) return '.svg';
  if (/png/.test(ct)) return '.png';
  if (/webp/.test(ct)) return '.webp';
  if (/gif/.test(ct)) return '.gif';
  if (/jpe?g/.test(ct)) return '.jpg';
  const m = /\.(jpe?g|png|webp|gif|svg)(\?|$)/i.exec(url);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
};

(async () => {
  const files = walk(root, []);
  const found = new Map();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.match(urlRe) || []) found.set(m, true);
  }
  console.log('[localize] remote pictures found:', found.size);
  fs.mkdirSync(outDir, { recursive: true });
  const map = new Map();
  for (const url of found.keys()) {
    const key = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
    const existing = fs.readdirSync(outDir).find((n) => n.startsWith(key + '.'));
    if (existing) { map.set(url, existing); continue; }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const name = key + extFor(res.headers.get('content-type') || '', url);
      fs.writeFileSync(path.join(outDir, name), buf);
      map.set(url, name);
      console.log('  ok  ', name, url.slice(0, 70));
    } catch (e) {
      console.warn('  FAIL', url.slice(0, 70), e.message);
    }
  }
  let rewritten = 0;
  for (const f of files) {
    let s = fs.readFileSync(f, 'utf8'), changed = false;
    s = s.replace(urlRe, (u) => {
      if (!map.has(u)) return u;
      changed = true;
      // JS strings are resolved against the PAGE, so use a root path; HTML/CSS can use a relative path.
      if (f.endsWith('.js')) return '/assets/remote/' + map.get(u);
      return path.relative(path.dirname(f), path.join(outDir, map.get(u))).split(path.sep).join('/');
    });
    if (changed) { fs.writeFileSync(f, s); rewritten++; }
  }
  console.log('[localize] files rewritten:', rewritten, '| downloaded:', map.size + '/' + found.size);
})();
