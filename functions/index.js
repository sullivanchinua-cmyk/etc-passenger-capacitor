/**
 * Sends a push notification (FCM) to the recipient whenever a private chat message is created.
 * This is what makes the phone ring when the app is CLOSED.
 *
 * Chat data lives in Firestore:   etc_rtdb_chats/{chatId}/messages/{msgId}      (chatId = "<uidA>_<uidB>")
 * Phone tokens are saved here by the app (PUSH_MODE 'fcm'):   etc_rtdb_fcm_tokens/{uid}  { tokens: { <token>: {...} } }
 *
 * Triggers: private chat message, ticket updates by agents, dispute replies, fare changes.
 * Deploy:   firebase init functions   (pick this folder, JavaScript, do NOT overwrite index.js)
 *           firebase deploy --only functions
 * Needs the Blaze (pay-as-you-go) plan. Then set PUSH_MODE: 'fcm' in www/native/config.js.
 *
 * Change REGION if your Firestore database is not in us-central1 (e.g. europe-west1, nam5 = us-central1).
 */
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, FieldPath } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const REGION = 'us-central1';

function preview(m) {
  const ft = String(m.fileType || '');
  let t = String(m.text || m.message || '');
  if (m.viewOnce || /^image\//.test(ft)) return '📷 Photo';
  if (/^video\//.test(ft)) return '🎥 Video';
  if (/^audio\//.test(ft)) return t.startsWith('🎤') ? '🎤 Voice message' : '🎵 Audio';
  if (ft) return '📄 ' + (t || 'Document');
  if (t.length > 160) t = t.slice(0, 157) + '…';
  return t || 'New message';
}


/** Send one notification to every phone registered for a uid. Returns number of phones. */
async function sendToUid(uid, notification, data, channelId) {
  const db = getFirestore();
  const tokDoc = await db.collection('etc_rtdb_fcm_tokens').doc(uid).get();
  const tokens = Object.keys((tokDoc.exists && tokDoc.data().tokens) || {});
  if (!tokens.length) return 0;
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification,
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    android: { priority: 'high', notification: { channelId: channelId || 'alerts', sound: 'default', tag: data && data.tag ? String(data.tag) : undefined } }
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
  });
  await Promise.all(dead.map((t) =>
    db.collection('etc_rtdb_fcm_tokens').doc(uid).update(new FieldPath('tokens', t), FieldValue.delete()).catch(() => {})
  ));
  return tokens.length;
}

exports.notifyPrivateMessage = onDocumentCreated(
  { document: 'etc_rtdb_chats/{chatId}/messages/{msgId}', region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const m = snap.data() || {};
    if (!m.senderUid || m.senderUid === 'gemini' || m.isGemini) return;

    const recipient = event.params.chatId.split('_').find((id) => id && id !== m.senderUid);
    if (!recipient) return;

    const db = getFirestore();
    const tokDoc = await db.collection('etc_rtdb_fcm_tokens').doc(recipient).get();
    const tokens = Object.keys((tokDoc.exists && tokDoc.data().tokens) || {});
    if (!tokens.length) return;

    const name = m.senderName || 'New message';
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: name, body: preview(m) },
      data: { type: 'message', uid: String(m.senderUid), name: String(name) },
      android: {
        priority: 'high',
        notification: { channelId: 'messages', sound: 'default', tag: 'chat_' + m.senderUid }
      }
    });

    // drop tokens that are no longer valid
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
    });
    await Promise.all(dead.map((t) =>
      db.collection('etc_rtdb_fcm_tokens').doc(recipient).update(new FieldPath('tokens', t), FieldValue.delete())
    ));
  }
);


// ---------------- ticket updates made by agents (checked in, cancelled, refunded, seat released, seat/bus changed) ----------
exports.notifyTicketUpdate = onDocumentUpdated({ document: 'tickets/{ticketId}', region: REGION }, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const uid = after.ownerUid || after.firebaseUid;
  if (!uid) return;
  const id = event.params.ticketId;
  const route = 'ticket.html?id=' + encodeURIComponent(id);
  const st = String(after.status || '').toLowerCase();
  let title = null, body = null, r = route;

  const alertKey = (a) => (a ? String(a.type || '') + '|' + String(a.at || a.ts || a.message || '') : '');
  if (alertKey(after.passengerAlert) && alertKey(after.passengerAlert) !== alertKey(before.passengerAlert)) {
    const a = after.passengerAlert;
    if (a.type === 'seat_released') { title = '⚠️ Your seat was released'; body = a.message || 'You missed the bus. Tap to reschedule.'; r = 'events.html?reschedule=' + encodeURIComponent(id); }
    else { title = '🚌 Update on your ride'; body = a.message || 'The agent sent you an update.'; }
  } else if (st !== String(before.status || '').toLowerCase()) {
    if (st === 'boarded' || st === 'used') { title = '✅ You are checked in'; body = 'You are on board. Have a safe trip!'; }
    else if (['void', 'voided', 'cancelled', 'canceled'].includes(st)) { title = 'Ticket cancelled'; body = 'Your ticket was cancelled. Tap for details.'; }
    else if (st === 'refunded') { title = 'Refund processed'; body = 'Your refund has been processed.'; }
    else if (st === 'noshow' || st === 'no_show') { title = '⚠️ Seat released'; body = 'You missed the bus and your seat was released. Tap to reschedule.'; r = 'events.html?reschedule=' + encodeURIComponent(id); }
  } else if (String(after.seat || '') !== String(before.seat || '') || String(after.bus || after.busNo || '') !== String(before.bus || before.busNo || '')) {
    title = '🚌 Seat updated'; body = 'Seat ' + (after.seat || '-') + ((after.bus || after.busNo) ? ' · Bus ' + (after.bus || after.busNo) : '') + '. Tap to see your ticket.';
  }
  if (!title) return;
  await sendToUid(uid, { title, body }, { type: 'ticket', route: r, tag: 'tk_' + id }, 'tickets');
});

// ---------------- reply from the ETC team on a dispute ----------------
exports.notifyDisputeReply = onDocumentUpdated({ document: 'disputes/{disputeId}', region: REGION }, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const nb = Array.isArray(before.responses) ? before.responses.length : 0;
  const na = Array.isArray(after.responses) ? after.responses.length : 0;
  if (na <= nb || !after.uid) return;
  const last = after.responses[na - 1] || {};
  await sendToUid(after.uid, { title: '💬 ETC replied to your dispute', body: String(last.text || 'Tap to read the reply').slice(0, 140) },
    { type: 'alert', route: 'notifications.html', tag: 'dispute_' + event.params.disputeId + '_' + na }, 'alerts');
});

// ---------------- fare / price change published by the executive dashboard (sent to every registered phone) ----------------
exports.notifyFareChange = onDocumentUpdated({ document: 'config/fares', region: REGION }, async (event) => {
  const before = (event.data.before.data() || {}).routes || {};
  const after = (event.data.after.data() || {}).routes || {};
  const changes = Object.keys(after).filter((k) => before[k] != null && Number(before[k]) !== Number(after[k])).slice(0, 3);
  if (!changes.length) return;
  const fmt = (n) => '₦' + Number(n).toLocaleString('en-US');
  const body = changes.map((k) => k.replace('>', ' → ') + ': ' + fmt(before[k]) + ' → ' + fmt(after[k])).join('\n');
  const up = changes.some((k) => Number(after[k]) > Number(before[k]));
  const db = getFirestore();
  const snap = await db.collection('etc_rtdb_fcm_tokens').get();
  const tokens = [];
  snap.forEach((d) => Object.keys((d.data() || {}).tokens || {}).forEach((t) => tokens.push(t)));
  for (let i = 0; i < tokens.length; i += 500) {
    await getMessaging().sendEachForMulticast({
      tokens: tokens.slice(i, i + 500),
      notification: { title: up ? '📈 Fare update' : '📉 Fare update', body },
      data: { type: 'alert', route: 'index.html', tag: 'fares_' + Date.now() },
      android: { priority: 'high', notification: { channelId: 'alerts', sound: 'default' } }
    });
  }
});
