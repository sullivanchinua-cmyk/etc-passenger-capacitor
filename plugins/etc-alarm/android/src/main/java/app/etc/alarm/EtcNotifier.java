package app.etc.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.graphics.BitmapFactory;
import android.os.Build;

/** Notification channels + helper used by the alarm receiver and services. */
final class EtcNotifier {
    static final String CH_ALARM = "etc_alarm";
    static final String CH_REMINDER = "etc_reminders";
    static final String CH_KEEPALIVE = "etc_keepalive";
    static final String EXTRA_ROUTE = "etc_route";

    private EtcNotifier() {}

    static NotificationManager nm(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationManager nm = nm(c);

        NotificationChannel alarm = new NotificationChannel(CH_ALARM, "Alarms", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Ticket and calendar alarms");
        alarm.setSound(null, null); // the alarm service plays the sound itself
        alarm.enableVibration(false);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        alarm.setBypassDnd(false);
        nm.createNotificationChannel(alarm);

        NotificationChannel rem = new NotificationChannel(CH_REMINDER, "Reminders", NotificationManager.IMPORTANCE_HIGH);
        rem.setDescription("Calendar reminders and missed alarms");
        Uri tone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        rem.setSound(tone, attrs);
        rem.enableVibration(true);
        rem.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 400 });
        rem.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(rem);

        NotificationChannel keep = new NotificationChannel(CH_KEEPALIVE, "Background listener", NotificationManager.IMPORTANCE_LOW);
        keep.setDescription("Keeps ETC listening for tickets, chat and alarms");
        keep.setShowBadge(false);
        nm.createNotificationChannel(keep);
    }

    /** Intent that opens the app and asks the web layer to go to a page. */
    static PendingIntent openApp(Context c, String route, int requestCode) {
        Intent launch = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (launch == null) {
            launch = new Intent();
        }
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (route != null && route.length() > 0) {
            // The route rides on the intent and is read by EtcAlarmPlugin only when the user TAPS the notification.
            // (It used to be stored here too - i.e. whenever a notification/alarm was merely BUILT - which made
            // every page load jump to home/calendar by itself.)
            launch.putExtra(EXTRA_ROUTE, route);
        }
        return PendingIntent.getActivity(c, requestCode, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressWarnings("deprecation")
    /** white bus silhouette (resources/android/res/drawable/ic_stat_etc.xml); falls back to the given system icon */
    static int smallIcon(Context c, int fallback) {
        int id = c.getResources().getIdentifier("ic_stat_etc", "drawable", c.getPackageName());
        return id != 0 ? id : fallback;
    }

    /** full-colour app icon as the large icon + brand colour */
    static Notification.Builder brand(Context c, Notification.Builder b) {
        try {
            int id = c.getResources().getIdentifier("etc_large_icon", "drawable", c.getPackageName());
            if (id != 0) {
                b.setLargeIcon(BitmapFactory.decodeResource(c.getResources(), id));
            }
            if (Build.VERSION.SDK_INT >= 21) {
                b.setColor(0xFF1A237E);
            }
        } catch (Throwable ignored) {
        }
        return b;
    }

    static Notification.Builder builder(Context c, String channel) {
        if (Build.VERSION.SDK_INT >= 26) {
            return new Notification.Builder(c, channel);
        }
        return new Notification.Builder(c);
    }

    /** A normal notification with sound that stays in the notification panel. */
    @SuppressWarnings("deprecation")
    static void postReminder(Context c, int id, String title, String body, String route) {
        ensureChannels(c);
        Notification.Builder b = builder(c, CH_REMINDER)
            .setSmallIcon(smallIcon(c, android.R.drawable.ic_lock_idle_alarm))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openApp(c, route, id));
        brand(c, b);
        if (Build.VERSION.SDK_INT >= 21) {
            b.setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PUBLIC);
        }
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE | Notification.DEFAULT_LIGHTS);
        }
        nm(c).notify(id, b.build());
    }
}
