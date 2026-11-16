package app.etc.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** After reboot, app update or clock change: put every alarm back and restart the background listener. */
public class EtcBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            EtcAlarmScheduler.rescheduleAll(context);
        } catch (Exception ignored) {
            // nothing
        }
        if (EtcAlarmStore.keepAlive(context)) {
            try {
                Intent svc = new Intent(context, EtcKeepAliveService.class);
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
            } catch (Exception ignored) {
                // starting it in the background can be refused; the app starts it again when opened
            }
        }
    }
}
