package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.ResultReceiver;
import android.widget.TextView;

/** Separate test UID: genuine system consent, never a grant embedded in production. */
public final class AudioCaptureFixtureActivity extends Activity {
    private static final int CONSENT=662;
    private ResultReceiver receiver;
    @Override public void onCreate(Bundle state){super.onCreate(state);TextView view=new TextView(this);view.setText("Isolated LolzCloud playback-capture fixture\nOnly generated test audio is measured.");view.setPadding(30,90,30,30);setContentView(view);dispatch(getIntent());}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);dispatch(intent);}
    private void dispatch(Intent intent){
        receiver=intent.getParcelableExtra("receiver");String op=intent.getStringExtra("op");
        if("start".equals(op)){
            if(Build.VERSION.SDK_INT<29){sendError("Playback capture requires API29");return;}
            MediaProjectionManager manager=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent consent=Build.VERSION.SDK_INT>=34?manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay()):manager.createScreenCaptureIntent();startActivityForResult(consent,CONSENT);
        }else{
            Intent service=new Intent(this,AudioCaptureFixtureService.class).putExtra("op",op).putExtra("request",intent.getIntExtra("request",0)).putExtra("receiver",receiver);startService(service);
            if("stop".equals(op))finish();
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=CONSENT)return;if(result!=RESULT_OK||data==null){sendError("System playback capture consent was not granted");finish();return;}
        startForegroundService(new Intent(this,AudioCaptureFixtureService.class).putExtra("op","start").putExtra("resultCode",result).putExtra("resultData",data).putExtra("receiver",receiver));
    }
    private void sendError(String message){Bundle value=new Bundle();value.putString("error",message);if(receiver!=null)receiver.send(199,value);}
}
