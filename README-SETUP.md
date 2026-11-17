# Enugu Smart Bus + Coal City Chat – Capacitor (Android)

The whole passenger app is wrapped, with the chat inside it (`www/chat/`): the chat takes its signed-in user from the passenger app.
Requirements: **Node 22+**, **Android Studio** (JDK 21 bundled), Android SDK 36, internet for the first `npm install`.

## Build
```bash
npm install                 # Capacitor + plugins; builds Tailwind CSS, copies Firebase/Leaflet/jsPDF/QR/fonts into www/vendor
npm run localize            # ONE time (needs internet): downloads remote pictures (chat wallpapers, avatars) into www/assets/remote
npx cap add android
npm run android:patch       # permissions + notification channel in AndroidManifest.xml
npx cap sync android
npx cap open android        # Android Studio -> Build > Build APK(s)
```
After any change in `www/`: `npx cap sync android` (it rebuilds the offline files first).
`appId` = `enugubustransit.com` (must match the package name in `resources/google-services.json`). It is a different id from the old TWA, so it installs as a new app.
`npm run android:patch` also copies `resources/google-services.json` and the launcher icons (`resources/android/res`) into `android/` and wires the Google-services Gradle plugin. CI: `.github/workflows/android-debug.yml`.

## 1) Notifications – every place, real Android notification (sound + notification panel)
| Source | Where it comes from |
|---|---|
| Ticket booked ("Your ticket is ready") | `ETC_Push.ticket` – now works on ALL pages (before, only the home page had it) |
| Agent updates: checked in, cancelled, refunded, seat released, seat / bus changed, passenger alerts | live ticket listeners (`native/notifications.js`) |
| "Your bus leaves in 1 hour", "Running late?" 5 min after departure | scheduled on the phone, work offline |
| 10 / 5 minute pre-departure alarms | native alarms (below) |
| Calendar alarms and reminders (calendar icon on home) | native alarms (below) |
| Replies from the ETC team on your disputes | `js/dispute-replies.js` |
| Fare / price changes | `js/fares-live.js` |
| "Bus in N min" and every other `new Notification(...)` in the old code | shimmed to Android notifications |
| Chat messages | Firestore listeners |
All also appear on the in-app bell. Channels: Messages, Tickets & rides, Alerts. (`ETC_Push.occupancy` "bus almost full" exists in the code but nothing calls it yet.)

## 2) Alarms – rings violently, online or offline
`plugins/etc-alarm` (Java) schedules every alarm in `etc_alarms` with AlarmManager (exact alarm-clock alarms): they fire with the app closed,
no internet, in Doze, and after a reboot. The phone loops the alarm sound at **full alarm volume**, vibrates in a strong repeating pattern,
wakes the screen and shows a full-screen **Dismiss / Snooze 5 min** screen over the lock screen (3 minutes max, then a "Missed alarm" notification).
Reminders (notification-only items) ring the notification sound and stay in the panel. Tap an alarm notification: opens the calendar.

## 3) Offline
* App files, Tailwind (compiled), fonts, Firebase, Leaflet, jsPDF, QR, Dexie and Plus Jakarta Sans are bundled; no service worker or CDN needed.
* Chats: all messages in SQLite (`etc_chat_messages`), Firestore offline cache for the chat so it opens and queues sends.
* Passenger data (tickets, notes, profile, alarms, settings) is mirrored to SQLite and restored if the WebView storage is ever wiped.
* Still needs internet by nature: map tiles, live data refresh, uploading photos/files, AI.

## 4) Background listeners + permissions (setup screen)
On first launch (and from the notifications page / alarm sheet) a setup screen walks through: notifications, exact alarms, alarm over lock screen,
ignore battery optimisation, **background listener** (a small silent foreground-service notification keeps ETC listening while the app is in the
background) and the phone maker's auto-start screen (Tecno / Infinix / itel / Xiaomi / Oppo / Vivo often kill background apps).
Closed-app delivery for online events: set `PUSH_MODE: 'fcm'` in `www/native/config.js`, add `android/app/google-services.json`
(Firebase console > Add Android app with the same package id), deploy `functions/` (`firebase deploy --only functions`, Blaze plan).
It pushes chat messages, ticket updates, dispute replies and fare changes. Don't switch to `'fcm'` before `google-services.json` exists.
Firestore rule for tokens (collection `etc_rtdb_fcm_tokens`): `allow write: if request.auth != null && request.auth.uid == docId;`

## Keep in mind
1. **Secrets**: `chat/js/r2-storage.js` and the Gemini files hold Cloudflare R2 and Gemini keys; they can be extracted from the APK. Rotate and move behind a server.
2. R2 CORS must allow `https://localhost`.
3. Notification small icon is the app icon; add a white-on-transparent icon later for a cleaner status bar.
4. Not run on a real phone yet (no Android SDK here). Java was compile-checked against stubs; the JavaScript, SQLite logic, setup screen and
   notification/alarm bridges were tested with simulated plugins. Test an alarm with the "Test alarm" button, then report anything odd.

## Fixes round 2
* **Safe area**: `SAFE_AREA_PADDING: true` in `www/native/config.js` (pages no longer sit under the status / navigation bar).
* **Phone contacts** in the chat attach menu come from the native DeviceFiles plugin (asks for the Contacts permission).
* **Notification icon**: white bus silhouette (`resources/android/res/drawable/ic_stat_etc.xml`) + full-colour app icon as large icon.
* **Receipt**: Copy buttons for the payment ref and the ticket ref.
* **Ticket links**: `SHARE_BASE_URL` in `www/native/config.js` is the public web address. Links look like `<SHARE_BASE_URL>/ticket.html#d=...`.
  `npm run android:patch` registers that host (App Link) and `etcbus://` in the manifest. Deploy `www/.well-known/assetlinks.json` with the site.
  It holds the fingerprint of `resources/debug.keystore` (the workflow signs debug builds with it). A release keystore needs its own fingerprint added there.
