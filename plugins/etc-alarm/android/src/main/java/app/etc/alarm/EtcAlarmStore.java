package app.etc.alarm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Tiny persistent store (SharedPreferences) so alarms survive reboot and app updates. */
final class EtcAlarmStore {
    private static final String PREFS = "etc_alarm_store";
    private static final String KEY_ALARMS = "alarms";
    private static final String KEY_KEEPALIVE = "keepalive";
    private static final String KEY_ROUTE = "pending_route";

    private EtcAlarmStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray getAlarms(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY_ALARMS, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static void putAlarms(Context c, JSONArray arr) {
        prefs(c).edit().putString(KEY_ALARMS, arr.toString()).apply();
    }

    static void remove(Context c, String id) {
        JSONArray cur = getAlarms(c);
        JSONArray next = new JSONArray();
        for (int i = 0; i < cur.length(); i++) {
            JSONObject o = cur.optJSONObject(i);
            if (o != null && !id.equals(o.optString("id"))) {
                next.put(o);
            }
        }
        putAlarms(c, next);
    }

    static boolean keepAlive(Context c) {
        return prefs(c).getBoolean(KEY_KEEPALIVE, false);
    }

    static void setKeepAlive(Context c, boolean on) {
        prefs(c).edit().putBoolean(KEY_KEEPALIVE, on).apply();
    }

    static void setPendingRoute(Context c, String route) {
        prefs(c).edit().putString(KEY_ROUTE, route == null ? "" : route).apply();
    }

    static String takePendingRoute(Context c) {
        String r = prefs(c).getString(KEY_ROUTE, "");
        prefs(c).edit().remove(KEY_ROUTE).apply();
        return r == null ? "" : r;
    }
}
