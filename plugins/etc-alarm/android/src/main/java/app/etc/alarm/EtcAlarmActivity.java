package app.etc.alarm;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Full-screen ring screen shown over the lock screen. Built in code (no layout files). */
public class EtcAlarmActivity extends Activity {
    private BroadcastReceiver stopReceiver;

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(28), dp(72), dp(28), dp(48));
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { Color.parseColor("#0B0F3A"), Color.parseColor("#1A237E") });
        root.setBackground(bg);

        TextView bell = text("⏰", 64, Color.WHITE, false);
        root.addView(bell);

        TextView time = text(new SimpleDateFormat("h:mm a", Locale.getDefault()).format(new Date()), 54, Color.WHITE, true);
        time.setPadding(0, dp(12), 0, dp(4));
        root.addView(time);

        TextView t = text(title == null ? "ETC alarm" : title, 22, Color.WHITE, true);
        t.setGravity(Gravity.CENTER);
        root.addView(t);

        TextView b = text(body == null ? "" : body, 17, Color.parseColor("#C5CAE9"), false);
        b.setGravity(Gravity.CENTER);
        b.setPadding(0, dp(12), 0, 0);
        root.addView(b);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        Button snooze = button("Snooze 5 min", Color.parseColor("#3949AB"), Color.WHITE);
        snooze.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                send(EtcAlarmService.ACTION_SNOOZE);
            }
        });
        root.addView(snooze, buttonParams());

        Button dismiss = button("Dismiss", Color.WHITE, Color.parseColor("#0B0F3A"));
        dismiss.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                send(EtcAlarmService.ACTION_STOP);
            }
        });
        root.addView(dismiss, buttonParams());

        setContentView(root);

        stopReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                finish();
            }
        };
        IntentFilter f = new IntentFilter(EtcAlarmService.ACTION_STOP_UI);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(stopReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(stopReceiver, f);
        }
    }

    private void send(String action) {
        Intent i = new Intent(this, EtcAlarmService.class);
        i.setAction(action);
        startService(i);
        finish();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView tv = new TextView(this);
        tv.setText(s);
        tv.setTextSize(sp);
        tv.setTextColor(color);
        tv.setGravity(Gravity.CENTER);
        if (bold) {
            tv.setTypeface(Typeface.DEFAULT_BOLD);
        }
        return tv;
    }

    private Button button(String label, int bgColor, int textColor) {
        Button bt = new Button(this);
        bt.setText(label);
        bt.setAllCaps(false);
        bt.setTextSize(18);
        bt.setTypeface(Typeface.DEFAULT_BOLD);
        bt.setTextColor(textColor);
        GradientDrawable g = new GradientDrawable();
        g.setColor(bgColor);
        g.setCornerRadius(dp(32));
        bt.setBackground(g);
        return bt;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        p.topMargin = dp(14);
        return p;
    }

    @Override
    protected void onDestroy() {
        if (stopReceiver != null) {
            try {
                unregisterReceiver(stopReceiver);
            } catch (Exception ignored) {
                // already unregistered
            }
        }
        super.onDestroy();
    }
}
