package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.lolzcloud.mobile.LibraryStore;
import com.lolzcloud.mobile.MainActivity;
import com.lolzcloud.mobile.OnlineActivity;
import com.lolzcloud.mobile.PlaybackService;
import com.lolzcloud.mobile.Track;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

/** Real MediaController/production bridge plus actual cross-origin HTMLAudio, with declared protocol fixtures. */
public final class RoomTransportInstrumentation extends Instrumentation {
    private static final String ROOM="https://lolzcloud.com/room/0123456789abcdef0123456789abcdef",CHILD="https://room-media.lolzcloud-test.invalid/child",SOCIAL="https://lolzcloud.com/social?room-transport-fixture=1";
    private final JSONArray checks=new JSONArray(),captures=new JSONArray();
    private MainActivity main;private OnlineActivity online;private WebView web;private PlaybackService player;private LibraryStore store;private MediaController controller;
    private Map<String,Object> original;private File audio;private interface Condition{boolean get()throws Exception;}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void callActivityOnCreate(Activity target,Bundle state){
        super.callActivityOnCreate(target,state);if(!(target instanceof OnlineActivity)||!target.getIntent().getStringExtra("url").startsWith(ROOM))return;
        try{WebView view=(WebView)field(target,"webView");view.getSettings().setJavaScriptEnabled(false);view.stopLoading();WebViewClient original=view.getWebViewClient();
            view.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return fixture(r);}
                @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return original.shouldOverrideUrlLoading(v,r);}
                @Override public void onPageStarted(WebView v,String u,Bitmap icon){original.onPageStarted(v,u,icon);}
                @Override public void onPageCommitVisible(WebView v,String u){original.onPageCommitVisible(v,u);}
                @Override public void onPageFinished(WebView v,String u){original.onPageFinished(v,u);}
                @Override public void onReceivedError(WebView v,WebResourceRequest r,android.webkit.WebResourceError e){original.onReceivedError(v,r,e);}
                @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse e){original.onReceivedHttpError(v,r,e);}
            });view.getSettings().setJavaScriptEnabled(true);view.loadUrl(ROOM+"?room-transport-fixture=1");
        }catch(Exception failure){throw new RuntimeException(failure);}
    }
    @Override public void onStart(){
        JSONObject report=new JSONObject();int result=Activity.RESULT_OK;ActivityMonitor browser=null;
        try{
            check(shell("getprop ro.kernel.qemu").trim().equals("1"),"Only the owned task emulator can run this fixture");store=new LibraryStore(getTargetContext());original=snapshot(store.preferences());
            IntentFilter filter=new IntentFilter(Intent.ACTION_VIEW);filter.addDataScheme("http");filter.addDataScheme("https");browser=addMonitor(filter,null,true);
            main=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            await(()->{player=(PlaybackService)field(main,"player");return player!=null;},15000,"Native playback service binds before room entry");
            onMain(()->{player.stopPlayback();store.preferences().edit().clear().putBoolean("notification_permission_asked",true).commit();player.reloadSettings();});
            audio=File.createTempFile("room-native-solo-",".mp3",getTargetContext().getCacheDir());try(InputStream in=getContext().getAssets().open("fixtures/night-route.mp3");OutputStream out=new FileOutputStream(audio)){byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);}
            Track a=new Track("room-native-a","Previous solo A","Declared fixture",android.net.Uri.fromFile(audio).toString(),40000),b=new Track("room-native-b","Previous solo B","Declared fixture",a.uri,40000);
            onMain(()->player.setQueue(Arrays.asList(a,b),0,true));await(()->player.isPlaying()&&player.position()>200,10000,"The real solo MediaPlayer clock advances before handoff");
            online=(OnlineActivity)startActivitySync(new Intent(getTargetContext(),OnlineActivity.class).putExtra("url",ROOM+"?room-transport-fixture=1").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));web=(WebView)field(online,"webView");controller=((MediaSession)field(player,"session")).getController();
            waitJs("window.__fixtureReady&&window.__media&&window.__media.ready",15000,"The trusted main frame and genuine cross-origin audio document load");
            await(()->!player.isPlaying()&&!player.isLoading(),5000,"Pending room navigation cancels native playback without a replacement source");long nativeGeneration=(Long)field(player,"sourceGeneration");
            controller.getTransportControls().play();SystemClock.sleep(400);check("true".equals(js("window.__media.paused&&window.__media.time===0"))&&!player.isPlaying(),"System Play before explicit Join cannot play the room or resurrect the old solo queue");
            onMain(player::play);await(player::isPlaying,6000,"An explicit solo choice can release an initial inactive room before its first Join");nativeGeneration=(Long)field(player,"sourceGeneration");
            tap("join");waitJs("!window.__media.paused&&window.__media.time>.3",10000,"Genuine Join starts actual decoded cross-origin audio");
            await(()->controller.getMetadata()!=null&&"Room fixture1".equals(controller.getMetadata().getString("android.media.metadata.TITLE"))&&controller.getPlaybackState().getState()==PlaybackState.STATE_PLAYING,6000,"The real Android MediaSession publishes room track metadata and playing state");
            await(()->!player.isPlaying(),4000,"The first explicit room Join can reclaim epoch1 after an inactive-to-solo release");
            check((Long)field(player,"sourceGeneration")>nativeGeneration&&player.currentIndex()==0,"Room playback fences the previous native decoder while preserving its queue");
            String owner=js("window.LolzCloudRoomTransport.snapshot().documentId");
            controller.getTransportControls().pause();waitJs("window.__media.paused",6000,"MediaController Pause controls actual room audio");
            await(()->controller.getPlaybackState().getState()==PlaybackState.STATE_PAUSED,5000,"Native lockscreen state follows the room pause");
            check("true".equals(js("window.LolzCloudRoomTransport.snapshot().active")),"Pausing a listener preserves room ownership for hardware Resume");
            double paused=Double.parseDouble(js("window.__media.time"));SystemClock.sleep(250);check(Math.abs(Double.parseDouble(js("window.__media.time"))-paused)<.15,"The actual child audio clock stays paused");
            controller.getTransportControls().play();waitJs("!window.__media.paused&&window.__media.time>"+(paused+.15),6000,"MediaController Play resumes the same room source");
            check(owner.equals(js("window.LolzCloudRoomTransport.snapshot().documentId")),"Pause/Resume keeps the exact room document identity");
            js("window.__host=false;window.__transport.update();true");await(()->(controller.getPlaybackState().getActions()&PlaybackState.ACTION_SKIP_TO_NEXT)==0,4000,"A listener does not advertise host Next");
            controller.getTransportControls().skipToNext();SystemClock.sleep(350);check("0".equals(js("window.__nextCalls"))&&player.currentIndex()==0,"Even a forced system Next cannot act on a listener or fall back to solo Next");
            js("document.getElementById('source').contentWindow.postMessage({kind:'spoof'},'https://room-media.lolzcloud-test.invalid');true");SystemClock.sleep(350);check("Room fixture1".equals(controller.getMetadata().getString("android.media.metadata.TITLE")),"A forged provider-frame postMessage cannot supply native metadata or owner state");
            js("window.__host=true;window.__transport.update();true");await(()->(controller.getPlaybackState().getActions()&PlaybackState.ACTION_SKIP_TO_NEXT)!=0,4000,"A valid host lease enables native Next");
            controller.getTransportControls().skipToNext();waitJs("window.__media.track===2&&!window.__media.paused&&window.__media.time>.2",10000,"Host MediaController Next advances actual room audio exactly once");
            check("1".equals(js("window.__nextCalls"))&&player.currentIndex()==0,"Room Next consumes no entry from the preserved native queue");
            controller.getTransportControls().seekTo(5000);waitJs("window.__lastCommand&&window.__lastCommand.command==='seek'&&window.__lastCommand.value===5",5000,"System seek is delivered through the real bridge as5source seconds");waitJs("window.__media.time>=4.9&&window.__media.time<7",6000,"Host system seek reaches the real room audio clock in source seconds");
            controller.getTransportControls().skipToPrevious();waitJs("window.__media.time<1.2",6000,"Room Previous restarts this room recording rather than selecting an old solo track");
            screenshot("room-transport-host");
            onMain(()->getTargetContext().startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
            controller.getTransportControls().pause();waitJs("window.__media.paused",7000,"System room Pause still reaches the WebView while the Activity is in the background");
            controller.getTransportControls().play();waitJs("!window.__media.paused&&window.__media.time>.2",7000,"System room Resume works through the foreground playback service in the background");
            onMain(()->online.startActivity(new Intent(getTargetContext(),OnlineActivity.class).putExtra("url",ROOM).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT|Intent.FLAG_ACTIVITY_SINGLE_TOP)));
            await(()->online.hasWindowFocus(),5000,"The existing room Activity returns to the foreground without rebuilding its document");
            js("window.__delayNext=true;window.__heldSnapshot=window.__transport.snapshot();true");controller.getTransportControls().skipToNext();waitJs("window.__pendingNext===true",5000,"A real queued room Next waits behind a declared asynchronous provider delay");
            onMain(player::play);await(()->player.isPlaying()&&player.current().id.equals(a.id),7000,"An explicit native Play receives direct room release without waiting for the slow Next");
            check("true".equals(js("window.__media.paused&&!window.__transport.snapshot().active")),"Native solo starts only after the actual room audio is paused and its lease is released");
            long soloGeneration=(Long)field(player,"sourceGeneration");js("window.__resolveNext();window.__oldOnce=true;true");SystemClock.sleep(700);
            check(player.isPlaying()&&(Long)field(player,"sourceGeneration")==soloGeneration&&player.currentIndex()==0,"Late Next completion and an old active snapshot cannot steal a newer solo owner");
            tap("join");waitJs("window.__transport.snapshot().epoch===2&&!window.__media.paused",6000);await(()->!player.isPlaying(),5000,"A new explicit room Join reacquires a higher epoch and pauses solo again");
            onMain(()->web.loadUrl(SOCIAL));waitJs("window.__social===true",6000,"Leaving the room navigates to the declared own-origin social page");controller.getTransportControls().play();SystemClock.sleep(350);
            check(!player.isPlaying()&&controller.getPlaybackState().getActions()==0,"A closed room's system commands cannot silently resume the prior solo queue");
            onMain(player::play);await(player::isPlaying,7000,"A later explicit native Play can resume solo after room exit");
            onMain(()->player.setPortableEnabled(true));await(()->player.pcmActive()&&player.isPlaying()&&player.pcmSnapshot()!=null&&player.pcmSnapshot().acceptedFrames>512,10000,"The actual PCM AudioTrack path is rendering before a second room handoff");
            onMain(()->web.loadUrl(ROOM+"?room-transport-fixture=2"));waitJs("window.__fixtureReady&&window.__media&&window.__media.ready",10000,"The second trusted room document loads without reusing its old lease");
            await(()->!player.pcmActive()&&!player.isPlaying(),6000,"Room entry closes the actual native PCM renderer as well as MediaPlayer");tap("join");waitJs("!window.__media.paused&&window.__media.time>.2",8000,"Room media can start after the PCM renderer relinquishes playback");
            check(browser.getHits()==0,"All room/system/native handoffs stay inside the app without browser fallback");report.put("status","passed");
        }catch(Throwable failure){result=Activity.RESULT_CANCELED;try{report.put("status","failed").put("error",failure.toString());if(web!=null)report.put("dom",js("JSON.stringify({media:window.__media,transport:window.__transport&&window.__transport.snapshot(),next:window.__nextCalls,lastCommand:window.__lastCommand})"));}catch(Exception ignored){}}
        finally{
            try{onMain(()->{if(online!=null)online.finish();if(main!=null)main.finish();if(player!=null)player.stopPlayback();getTargetContext().stopService(new Intent(getTargetContext(),PlaybackService.class));});waitForIdleSync();SystemClock.sleep(250);if(original!=null){restore(store.preferences(),original);check(original.equals(snapshot(store.preferences())),"Original native preferences/library are restored exactly after room fixtures");}if(audio!=null)audio.delete();}catch(Throwable failure){result=Activity.RESULT_CANCELED;try{report.put("status","failed").put("cleanupError",failure.toString());}catch(Exception ignored){}}if(browser!=null)removeMonitor(browser);
        }
        try{android.content.pm.PackageInfo info=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0);report.put("version",info.versionName).put("versionCode",info.versionCode).put("apkSha256",sha(new File(getTargetContext().getApplicationInfo().sourceDir))).put("checks",checks).put("screenshots",captures).put("scope","Actual production Android room bridge/MediaSession/notification service, MediaPlayer and PCM renderer handoff, shared bundled room-transport.js, real cross-origin HTMLAudio clocks and MotionEvent Join. Declared room/provider fixtures; no personal OAuth, public room membership, SoundCloud/YouTube SDK or physical speaker fidelity claim.");File dir=new File(getTargetContext().getExternalFilesDir(null),"room-transport-review");dir.mkdirs();try(OutputStream out=new FileOutputStream(new File(dir,"room-transport-test.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}Bundle data=new Bundle();data.putString("stream",report.toString(2)+"\n");finish(result,data);}catch(Exception failure){Bundle data=new Bundle();data.putString("stream",failure.toString());finish(Activity.RESULT_CANCELED,data);}
    }
    private WebResourceResponse fixture(WebResourceRequest request){try{String url=request.getUrl().toString();if(url.startsWith(ROOM))return response("text/html",parent().getBytes(StandardCharsets.UTF_8));if(url.equals(SOCIAL))return response("text/html","<!doctype html><p>Social fixture</p><script>window.__social=true</script>".getBytes(StandardCharsets.UTF_8));if(url.equals("https://lolzcloud.com/app/room-transport.js")){try(InputStream input=getTargetContext().getAssets().open("room-client/room-transport.js")){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=input.read(b))!=-1)bytes.write(b,0,n);return response("text/javascript",bytes.toByteArray());}}if(url.equals(CHILD))return response("text/html",child().getBytes(StandardCharsets.UTF_8));if(url.startsWith("https://room-media.lolzcloud-test.invalid/tone.wav"))return audioResponse(request,wave());}catch(Exception failure){throw new RuntimeException(failure);}return new WebResourceResponse("text/plain","UTF-8",404,"Undeclared fixture",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private WebResourceResponse response(String mime,byte[] bytes){return new WebResourceResponse(mime,mime.startsWith("audio/")?null:"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(bytes));}
    private WebResourceResponse audioResponse(WebResourceRequest request,byte[] bytes){
        Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Accept-Ranges","bytes");String range=null;for(Map.Entry<String,String> entry:request.getRequestHeaders().entrySet())if(entry.getKey().equalsIgnoreCase("range"))range=entry.getValue();
        int start=0,end=bytes.length-1,status=200;
        if(range!=null)try{if(!range.matches("bytes=[0-9]+-[0-9]*"))throw new IllegalArgumentException();String[] pair=range.substring(6).split("-",-1);start=Integer.parseInt(pair[0]);if(!pair[1].isEmpty())end=Math.min(end,Integer.parseInt(pair[1]));if(start>end||start>=bytes.length)throw new IllegalArgumentException();headers.put("Content-Range","bytes "+start+"-"+end+"/"+bytes.length);status=206;}catch(Exception invalid){headers.put("Content-Range","bytes */"+bytes.length);return new WebResourceResponse("audio/wav",null,416,"Range Not Satisfiable",headers,new ByteArrayInputStream(new byte[0]));}
        headers.put("Content-Length",String.valueOf(end-start+1));return new WebResourceResponse("audio/wav",null,status,status==206?"Partial Content":"OK",headers,new ByteArrayInputStream(Arrays.copyOfRange(bytes,start,end+1)));
    }
    private String parent(){return "<!doctype html><meta name='viewport' content='width=device-width'><script src='/app/room-transport.js'></script><body style='background:#122018;color:white;font:18px sans-serif;padding:20px'><h1>Room transport fixture</h1><button id='join' style='width:100%;height:64px'>Join audio</button><iframe id='source' src='"+CHILD+"' style='height:120px;width:100%'></iframe><script>window.__host=true;window.__nextCalls=0;window.__media=null;let track=1,intent=0;const source=document.getElementById('source'),documentId=crypto.randomUUID();function send(action,value){source.contentWindow.postMessage({kind:'control',action,value,track},'https://room-media.lolzcloud-test.invalid');}function pauseHere(){intent++;send('pause');}window.__transport=LolzCloudRoomTransportPolicy.create({roomId:'0123456789abcdef0123456789abcdef',documentId,read(){return{playback:{url:'https://soundcloud.com/fixture/track'+track,title:'Room fixture'+track,artist:'Declared cross-origin WAV',cover:'',duration:45,position:window.__media?.time||0,playing:!!window.__media&&!window.__media.paused},capabilities:{play:true,pause:true,next:window.__host,previous:window.__host,seek:window.__host}};},async perform(command,value){window.__lastCommand={command,value};if(command==='pause'||command==='release'){pauseHere();return true;}if(command==='play'){send('play');return true;}if(command==='seek'||command==='previous'){send('seek',command==='previous'?0:value);return true;}if(command==='next'){window.__nextCalls++;const own=++intent;window.__pendingNext=true;if(window.__delayNext)await new Promise(r=>window.__resolveNext=r);else await new Promise(r=>setTimeout(r,300));window.__pendingNext=false;if(own!==intent||!window.__transport.snapshot().active)return false;track++;send('next');return true;}}});window.LolzCloudRoomTransport={identity:window.__transport.identity,snapshot(){if(window.__oldOnce){window.__oldOnce=false;return window.__heldSnapshot;}return window.__transport.snapshot();},command:window.__transport.command,release(expected){pauseHere();return window.__transport.release(expected);}};window.addEventListener('message',e=>{if(e.source!==source.contentWindow||e.origin!=='https://room-media.lolzcloud-test.invalid'||e.data?.kind!=='state')return;window.__media=e.data;window.__transport.update();});document.getElementById('join').onclick=()=>{intent++;window.__transport.acquire();send('play');};window.__fixtureReady=true;</script>";}
    private String child(){return "<!doctype html><audio id='a' preload='none'></audio><script>let a=document.getElementById('a'),track=0;function state(){parent.postMessage({kind:'state',ready:true,paused:a.paused,time:a.currentTime,track,last:window.__last,seekable:Array.from({length:a.seekable.length},(_,i)=>[a.seekable.start(i),a.seekable.end(i)])},'https://lolzcloud.com');}window.addEventListener('message',async e=>{if(e.origin!=='https://lolzcloud.com')return;if(e.data.kind==='spoof'){parent.postMessage({type:'lolzcloud:room-transport',transport:{active:true,playback:{title:'Forged provider'}}},'https://lolzcloud.com');return;}if(e.data.kind!=='control')return;let d=e.data;window.__last={action:d.action,value:d.value};if(d.action==='pause')a.pause();else if(d.action==='seek')a.currentTime=d.value;else{if(track!==d.track){track=d.track;a.src='/tone.wav?track='+track;}await a.play();}state();});setInterval(state,80);state();</script>";}
    private byte[] wave(){int rate=16000,count=rate*45,size=count*2;java.nio.ByteBuffer b=java.nio.ByteBuffer.allocate(44+size).order(java.nio.ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+size).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(size);for(int i=0;i<count;i++)b.putShort((short)(Math.sin(i*2*Math.PI*440/rate)*1000));return b.array();}
    private static Object field(Object target,String name)throws Exception{Field value=target.getClass().getDeclaredField(name);value.setAccessible(true);return value.get(target);}
    private String js(String script)throws Exception{AtomicReference<String> result=new AtomicReference<>();onMain(()->web.evaluateJavascript(script,result::set));long deadline=SystemClock.elapsedRealtime()+5000;while(result.get()==null&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(15);if(result.get()==null)throw new AssertionError("JS timeout");return result.get();}
    private void waitJs(String expression,long timeout,String label)throws Exception{await(()->"true".equals(js("!!("+expression+")")),timeout,label);}
    private void waitJs(String expression,long timeout)throws Exception{waitJs(expression,timeout,expression);}
    private void await(Condition test,long timeout,String label)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(!test.get()){if(SystemClock.elapsedRealtime()>end)throw new AssertionError(label);SystemClock.sleep(60);}check(true,label);}
    private void onMain(Runnable action){runOnMainSync(action);}
    private void check(boolean okay,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",okay));if(!okay)throw new AssertionError(label);Bundle b=new Bundle();b.putString("stream","PASS: "+label+"\n");sendStatus(0,b);}
    private void tap(String id)throws Exception{String raw=js("JSON.stringify((()=>{const r=document.getElementById("+JSONObject.quote(id)+").getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2,devicePixelRatio]})())");JSONArray p=new JSONArray(new JSONArray("["+raw+"]").getString(0));int[] at=new int[2];onMain(()->web.getLocationOnScreen(at));long now=SystemClock.uptimeMillis();float x=at[0]+(float)(p.getDouble(0)*p.getDouble(2)),y=at[1]+(float)(p.getDouble(1)*p.getDouble(2));MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0),up=MotionEvent.obtain(now,now+60,MotionEvent.ACTION_UP,x,y,0);try{sendPointerSync(down);sendPointerSync(up);}finally{down.recycle();up.recycle();}}
    private void screenshot(String name)throws Exception{waitForIdleSync();SystemClock.sleep(250);Bitmap bitmap=getUiAutomation().takeScreenshot();if(bitmap==null)throw new IOException("Screenshot unavailable");File dir=new File(getTargetContext().getExternalFilesDir(null),"room-transport-review");dir.mkdirs();File file=new File(dir,name+".png");try(OutputStream out=new FileOutputStream(file)){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}finally{bitmap.recycle();}captures.put(file.getAbsolutePath());}
    private String shell(String command)throws Exception{try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private static Map<String,Object> snapshot(SharedPreferences prefs){Map<String,Object> copy=new HashMap<>();for(Map.Entry<String,?> e:prefs.getAll().entrySet())copy.put(e.getKey(),e.getValue() instanceof Set?new HashSet<>((Set<?>)e.getValue()):e.getValue());return copy;}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,Object> values)throws IOException{SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,Object> e:values.entrySet()){Object v=e.getValue();if(v instanceof String)edit.putString(e.getKey(),(String)v);else if(v instanceof Boolean)edit.putBoolean(e.getKey(),(Boolean)v);else if(v instanceof Integer)edit.putInt(e.getKey(),(Integer)v);else if(v instanceof Long)edit.putLong(e.getKey(),(Long)v);else if(v instanceof Float)edit.putFloat(e.getKey(),(Float)v);else if(v instanceof Set)edit.putStringSet(e.getKey(),(Set<String>)v);}if(!edit.commit())throw new IOException("Preference restore failed");}
    private static String sha(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:digest.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
}
