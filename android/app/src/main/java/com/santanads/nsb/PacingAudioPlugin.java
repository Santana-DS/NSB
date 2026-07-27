package com.santanads.nsb;

import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PacingAudio")
public class PacingAudioPlugin extends Plugin {
    static final String CONTROL = "com.santanads.nsb.PACING_CONTROL";
    private final BroadcastReceiver controls = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (CONTROL.equals(intent.getAction())) {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("action", intent.getStringExtra("control"));
                notifyListeners("control", data);
            }
        }
    };
    @Override public void load() {
        super.load();
        IntentFilter filter = new IntentFilter(CONTROL);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(controls, filter, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(controls, filter);
    }
    @Override protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(controls); } catch (IllegalArgumentException ignored) { }
        super.handleOnDestroy();
    }
    private void send(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }
    @PluginMethod public void start(PluginCall call) { send(new Intent(getContext(), PacingAudioService.class).setAction(PacingAudioService.START)); call.resolve(); }
    @PluginMethod public void stop(PluginCall call) { getContext().stopService(new Intent(getContext(), PacingAudioService.class)); call.resolve(); }
    @PluginMethod public void update(PluginCall call) {
        send(new Intent(getContext(), PacingAudioService.class).setAction(PacingAudioService.UPDATE).putExtra("elapsed", call.getString("elapsed", "00:00")).putExtra("phase", call.getString("phase", "Cronômetro")).putExtra("progress", call.getString("progress", "Em andamento"))); call.resolve();
    }
    @PluginMethod public void signal(PluginCall call) {
        send(new Intent(getContext(), PacingAudioService.class).setAction(PacingAudioService.SIGNAL).putExtra("kind", call.getString("kind", "set")).putExtra("profile", call.getString("profile", "precise")).putExtra("volume", call.getInt("volume", 100))); call.resolve();
    }
    @PluginMethod public void schedule(PluginCall call) {
        org.json.JSONArray input = call.getArray("events"); if (input == null) { call.reject("Eventos ausentes."); return; }
        long[] delays = new long[input.length()]; String[] kinds = new String[input.length()];
        for (int i = 0; i < input.length(); i++) { org.json.JSONObject event = input.optJSONObject(i); delays[i] = event == null ? 0 : event.optLong("delayMs", 0); kinds[i] = event == null ? "set" : event.optString("kind", "set"); }
        send(new Intent(getContext(), PacingAudioService.class).setAction(PacingAudioService.SCHEDULE).putExtra("delays", delays).putExtra("kinds", kinds).putExtra("profile", call.getString("profile", "precise")).putExtra("volume", call.getInt("volume", 100))); call.resolve();
    }
    @PluginMethod public void cancelSchedule(PluginCall call) { send(new Intent(getContext(), PacingAudioService.class).setAction(PacingAudioService.CANCEL)); call.resolve(); }
}
