package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.lolzcloud.mobile.OnlineActivity;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real WebView media pipeline; explicit HTTPS fixtures, never a provider/account simulation. */
public final class RoomMediaInstrumentation extends Instrumentation {
    private static final String ROOM="https://lolzcloud.com/room/0123456789abcdef0123456789abcdef?room-media-fixture=1";
    private static final String SOCIAL="https://lolzcloud.com/social?room-media-fixture=1";
    private static final String CHILD="https://media.lolzcloud-test.invalid/child";
    private final JSONArray checks=new JSONArray(),diagnostics=new JSONArray();
    private OnlineActivity activity;
    private WebView web;
    private interface Condition {boolean test()throws Exception;}

    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    @Override public void callActivityOnCreate(Activity target,Bundle state){
        super.callActivityOnCreate(target,state);
        if(target instanceof OnlineActivity)try{
            WebView view=(WebView)field(target,"webView");
            // Declare the fixture before the first page's scripts can perform
            // unauthenticated redirects. The production settings/client remain
            // authoritative for main-frame lifecycle and navigation decisions.
            view.getSettings().setJavaScriptEnabled(false);view.stopLoading();
            final WebViewClient original=view.getWebViewClient();
            view.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return fixture(r);}
                @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return original.shouldOverrideUrlLoading(v,r);}
                @Override public void onPageStarted(WebView v,String u,Bitmap icon){original.onPageStarted(v,u,icon);}
                @Override public void onPageFinished(WebView v,String u){original.onPageFinished(v,u);}
                @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){original.onReceivedError(v,r,e);}
                @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse e){original.onReceivedHttpError(v,r,e);}
                @Override public void onReceivedSslError(WebView v,SslErrorHandler h,SslError e){original.onReceivedSslError(v,h,e);}
            });
            view.getSettings().setJavaScriptEnabled(true);view.loadUrl(ROOM);
        }catch(Exception error){throw new RuntimeException(error);}
    }

    @Override public void onStart(){
        JSONObject report=new JSONObject();int result=Activity.RESULT_OK;ActivityMonitor external=null;
        try{
            try(InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("getprop ro.kernel.qemu"))){
                byte[] b=new byte[32];int n=in.read(b);check(n>0&&"1".equals(new String(b,0,n,StandardCharsets.UTF_8).trim()),"Only the isolated task emulator may run this fixture");
            }
            IntentFilter filter=new IntentFilter(Intent.ACTION_VIEW);filter.addDataScheme("http");filter.addDataScheme("https");external=addMonitor(filter,null,true);
            activity=(OnlineActivity)startActivitySync(new Intent(getTargetContext(),OnlineActivity.class).putExtra("url",ROOM).putExtra("title","Проверка аудио комнаты").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            web=(WebView)field(activity,"webView");
            waitJs("window.__fixtureReady===true&&window.__media&&window.__media.ready===true",15000,"Both real HTTPS fixture frames load");
            boolean[] gesture={true};onMain(()->gesture[0]=web.getSettings().getMediaPlaybackRequiresUserGesture());
            check(!gesture[0],"Production trusted room navigation allows asynchronous iframe media after explicit Join");
            check("true".equals(js("location.href==="+JSONObject.quote(ROOM)+"&&window.__media.origin==="+JSONObject.quote("https://media.lolzcloud-test.invalid")+"&&window.__media.child!==location.origin")),"Audio document is an actual cross-origin iframe");
            SystemClock.sleep(700);
            check("true".equals(js("window.__media.paused&&window.__media.time===0&&window.__media.track===0")),"Fixture remains silent before the parent Join touch");
            tap("join");
            waitJs("window.__media.track===1&&!window.__media.paused&&window.__media.time>0.3",12000,"Real parent touch followed by async fetch starts decoded child audio");
            check("true".equals(js("window.__touches===1&&window.__asyncResolved===1&&window.__media.error===''")),"The successful play follows a user touch and delayed network fixture, without a synthetic play callback");
            double before=Double.parseDouble(js("window.__media.time"));SystemClock.sleep(400);
            check(Double.parseDouble(js("window.__media.time"))>before+0.15,"Actual child HTMLAudioElement clock advances");
            tap("next");
            waitJs("window.__media.track===2&&!window.__media.paused&&window.__media.time>0.3",12000,"Next asynchronous child audio request also starts without a new frame gesture");
            check("2".equals(js("window.__asyncResolved")),"Both Join and Next completed their asynchronous readiness request");
            onMain(()->web.loadUrl(SOCIAL));
            waitJs("window.__socialFixture===true",10000,"Same WebView navigates to the declared own social page");
            onMain(()->gesture[0]=web.getSettings().getMediaPlaybackRequiresUserGesture());
            check(gesture[0],"Production non-room main-frame navigation restores the media gesture requirement");
            check(external.getHits()==0,"No external browser intent was launched during room media transitions");
            report.put("status","passed");
        }catch(Throwable error){result=Activity.RESULT_CANCELED;try{report.put("status","failed").put("error",error.toString());if(web!=null)diagnostics.put(new JSONObject().put("dom",js("JSON.stringify({url:location.href,media:window.__media,touches:window.__touches,resolved:window.__asyncResolved})")));}catch(Exception ignored){}}
        finally{
            if(external!=null)removeMonitor(external);
            if(activity!=null)onMain(activity::finish);
        }
        try{
            android.content.pm.PackageInfo info=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0);
            report.put("version",info.versionName).put("versionCode",info.versionCode).put("apkSha256",sha(new File(getTargetContext().getApplicationInfo().sourceDir)));
            report.put("checks",checks).put("diagnostics",diagnostics).put("scope","Real Android WebView media pipeline using declared intercepted HTTPS main/child/audio fixtures, genuine generated PCM WAV, actual MotionEvent touches and audio clock. Not a real SoundCloud/YouTube provider, personal login, room membership or system audio fidelity test. Login is native-intercepted and is not opened by this test.");
            File dir=new File(getTargetContext().getExternalFilesDir(null),"room-media-review");if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException("Cannot create report directory");
            try(FileOutputStream out=new FileOutputStream(new File(dir,"android-room-media-test.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
            Bundle out=new Bundle();out.putString("stream",report.toString(2)+"\n");finish(result,out);
        }catch(Exception error){Bundle out=new Bundle();out.putString("stream",error.toString());finish(Activity.RESULT_CANCELED,out);}
    }

    private WebResourceResponse fixture(WebResourceRequest r){
        String u=r.getUrl().toString();
        if(!"GET".equals(r.getMethod()))return response("text/plain","Unexpected method".getBytes(StandardCharsets.UTF_8));
        if(ROOM.equals(u))return response("text/html",parent().getBytes(StandardCharsets.UTF_8));
        if(SOCIAL.equals(u))return response("text/html","<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><p>Social fixture</p><script>window.__socialFixture=true;</script>".getBytes(StandardCharsets.UTF_8));
        if(CHILD.equals(u))return response("text/html",child().getBytes(StandardCharsets.UTF_8));
        if(u.equals("https://media.lolzcloud-test.invalid/tone.wav?track=1")||u.equals("https://media.lolzcloud-test.invalid/tone.wav?track=2"))return response("audio/wav",wave(u.endsWith("2")?880:440));
        if(u.equals("https://lolzcloud.com/__room_media_fixture_ready?track=1")||u.equals("https://lolzcloud.com/__room_media_fixture_ready?track=2"))return response("application/json","{\"ready\":true}".getBytes(StandardCharsets.UTF_8));
        return new WebResourceResponse("text/plain","UTF-8",404,"Fixture not declared",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
    }
    private WebResourceResponse response(String mime,byte[] data){return new WebResourceResponse(mime,mime.startsWith("audio/")?null:"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(data));}
    private String parent(){return "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='margin:24px;background:#122018;color:white;font:18px sans-serif'><h1>Аудио комнаты</h1><button id='join' style='width:100%;height:64px'>Присоединиться</button><button id='next' style='width:100%;height:64px;margin-top:16px'>Следующий трек</button><iframe id='source' src='"+CHILD+"' style='width:100%;height:160px;margin-top:20px'></iframe><script>window.__touches=0;window.__asyncResolved=0;window.__media=null;window.addEventListener('message',function(e){if(e.origin==='https://media.lolzcloud-test.invalid'&&e.data&&e.data.kind==='state')window.__media=Object.assign({origin:e.origin},e.data);});async function play(n){window.__touches++;await new Promise(r=>setTimeout(r,250));await(await fetch('/__room_media_fixture_ready?track='+n)).json();window.__asyncResolved++;document.getElementById('source').contentWindow.postMessage({kind:'play',track:n},'https://media.lolzcloud-test.invalid');}document.getElementById('join').onclick=()=>play(1);document.getElementById('next').onclick=()=>play(2);window.__fixtureReady=true;</script></body></html>";}
    private String child(){return "<!doctype html><meta name='viewport' content='width=device-width'><p>Cross-origin audio fixture</p><audio id='audio' preload='none'></audio><script>var a=document.getElementById('audio'),track=0,error='';function state(){parent.postMessage({kind:'state',child:location.origin,ready:true,track:track,paused:a.paused,time:a.currentTime,error:error},'https://lolzcloud.com');}window.addEventListener('message',async function(e){if(e.origin!=='https://lolzcloud.com'||e.data.kind!=='play')return;track=e.data.track;error='';try{var res=await fetch('/tone.wav?track='+track);var blob=await res.blob();var old=a.src;a.pause();a.src=URL.createObjectURL(blob);if(old.startsWith('blob:'))URL.revokeObjectURL(old);await a.play();}catch(e){error=String(e);}state();});setInterval(state,100);state();</script>";}
    private byte[] wave(int frequency){int rate=16000,samples=rate*8,size=samples*2;java.nio.ByteBuffer b=java.nio.ByteBuffer.allocate(44+size).order(java.nio.ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+size).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(size);for(int i=0;i<samples;i++)b.putShort((short)(Math.sin(i*2*Math.PI*frequency/rate)*4000));return b.array();}
    private Object field(Object object,String name)throws Exception{Field f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
    private void onMain(Runnable action){runOnMainSync(action);}
    private String js(String source)throws Exception{AtomicReference<String> result=new AtomicReference<>();onMain(()->web.evaluateJavascript(source,result::set));long until=SystemClock.elapsedRealtime()+5000;while(result.get()==null&&SystemClock.elapsedRealtime()<until)SystemClock.sleep(15);if(result.get()==null)throw new AssertionError("JavaScript response timeout");return result.get();}
    private void await(Condition condition,long timeout,String label)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(!condition.test()){if(SystemClock.elapsedRealtime()>end)throw new AssertionError(label);SystemClock.sleep(40);}check(true,label);}
    private void waitJs(String source,long timeout,String label)throws Exception{await(()->"true".equals(js(source)),timeout,label);}
    private void check(boolean value,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",value));if(!value)throw new AssertionError(label);}
    private void tap(String id)throws Exception{String raw=js("JSON.stringify((function(){var r=document.getElementById("+JSONObject.quote(id)+").getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2,window.devicePixelRatio]})())");JSONArray p=new JSONArray(new JSONArray("["+raw+"]").getString(0));int[] at=new int[2];onMain(()->web.getLocationOnScreen(at));float x=at[0]+(float)(p.getDouble(0)*p.getDouble(2)),y=at[1]+(float)(p.getDouble(1)*p.getDouble(2));long now=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0),up=MotionEvent.obtain(now,now+60,MotionEvent.ACTION_UP,x,y,0);sendPointerSync(down);sendPointerSync(up);down.recycle();up.recycle();}
    private String sha(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder out=new StringBuilder();for(byte b:digest.digest())out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
}
