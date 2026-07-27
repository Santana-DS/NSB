package com.santanads.nsb;

import android.app.*;
import android.content.Intent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.*;

public class PacingAudioService extends Service {
    static final String START = "com.santanads.nsb.START", SIGNAL = "com.santanads.nsb.SIGNAL", SCHEDULE = "com.santanads.nsb.SCHEDULE", CANCEL = "com.santanads.nsb.CANCEL";
    private static final String CHANNEL = "nsb-pacing"; private static final int ID = 2401;
    private final Handler handler = new Handler(Looper.getMainLooper()); private ToneGenerator tones;
    @Override public void onCreate() { super.onCreate(); if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Pacing em andamento", NotificationManager.IMPORTANCE_LOW)); tones = new ToneGenerator(AudioManager.STREAM_ALARM, 100); startForeground(ID, notification()); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? START : intent.getAction(); if (SIGNAL.equals(action)) play(intent.getStringExtra("kind"), intent.getIntExtra("volume", 100));
        if (SCHEDULE.equals(action)) schedule(intent.getLongArrayExtra("delays"), intent.getStringArrayExtra("kinds"), intent.getIntExtra("volume", 100));
        if (CANCEL.equals(action)) handler.removeCallbacksAndMessages(null); return START_NOT_STICKY;
    }
    private void schedule(long[] delays, String[] kinds, int volume) { handler.removeCallbacksAndMessages(null); if (delays == null || kinds == null) return; long finalDelay = 0; for (int i = 0; i < Math.min(delays.length, kinds.length); i++) { final String kind = kinds[i]; final long delay = Math.max(0, delays[i]); finalDelay = Math.max(finalDelay, delay); handler.postDelayed(() -> play(kind, volume), delay); } handler.postDelayed(this::stopSelf, finalDelay + 1_000); }
    private void play(String kind, int volume) { int tone = ToneGenerator.TONE_PROP_BEEP, duration = 160; if ("set".equals(kind)) { tone = ToneGenerator.TONE_DTMF_5; duration = 260; } else if ("rest".equals(kind)) { tone = ToneGenerator.TONE_DTMF_2; duration = 220; } else if ("complete".equals(kind)) { tone = ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD; duration = 520; } else if ("rep".equals(kind)) { tone = ToneGenerator.TONE_DTMF_8; duration = 90; } if (tones != null) tones.release(); tones = new ToneGenerator(AudioManager.STREAM_ALARM, Math.max(1, Math.min(100, volume))); tones.startTone(tone, duration); }
    private Notification notification() { Intent open = new Intent(this, MainActivity.class); PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Navy Seal Burpees").setContentText("Pacing ativo em segundo plano").setContentIntent(pending).setOngoing(true).build(); }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); if (tones != null) tones.release(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
