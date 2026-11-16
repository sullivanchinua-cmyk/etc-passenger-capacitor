package app.etc.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Schedules alarms with AlarmManager so they fire with the app closed, offline, in Doze and after a reboot.
 * Alarm object: { id, at (epoch ms), kind ("alarm" | "notif"), title, body, route }
 */
final class EtcAlarmScheduler {
    static final String ACTION_FIRE = "app.etc.alarm.FIRE";

    private EtcAlarmScheduler() {}

    private static AlarmManager am(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    private static PendingIntent firePending(Context c, JSONObject a, boolean create) {
        Intent i = new Intent(c, EtcAlarmReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra("id", a.optString("id"));
        i.putExtra("kind", a.optString("kind", "alarm"));
        i.putExtra("title", a.optString("title", "ETC"));
        i.putExtra("body", a.optString("body", ""));
        i.putExtra("route", a.optString("route", ""));
        int flags = PendingIntent.FLAG_IMMUTABLE | (create ? PendingIntent.FLAG_UPDATE_CURRENT : PendingIntent.FLAG_NO_CREATE);
        return PendingIntent.getBroadcast(c, a.optString("id").hashCode(), i, flags);
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT >= 31) {
            return am(c).canScheduleExactAlarms();
        }
        return true;
    }

    static void schedule(Context c, JSONObject a) {
        long at = a.optLong("at", 0);
        if (at <= 0) {
            return;
        }
        long now = System.currentTimeMillis();
        if (at < now + 1500) {
            at = now + 1500; // due or just missed: ring right away
        }
        PendingIntent pi = firePending(c, a, true);
        AlarmManager am = am(c);
        if ("alarm".equals(a.optString("kind", "alarm"))) {
            // Alarm-clock alarms are always exact, wake the phone, and show the alarm icon in the status bar.
            PendingIntent show = EtcNotifier.openApp(c, a.optString("route", ""), 7);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
        } else if (canExact(c)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancel(Context c, JSONObject a) {
        PendingIntent pi = firePending(c, a, false);
        if (pi != null) {
            am(c).cancel(pi);
            pi.cancel();
        }
    }

    /** Same as replaceAll but keeps alarms that were snoozed on the phone (they are not known to the web layer). */
    static int sync(Context c, JSONArray wanted) {
        JSONArray merged = new JSONArray();
        for (int i = 0; i < wanted.length(); i++) {
            merged.put(wanted.opt(i));
        }
        JSONArray old = EtcAlarmStore.getAlarms(c);
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null && o.optString("id").endsWith("~snooze")) {
                merged.put(o);
            }
        }
        return replaceAll(c, merged);
    }

    /** Make the scheduled set equal to `wanted` (cancels removed alarms, schedules new/changed ones). */
    static int replaceAll(Context c, JSONArray wanted) {
        JSONArray old = EtcAlarmStore.getAlarms(c);
        long now = System.currentTimeMillis();
        JSONArray keep = new JSONArray();
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null) {
                cancel(c, o);
            }
        }
        for (int i = 0; i < wanted.length(); i++) {
            JSONObject a = wanted.optJSONObject(i);
            if (a == null || a.optString("id").length() == 0) {
                continue;
            }
            if (a.optLong("at", 0) < now - 10 * 60 * 1000L) {
                continue; // older than 10 minutes: already gone
            }
            schedule(c, a);
            keep.put(a);
        }
        EtcAlarmStore.putAlarms(c, keep);
        return keep.length();
    }

    static void cancelAll(Context c) {
        replaceAll(c, new JSONArray());
    }

    /** After reboot / app update / clock change. */
    static void rescheduleAll(Context c) {
        JSONArray cur = EtcAlarmStore.getAlarms(c);
        replaceAll(c, cur);
    }

    /** Ring again later (snooze). */
    static void snooze(Context c, String id, String kind, String title, String body, String route, long minutes) {
        try {
            JSONObject a = new JSONObject();
            a.put("id", id + "~snooze");
            a.put("at", System.currentTimeMillis() + minutes * 60_000L);
            a.put("kind", kind);
            a.put("title", title);
            a.put("body", body);
            a.put("route", route);
            JSONArray cur = EtcAlarmStore.getAlarms(c);
            cur.put(a);
            EtcAlarmStore.putAlarms(c, cur);
            schedule(c, a);
        } catch (Exception ignored) {
            // nothing to do
        }
    }
}
