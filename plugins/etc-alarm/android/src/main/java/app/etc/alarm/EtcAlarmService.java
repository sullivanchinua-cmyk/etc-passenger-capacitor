package app.etc.alarm;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Rings the alarm: loops the default alarm sound on the ALARM stream at full volume, vibrates in a strong
 * repeating pattern, wakes the screen and shows the ring screen over the lock screen.
 */
public class EtcAlarmService extends Service {
    static final String ACTION_START = "app.etc.alarm.START";
    static final String ACTION_STOP = "app.etc.alarm.STOP";
    static final String ACTION_SNOOZE = "app.etc.alarm.SNOOZE";
    static final String ACTION_STOP_UI = "app.etc.alarm.STOP_UI";
    private static final long MAX_RING_MS = 3 * 60 * 1000L;
    private static final long SNOOZE_MINUTES = 5;
    private static final int NOTIF_ID = 4711;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audio;
    private int savedVolume = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String curId = "", curKind = "alarm", curTitle = "ETC alarm", curBody = "", curRoute = "";
    private boolean ringing = false;

    private final Runnable giveUp = new Runnable() {
        @Override
        public void run() {
            // Nobody answered: stop the noise but leave a "missed alarm" notification in the panel.
            EtcNotifier.postReminder(EtcAlarmService.this, curId.hashCode() + 1, "Missed alarm: " + curTitle, curBody, curRoute);
            stopRinging();
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopRinging();
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(action)) {
            EtcAlarmScheduler.snooze(this, curId, curKind, curTitle, curBody, curRoute, SNOOZE_MINUTES);
            stopRinging();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            curId = str(intent.getStringExtra("id"), "alarm");
            curKind = str(intent.getStringExtra("kind"), "alarm");
            curTitle = str(intent.getStringExtra("title"), "ETC alarm");
            curBody = str(intent.getStringExtra("body"), "");
            curRoute = str(intent.getStringExtra("route"), "");
        }
        startRinging();
        return START_NOT_STICKY;
    }

    private static String str(String v, String d) {
        return v == null ? d : v;
    }

    private PendingIntent action(String act, int code) {
        Intent i = new Intent(this, EtcAlarmService.class);
        i.setAction(act);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressWarnings("deprecation")
    private void startRinging() {
        if (ringing) {
            return;
        }
        ringing = true;
        EtcNotifier.ensureChannels(this);

        // Full-screen ring screen (opens over the lock screen)
        Intent ui = new Intent(this, EtcAlarmActivity.class);
        ui.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        ui.putExtra("title", curTitle);
        ui.putExtra("body", curBody);
        PendingIntent fullScreen = PendingIntent.getActivity(this, 11, ui, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = EtcNotifier.builder(this, EtcNotifier.CH_ALARM)
            .setSmallIcon(EtcNotifier.smallIcon(this, android.R.drawable.ic_lock_idle_alarm))
            .setContentTitle(curTitle)
            .setContentText(curBody.length() > 0 ? curBody : "Alarm")
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .addAction(new Notification.Action.Builder(null, "Snooze 5 min", action(ACTION_SNOOZE, 12)).build())
            .addAction(new Notification.Action.Builder(null, "Dismiss", action(ACTION_STOP, 13)).build());
        EtcNotifier.brand(this, b);
        if (Build.VERSION.SDK_INT >= 21) {
            b.setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC);
        }
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_MAX);
        }
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, 2 /* FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK */);
        } else {
            startForeground(NOTIF_ID, n);
        }

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "etc:alarm");
        wakeLock.acquire(MAX_RING_MS + 15000);

        // Full volume on the alarm stream
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        try {
            savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
        } catch (Exception ignored) {
            // some devices refuse (Do Not Disturb policy): keep going with current volume
        }

        // Loud looping alarm sound
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) {
                uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.setVolume(1f, 1f);
            player.prepare();
            player.start();
        } catch (Exception e) {
            releasePlayer();
        }

        // Strong repeating vibration
        try {
            long[] pattern = new long[] { 0, 900, 250, 900, 250, 1500, 600 };
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            AudioAttributes va = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), va);
            } else {
                vibrator.vibrate(pattern, 0, va);
            }
        } catch (Exception ignored) {
            // no vibrator
        }

        // Also pop the ring screen directly (works when the app is in the foreground)
        try {
            startActivity(ui);
        } catch (Exception ignored) {
            // background start blocked: the full-screen notification covers it
        }

        handler.postDelayed(giveUp, MAX_RING_MS);
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
                // already stopped
            }
            try {
                player.release();
            } catch (Exception ignored) {
                // already released
            }
            player = null;
        }
    }

    private void stopRinging() {
        handler.removeCallbacks(giveUp);
        releasePlayer();
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {
                // nothing
            }
        }
        if (audio != null && savedVolume >= 0) {
            try {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0);
            } catch (Exception ignored) {
                // nothing
            }
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        sendBroadcast(new Intent(ACTION_STOP_UI).setPackage(getPackageName()));
        ringing = false;
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(giveUp);
        releasePlayer();
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {
                // nothing
            }
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }
}
