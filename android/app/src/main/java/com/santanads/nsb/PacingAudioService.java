package com.santanads.nsb;

import android.app.*;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.os.*;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

public class PacingAudioService extends Service {
    static final String START = "com.santanads.nsb.START", SIGNAL = "com.santanads.nsb.SIGNAL", SCHEDULE = "com.santanads.nsb.SCHEDULE", CANCEL = "com.santanads.nsb.CANCEL", UPDATE = "com.santanads.nsb.UPDATE", CONTROL = "com.santanads.nsb.CONTROL";
    private static final String CHANNEL = "nsb-pacing"; private static final int ID = 2401;
    private static final String[] PROFILES = { "signal", "censor", "scanner", "ting", "radio", "impact", "classic", "select", "beep6", "phone", "wrong", "tone", "short", "precise", "command", "horn", "quiet" };
    private static final String[] EVENTS = { "warmup", "set", "rest", "complete", "rep" };
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, Integer> clips = new HashMap<>();
    private SoundPool soundPool; private int activeStream;
    private String elapsed = "00:00", phase = "Cronômetro", progress = "Em andamento";

    @Override public void onCreate() {
        super.onCreate();
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        soundPool = new SoundPool.Builder().setAudioAttributes(attributes).setMaxStreams(3).build();
        for (String profile : PROFILES) for (String event : EVENTS) {
            String key = profile + "_" + event;
            int resource = getResources().getIdentifier("pace_" + key, "raw", getPackageName());
            if (resource != 0) clips.put(key, soundPool.load(this, resource, 1));
        }
        if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Pacing em andamento", NotificationManager.IMPORTANCE_LOW));
        startForeground(ID, notification());
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? START : intent.getAction();
        if (SIGNAL.equals(action)) play(intent.getStringExtra("profile"), intent.getStringExtra("kind"), intent.getIntExtra("volume", 100), intent.getBooleanExtra("replace", false));
        if (SCHEDULE.equals(action)) schedule(intent.getLongArrayExtra("delays"), intent.getStringArrayExtra("events"), intent.getIntExtra("volume", 100));
        if (CANCEL.equals(action)) { handler.removeCallbacksAndMessages(null); stopActive(); }
        if (UPDATE.equals(action)) { elapsed = intent.getStringExtra("elapsed"); phase = intent.getStringExtra("phase"); progress = intent.getStringExtra("progress"); startForeground(ID, notification()); }
        if (CONTROL.equals(action)) sendBroadcast(new Intent(PacingAudioPlugin.CONTROL).setPackage(getPackageName()).putExtra("control", intent.getStringExtra("control")));
        return START_NOT_STICKY;
    }

    private void schedule(long[] delays, String[] events, int volume) {
        handler.removeCallbacksAndMessages(null); if (delays == null || events == null) return;
        long finalDelay = 0;
        for (int i = 0; i < Math.min(delays.length, events.length); i++) { final String event = events[i]; final long delay = Math.max(0, delays[i]); finalDelay = Math.max(finalDelay, delay); handler.postDelayed(() -> playEvent(event, volume), delay); }
        handler.postDelayed(this::stopSelf, finalDelay + 1_000);
    }
    private void playEvent(String serialized, int volume) { try { JSONObject event = new JSONObject(serialized); play(event.optString("profile", "signal"), event.optString("kind", "rep"), volume, false); } catch (Exception ignored) { } }
    private void play(String profile, String kind, int volume, boolean replace) {
        if (soundPool == null) return;
        if (replace) stopActive();
        Integer clip = clips.get((profile == null ? "signal" : profile) + "_" + (kind == null ? "rep" : kind));
        if (clip == null) return;
        float gain = Math.min(1f, Math.max(.12f, volume / 1000f));
        activeStream = soundPool.play(clip, gain, gain, 1, 0, 1f);
    }
    private void stopActive() { if (soundPool != null && activeStream != 0) soundPool.stop(activeStream); activeStream = 0; }
    private Notification notification() { Intent open = new Intent(this, MainActivity.class); PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); PendingIntent advance = PendingIntent.getService(this, 1, new Intent(this, PacingAudioService.class).setAction(CONTROL).putExtra("control", "advance"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); PendingIntent pause = PendingIntent.getService(this, 2, new Intent(this, PacingAudioService.class).setAction(CONTROL).putExtra("control", "pause"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(elapsed + " · " + phase).setContentText(progress).setContentIntent(pending).setOnlyAlertOnce(true).setOngoing(true).addAction(android.R.drawable.ic_media_next, "Avançar", advance).addAction(android.R.drawable.ic_media_pause, "Pausar", pause).build(); }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); stopActive(); if (soundPool != null) soundPool.release(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
