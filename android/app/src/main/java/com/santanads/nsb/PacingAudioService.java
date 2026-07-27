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

public class PacingAudioService extends Service {
    static final String START = "com.santanads.nsb.START", SIGNAL = "com.santanads.nsb.SIGNAL", SCHEDULE = "com.santanads.nsb.SCHEDULE", CANCEL = "com.santanads.nsb.CANCEL", UPDATE = "com.santanads.nsb.UPDATE", CONTROL = "com.santanads.nsb.CONTROL";
    private static final String CHANNEL = "nsb-pacing"; private static final int ID = 2401;
    private final Handler handler = new Handler(Looper.getMainLooper()); private final ExecutorService audioExecutor = Executors.newSingleThreadExecutor();
    private String elapsed = "00:00", phase = "Cronômetro", progress = "Em andamento";
    @Override public void onCreate() { super.onCreate(); if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Pacing em andamento", NotificationManager.IMPORTANCE_LOW)); startForeground(ID, notification()); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? START : intent.getAction(); if (SIGNAL.equals(action)) play(intent.getStringExtra("kind"), intent.getStringExtra("profile"), intent.getIntExtra("volume", 100));
        if (SCHEDULE.equals(action)) schedule(intent.getLongArrayExtra("delays"), intent.getStringArrayExtra("kinds"), intent.getStringExtra("profile"), intent.getIntExtra("volume", 100));
        if (CANCEL.equals(action)) handler.removeCallbacksAndMessages(null);
        if (UPDATE.equals(action)) { elapsed = intent.getStringExtra("elapsed"); phase = intent.getStringExtra("phase"); progress = intent.getStringExtra("progress"); startForeground(ID, notification()); }
        if (CONTROL.equals(action)) sendBroadcast(new Intent(PacingAudioPlugin.CONTROL).setPackage(getPackageName()).putExtra("control", intent.getStringExtra("control")));
        return START_NOT_STICKY;
    }
    private void schedule(long[] delays, String[] kinds, String profile, int volume) { handler.removeCallbacksAndMessages(null); if (delays == null || kinds == null) return; long finalDelay = 0; for (int i = 0; i < Math.min(delays.length, kinds.length); i++) { final String kind = kinds[i]; final long delay = Math.max(0, delays[i]); finalDelay = Math.max(finalDelay, delay); handler.postDelayed(() -> play(kind, profile, volume), delay); } handler.postDelayed(this::stopSelf, finalDelay + 1_000); }
    private void play(String kind, String profile, int volume) { final int duration = "rep".equals(kind) ? 90 : "complete".equals(kind) ? 520 : "set".equals(kind) ? 260 : 180; final int offset = "warmup".equals(kind) ? 0 : "set".equals(kind) ? 1 : "rest".equals(kind) ? 2 : "complete".equals(kind) ? 3 : 4; final int frequency = profileTones(profile)[offset]; audioExecutor.execute(() -> playPcm(frequency, duration, volume)); }
    private void playPcm(int frequency, int duration, int volume) { final int sampleRate = 44100; int samples = sampleRate * duration / 1000; short[] buffer = new short[samples]; double amplitude = 0.92 * Math.max(1, Math.min(100, volume)) / 100.0; for (int i = 0; i < samples; i++) { double fade = Math.min(1, Math.min(i / 400.0, (samples - i) / 800.0)); buffer[i] = (short) (Math.sin(2 * Math.PI * frequency * i / sampleRate) * 32767 * amplitude * fade); } AudioTrack track = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).setAudioFormat(new AudioFormat.Builder().setSampleRate(sampleRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(buffer.length * 2).setTransferMode(AudioTrack.MODE_STATIC).build(); try { track.write(buffer, 0, buffer.length); track.play(); Thread.sleep(duration + 40L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } finally { track.release(); } }
    private int[] profileTones(String profile) { if ("command".equals(profile)) return new int[]{520,980,320,1320,760}; if ("pulse".equals(profile)) return new int[]{740,920,360,1100,760}; if ("cardio".equals(profile)) return new int[]{340,420,220,520,360}; if ("beacon".equals(profile)) return new int[]{620,840,420,1100,620}; if ("siren".equals(profile)) return new int[]{760,1000,360,1160,680}; if ("alarm".equals(profile)) return new int[]{880,1120,360,1400,820}; if ("horn".equals(profile)) return new int[]{440,520,220,660,440}; if ("bass".equals(profile)) return new int[]{330,390,180,520,330}; if ("quiet".equals(profile)) return new int[]{580,720,360,960,540}; return new int[]{660,880,440,1320,660}; }
    private Notification notification() { Intent open = new Intent(this, MainActivity.class); PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); PendingIntent advance = PendingIntent.getService(this, 1, new Intent(this, PacingAudioService.class).setAction(CONTROL).putExtra("control", "advance"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); PendingIntent pause = PendingIntent.getService(this, 2, new Intent(this, PacingAudioService.class).setAction(CONTROL).putExtra("control", "pause"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(elapsed + " · " + phase).setContentText(progress).setContentIntent(pending).setOnlyAlertOnce(true).setOngoing(true).addAction(android.R.drawable.ic_media_next, "Avançar", advance).addAction(android.R.drawable.ic_media_pause, "Pausar", pause).build(); }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); audioExecutor.shutdownNow(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
