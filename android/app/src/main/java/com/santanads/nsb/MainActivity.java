package com.santanads.nsb;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(PacingAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
