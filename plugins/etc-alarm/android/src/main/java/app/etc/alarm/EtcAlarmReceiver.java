package app.etc.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Fires when AlarmManager says it is time. Works with the app closed and no internet. */
public class EtcAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        String kind = intent.getStringExtra("kind");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String route = intent.getStringExtra("route");
        if (id == null) {
            return;
        }
        EtcAlarmStore.remove(context, id);

        if ("alarm".equals(kind)) {
            Intent svc = new Intent(context, EtcAlarmService.class);
            svc.setAction(EtcAlarmService.ACTION_START);
            svc.putExtra("id", id);
            svc.putExtra("kind", kind);
            svc.putExtra("title", title);
            svc.putExtra("body", body);
            svc.putExtra("route", route);
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
                return;
            } catch (Exception e) {
                // Could not start the service: fall back to a loud heads-up notification.
            }
        }
        EtcNotifier.postReminder(context, id.hashCode(), title == null ? "ETC" : title, body == null ? "" : body, route);
    }
}
