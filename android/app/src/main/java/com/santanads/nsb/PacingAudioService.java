package com.santanads.nsb;

import android.app.*;
import android.content.Intent;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class PacingAudioService extends Service {
    static final String START = "com.santanads.nsb.START", SIGNAL = "com.santanads.nsb.SIGNAL", SCHEDULE = "com.santanads.nsb.SCHEDULE", CANCEL = "com.santanads.nsb.CANCEL", UPDATE = "com.santanads.nsb.UPDATE", CONTROL = "com.santanads.nsb.CONTROL";
    private static final String CHANNEL = "nsb-pacing"; private static final int ID = 2401;
    private final Handler handler = new Handler(Looper.getMainLooper()); private final ExecutorService audioExecutor = Executors.newSingleThreadExecutor();
    private final Object audioLock = new Object(); private AudioTrack activeTrack; private int playbackToken;
    private String elapsed = "00:00", phase = "Cronômetro", progress = "Em andamento";
    @Override public void onCreate() { super.onCreate(); if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Pacing em andamento", NotificationManager.IMPORTANCE_LOW)); startForeground(ID, notification()); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? START : intent.getAction(); if (SIGNAL.equals(action)) play(intent.getIntArrayExtra("tones"), intent.getStringExtra("waveform"), intent.getIntExtra("noteDurationMs", 120), intent.getFloatExtra("profileGain", .06f), intent.getIntExtra("volume", 100), intent.getBooleanExtra("replace", false));
        if (SCHEDULE.equals(action)) schedule(intent.getLongArrayExtra("delays"), intent.getStringArrayExtra("events"), intent.getIntExtra("volume", 100));
        if (CANCEL.equals(action)) handler.removeCallbacksAndMessages(null);
        if (UPDATE.equals(action)) { elapsed = intent.getStringExtra("elapsed"); phase = intent.getStringExtra("phase"); progress = intent.getStringExtra("progress"); startForeground(ID, notification()); }
        if (CONTROL.equals(action)) sendBroadcast(new Intent(PacingAudioPlugin.CONTROL).setPackage(getPackageName()).putExtra("control", intent.getStringExtra("control")));
        return START_NOT_STICKY;
    }
    private void schedule(long[] delays, String[] events, int volume) { handler.removeCallbacksAndMessages(null); if (delays == null || events == null) return; long finalDelay = 0; for (int i = 0; i < Math.min(delays.length, events.length); i++) { final String event = events[i]; final long delay = Math.max(0, delays[i]); finalDelay = Math.max(finalDelay, delay); handler.postDelayed(() -> playEvent(event, volume), delay); } handler.postDelayed(this::stopSelf, finalDelay + 1_000); }
    private void playEvent(String serialized, int volume) { try { JSONObject event = new JSONObject(serialized); JSONArray input = event.optJSONArray("tones"); int[] tones = new int[input == null ? 0 : input.length()]; for (int i = 0; i < tones.length; i++) tones[i] = input.optInt(i, 440); play(tones, event.optString("waveform", "sine"), event.optInt("noteDurationMs", 120), (float) event.optDouble("profileGain", .06), volume, false); } catch (Exception ignored) { } }
    private void play(int[] tones, String waveform, int noteDurationMs, float profileGain, int volume, boolean replace) { if (tones == null || tones.length == 0) return; final int token; synchronized (audioLock) { if (replace) stopActiveSoundLocked(); token = playbackToken; } audioExecutor.execute(() -> playPcm(tones, waveform, noteDurationMs, profileGain, volume, token)); }
    private void stopActiveSoundLocked() { playbackToken++; if (activeTrack != null) { try { activeTrack.pause(); activeTrack.flush(); } catch (IllegalStateException ignored) { } activeTrack.release(); activeTrack = null; } }
    private void playPcm(int[] tones, String waveform, int noteDurationMs, float profileGain, int volume, int token) { final int sampleRate = 44100; final double slotSeconds = .15; final int samples = Math.max(1, (int) (sampleRate * (((tones.length - 1) * slotSeconds) + noteDurationMs / 1000.0 + .015))); short[] buffer = new short[samples]; double amplitude = Math.min(.95, Math.max(.01, profileGain * Math.max(1, volume) / 100.0)); for (int i = 0; i < samples; i++) { double time = i / (double) sampleRate; int toneIndex = Math.min(tones.length - 1, (int) (time / slotSeconds)); double localTime = time - toneIndex * slotSeconds; if (localTime > noteDurationMs / 1000.0) continue; double phase = 2 * Math.PI * tones[toneIndex] * localTime; double sample = "square".equals(waveform) ? (Math.sin(phase) >= 0 ? 1 : -1) : "triangle".equals(waveform) ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : "sawtooth".equals(waveform) ? 2 * ((phase / (2 * Math.PI)) - Math.floor(.5 + phase / (2 * Math.PI))) : Math.sin(phase); double fade = Math.min(1, Math.min(localTime / .008, (noteDurationMs / 1000.0 - localTime) / .012)); buffer[i] = (short) (sample * 32767 * amplitude * Math.max(0, fade)); } AudioTrack track = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).setAudioFormat(new AudioFormat.Builder().setSampleRate(sampleRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(buffer.length * 2).setTransferMode(AudioTrack.MODE_STATIC).build(); synchronized (audioLock) { if (token != playbackToken) { track.release(); return; } activeTrack = track; } try { track.write(buffer, 0, buffer.length); track.play(); Thread.sleep((long) (buffer.length * 1000.0 / sampleRate) + 25L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } finally { synchronized (audioLock) { if (activeTrack == track) activeTrack = null; } track.release(); } }
    private Notification notification() { Intent open = new Intent(this, MainActivity.class); PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); PendingIntent advance = PendingIntent.getService(this, 1, new Intent(this, PacingAudioService.class).setAction(CONTROL).putExtra("control", "advance"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); PendingIntent pause = PendingIntent.getService(this, 2, new Intent(this, PacingAudioService.class).setAction(CONTROL).putExtra("control", "pause"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(elapsed + " · " + phase).setContentText(progress).setContentIntent(pending).setOnlyAlertOnce(true).setOngoing(true).addAction(android.R.drawable.ic_media_next, "Avançar", advance).addAction(android.R.drawable.ic_media_pause, "Pausar", pause).build(); }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); synchronized (audioLock) { stopActiveSoundLocked(); } audioExecutor.shutdownNow(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
