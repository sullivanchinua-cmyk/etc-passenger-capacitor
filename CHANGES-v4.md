# v4 - rendering, caching, keyboard, luggage, copy button

New / changed files
- www/js/render-guard.js  (NEW, loaded first on every page): base background, GPU layers, keyboard repaint
- www/js/spa.js           views for chat, chat list, chat room, history, AI, games; background preload; quiet re-show
- www/js/book.js          luggage overlay updates in place (no grid rebuild)
- www/css/styles.css      trunk bar uses transform
- www/css/tickets.css     .rc-pill = compact Copy pill
- www/sw.js               v11: chat files precached, saved pages shown instantly
- capacitor.config.json   backgroundColor #DCDDE0
- scripts/patch-android.js  sets native window background (run: npm run android:patch)

After unzipping: npm install, then   npm run sync   and   npm run android:patch   (once; safe to re-run), then rebuild the APK.
Add ?nopreload to index.html to turn background preloading off while testing.
