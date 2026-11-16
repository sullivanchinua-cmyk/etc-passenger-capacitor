# ETC Chat – Firebase wiring

The chat uses **Firebase Realtime Database** in the same project as the other ETC apps (`enugu-transport-corporation`).
Create it once in the Firebase console (Build → Realtime Database), then paste `database.rules.json` from the `etc-firebase-rules` folder.

**Account:** the chat is signed in as the account that opened the app (the host app saves the Firebase uid via `js/chat-bridge.js`; the chat and the app share the same origin, so the Firebase session is shared).
Name, e-mail, role (passenger / agent / executive) and agent terminal come from that account and are written to `users/{uid}`.
Logging out is done in the main app – the chat never signs you out of it.

**Who can chat with whom:** everybody – passengers, agents and executives can find and message each other, and share one public room.
The first message in a 1-to-1 chat automatically makes the two people friends, so the conversation shows in both Friends lists. Direct messages are `chats/{uidA_uidB}`.

## File storage — Cloudflare R2 (Firebase Storage is NOT used)

Photos, videos, voice notes, documents and stickers are uploaded to **Cloudflare R2** by `js/r2-storage.js`
(its own file, separate from the Firebase wiring in `js/hybrid-config.js`). The chat saves only the link
and `fileKey` in the Realtime Database message.

* ETC files live under the folder `etc-chat/…` in the bucket, so they never mix with other apps' files.
* To use a dedicated ETC bucket / API token, edit ONLY the `R2_ETC` block at the top of `js/r2-storage.js`.
* The bucket needs a **CORS policy** that allows your app origins (GET, PUT, DELETE, HEAD; headers `*`). Without it, uploads fail in the browser with a network error.
* Links are pre-signed for 7 days; `refreshExpiredUrls('<chat path>')` re-signs links older than 5 days when a chat opens.
