package app.etc.alarm;

import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * EtcAlarm - native alarms, reminders and the background listener.
 *
 *  sync({alarms})        schedule exactly this list of alarms (works offline, survives reboot)
 *  cancelAll()
 *  status()              which permissions / settings are in place
 *  requestExactAlarm()   open "Alarms & reminders" settings (Android 12+)
 *  requestFullScreen()   open "Full screen notifications" settings (Android 14+)
 *  requestBattery()      ask to ignore battery optimisation
 *  openAutostart()       open the phone maker's auto-start / background screen
 *  openNotificationSettings()
 *  startKeepAlive() / stopKeepAlive()   background listener foreground service
 *  ringNow({kind,title,body,delayMs})   test
 *  stopRinging()
 *  consumeLaunchRoute()  the page a tapped alarm/notification wants to open
 */
@CapacitorPlugin(name = "EtcAlarm")
public class EtcAlarmPlugin extends Plugin {

    @Override
    public void load() {
        EtcNotifier.ensureChannels(getContext());
        captureRoute(getActivity() == null ? null : getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String route = captureRoute(intent);
        if (route != null && route.length() > 0) {
            JSObject o = new JSObject();
            o.put("route", route);
            notifyListeners("launchRoute", o, true);
        }
    }

    private String captureRoute(Intent intent) {
        if (intent == null) {
            return null;
        }
        String route = intent.getStringExtra(EtcNotifier.EXTRA_ROUTE);
        if (route != null && route.length() > 0) {
            EtcAlarmStore.setPendingRoute(getContext(), route);
            intent.removeExtra(EtcNotifier.EXTRA_ROUTE);
        }
        return route;
    }

    // ------------------------------------------------------------------ alarms

    @PluginMethod
    public void sync(PluginCall call) {
        try {
            JSArray alarms = call.getArray("alarms");
            JSONArray wanted = alarms == null ? new JSONArray() : alarms;
            int n = EtcAlarmScheduler.sync(getContext(), wanted);
            JSObject res = new JSObject();
            res.put("scheduled", n);
            res.put("exact", EtcAlarmScheduler.canExact(getContext()));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("sync failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        EtcAlarmScheduler.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void ringNow(PluginCall call) {
        try {
            long delay = call.getLong("delayMs", 1500L);
            JSONObject a = new JSONObject();
            a.put("id", "test-" + System.currentTimeMillis());
            a.put("at", System.currentTimeMillis() + delay);
            a.put("kind", call.getString("kind", "alarm"));
            a.put("title", call.getString("title", "ETC test alarm"));
            a.put("body", call.getString("body", "This is how your alarm will ring."));
            a.put("route", "index.html?cal=1");
            JSONArray cur = EtcAlarmStore.getAlarms(getContext());
            cur.put(a);
            EtcAlarmStore.putAlarms(getContext(), cur);
            EtcAlarmScheduler.schedule(getContext(), a);
            call.resolve();
        } catch (Exception e) {
            call.reject("ringNow failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        Intent i = new Intent(getContext(), EtcAlarmService.class);
        i.setAction(EtcAlarmService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }

    // ------------------------------------------------------------------ permissions / settings

    private JSObject statusObject() {
        Context c = getContext();
        NotificationManager nm = EtcNotifier.nm(c);
        JSObject o = new JSObject();
        o.put("notifications", nm.areNotificationsEnabled());
        o.put("exactAlarm", EtcAlarmScheduler.canExact(c));
        boolean fs = true;
        if (Build.VERSION.SDK_INT >= 34) {
            fs = nm.canUseFullScreenIntent();
        }
        o.put("fullScreen", fs);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("batteryIgnored", pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        o.put("keepAlive", EtcAlarmStore.keepAlive(c));
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    private boolean start(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private Uri pkg() {
        return Uri.parse("package:" + getContext().getPackageName());
    }

    @PluginMethod
    public void requestExactAlarm(PluginCall call) {
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= 31) {
            ok = start(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg()));
        }
        JSObject o = new JSObject();
        o.put("opened", ok);
        call.resolve(o);
    }

    @PluginMethod
    public void requestFullScreen(PluginCall call) {
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= 34) {
            ok = start(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg()));
        }
        JSObject o = new JSObject();
        o.put("opened", ok);
        call.resolve(o);
    }

    @PluginMethod
    public void requestBattery(PluginCall call) {
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= 23) {
            ok = start(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg()));
            if (!ok) {
                ok = start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
        }
        JSObject o = new JSObject();
        o.put("opened", ok);
        call.resolve(o);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i;
        if (Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg());
        }
        JSObject o = new JSObject();
        o.put("opened", start(i));
        call.resolve(o);
    }

    /** Phone makers hide an "auto-start" / "background" switch that can kill the app. Try their screens, then App info. */
    @PluginMethod
    public void openAutostart(PluginCall call) {
        String[][] known = new String[][] {
            { "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },
            { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
            { "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },
            { "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
            { "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity" },
            { "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
            { "com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity" },
            { "com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity" }
        };
        boolean ok = false;
        for (String[] k : known) {
            Intent i = new Intent();
            i.setComponent(new ComponentName(k[0], k[1]));
            if (start(i)) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            ok = start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg()));
        }
        JSObject o = new JSObject();
        o.put("opened", ok);
        call.resolve(o);
    }

    // ------------------------------------------------------------------ background listener

    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        try {
            EtcAlarmStore.setKeepAlive(getContext(), true);
            Intent svc = new Intent(getContext(), EtcKeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                getContext().startForegroundService(svc);
            } else {
                getContext().startService(svc);
            }
            call.resolve(statusObject());
        } catch (Exception e) {
            call.reject("startKeepAlive failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        EtcAlarmStore.setKeepAlive(getContext(), false);
        getContext().stopService(new Intent(getContext(), EtcKeepAliveService.class));
        call.resolve(statusObject());
    }

    // ------------------------------------------------------------------ routing

    @PluginMethod
    public void consumeLaunchRoute(PluginCall call) {
        JSObject o = new JSObject();
        o.put("route", EtcAlarmStore.takePendingRoute(getContext()));
        call.resolve(o);
    }
}
