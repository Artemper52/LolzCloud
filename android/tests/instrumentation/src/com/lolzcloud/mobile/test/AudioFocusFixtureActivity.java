package com.lolzcloud.mobile.test;
import android.app.Activity;import android.media.*;import android.os.Bundle;import android.widget.TextView;
/** Separate test-APK UID requests real transient focus; no simulated Service callback. */
public final class AudioFocusFixtureActivity extends Activity {
    private AudioManager audio;private AudioFocusRequest focus;
    @Override public void onCreate(Bundle state){super.onCreate(state);TextView label=new TextView(this);label.setText("Isolated Android audio-focus fixture");label.setTextSize(20);label.setPadding(30,90,30,30);setContentView(label);audio=(AudioManager)getSystemService(AUDIO_SERVICE);focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()).setOnAudioFocusChangeListener(value->{}).build();}
    @Override protected void onResume(){super.onResume();audio.requestAudioFocus(focus);}
    @Override protected void onDestroy(){if(audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);super.onDestroy();}
}
