package app.etc.alarm;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * Background listener: a foreground service with a small silent notification. It keeps the app process alive so the
 * Firestore listeners (chat, tickets, price changes) continue while the screen is off or the app is minimized.
 */
public class EtcKeepAliveService extends Service {
    private static final int NOTIF_ID = 4712;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public int onStartCommand(Intent intent, int flags, int startId) {
        EtcNotifier.ensureChannels(this);
        Notification.Builder b = EtcNotifier.builder(this, EtcNotifier.CH_KEEPALIVE)
            .setSmallIcon(EtcNotifier.smallIcon(this, android.R.drawable.ic_dialog_info))
            .setContentTitle("ETC is on")
            .setContentText("Listening for tickets, chat and alarms")
            .setOngoing(true)
            .setContentIntent(EtcNotifier.openApp(this, "", 21));
        EtcNotifier.brand(this, b);
        if (Build.VERSION.SDK_INT >= 21) {
            b.setCategory(Notification.CATEGORY_SERVICE);
        }
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_MIN);
        }
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, 1073741824 /* FOREGROUND_SERVICE_TYPE_SPECIAL_USE */);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, 0);
        } else {
            startForeground(NOTIF_ID, n);
        }
        return START_STICKY;
    }
}
