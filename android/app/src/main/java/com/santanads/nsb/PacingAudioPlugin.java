package com.santanads.nsb;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PacingAudio")
public class PacingAudioPlugin extends Plugin {
    private void send(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }
    @PluginMethod public void start(PluginCall call) { send(new Intent(getContext(), PacingAudioService.class).setAction(PacingAudioService.START)); call.resolve(); }
    @PluginMethod public void stop(PluginCall call) { getContext().stopService(new Intent(getContext(), PacingAudioService.class)); call.resolve(); }
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
