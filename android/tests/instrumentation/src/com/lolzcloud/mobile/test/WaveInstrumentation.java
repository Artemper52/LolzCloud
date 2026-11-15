package com.lolzcloud.mobile.test;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import com.lolzcloud.mobile.*;
import org.json.*;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Public Wave -> actual PCM, followed by explicit controlled-transport cancellation regressions. */
public final class WaveInstrumentation extends Instrumentation {
    private Bundle arguments;
    private MainActivity activity;
    private PlaybackService player;
    private LibraryStore store;
    private Controlled provider;
    private OnlineActivity roomActivity;
    private volatile boolean roomFixture;
    private static final String ROOM="https://lolzcloud.com/room/0123456789abcdef0123456789abcdef?wave-handoff-fixture=1";
    private File output,fixtures,backup;
    private final JSONArray checks=new JSONArray(),screenshots=new JSONArray();
    private final JSONObject live=new JSONObject();
    private interface Task{void run()throws Exception;}
    private interface Condition{boolean ready()throws Exception;}
    @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args;start();}
    @Override public void callActivityOnCreate(Activity target,Bundle state){
        super.callActivityOnCreate(target,state);
        if(roomFixture&&target instanceof OnlineActivity)try{
            WebView web=(WebView)field(target,"webView");web.getSettings().setJavaScriptEnabled(false);web.stopLoading();final WebViewClient original=web.getWebViewClient();
            web.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){if(ROOM.equals(request.getUrl().toString()))return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream("<!doctype html><meta name=viewport content='width=device-width'><title>Wave room handoff fixture</title><p>Declared room document fixture</p>".getBytes(StandardCharsets.UTF_8)));return original.shouldInterceptRequest(view,request);}
                @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return original.shouldOverrideUrlLoading(view,request);}
                @Override public void onPageStarted(WebView view,String url,Bitmap icon){original.onPageStarted(view,url,icon);}
                @Override public void onPageFinished(WebView view,String url){original.onPageFinished(view,url);}
            });web.loadUrl(ROOM);
        }catch(Exception failure){throw new RuntimeException(failure);}
    }
    @Override public void onStart(){JSONObject report=new JSONObject();Map<String,Object> original=null;boolean restored=false;int result=Activity.RESULT_OK;
        try{
            if(!"1".equals(shell("getprop ro.kernel.qemu").trim()))throw new AssertionError("Only the owned emulator is permitted");
            output=new File(getTargetContext().getExternalFilesDir(null),"wave-review");output.mkdirs();
            store=new LibraryStore(getTargetContext());backup=new File(getTargetContext().getFilesDir(),"wave-qa-original-prefs.json");
            if(backup.isFile()){restore(store.preferences(),decode(new JSONObject(read(backup))));if(!backup.delete())throw new IOException("Old QA backup recovery failed");}
            original=snapshot(store.preferences());writeFile(backup,encode(original).toString());
            store.preferences().edit().clear().putBoolean("notification_permission_asked",true).commit();
            fixtures=new File(getTargetContext().getCacheDir(),"wave-qa-"+System.nanoTime());if(!fixtures.mkdir())throw new IOException("Cannot create owned fixture directory");
            launch();
            if(arguments!=null&&"bookmark".equals(arguments.getString("phase"))){bookmarkProbe();}
            else{
            JSONObject defaultSignal=new JSONObject().put("id",919999).put("url","https://soundcloud.com/lolzcloud-qa/default-policy").put("title","QA default").put("artist","QA").put("duration",30);
            double defaultNovelty=store.waveSettings().getDouble("adventurous");store.markWavePlayed(defaultSignal,System.currentTimeMillis());
            check(defaultNovelty==.35&&store.waveSettings().getDouble("adventurous")==defaultNovelty,"A new Wave keeps its novelty setting when the first played fingerprint creates the portable snapshot");store.preferences().edit().remove("portable_profile").commit();
            JSONObject config=PortableProfile.normalize(new JSONObject().put("format","lolzcloud-profile").put("version",1));
            config.getJSONObject("music").getJSONObject("dsp").put("enabled",true).put("preampDb",-3).put("preservesPitch",true);
            store.importProfile(config.toString(),true);onMain(()->player.reloadSettings());
            Track gno=new OnlineCatalog().track("1930572542");store.rememberCatalog(gno);if(!store.isLiked(gno.id))store.toggleLike(gno.id);
            store.configureWave(new JSONObject().put("character","familiar"));
            long started=SystemClock.elapsedRealtime();touch("wave_start");
            await(()->player.waveState().active&&player.isPlaying()&&player.pcmSnapshot()!=null&&player.pcmSnapshot().playedFrames>16000,180000,"Public wave to actual AudioTrack");
            PcmPlayback.Snapshot pcm=player.pcmSnapshot();
            check(player.current().id.equals(gno.id)&&player.current().uri.equals(gno.uri),"Real public Wave resolves the known liked recording to the canonical signed in-app audio source");
            check(pcm.inputRms>1e-6&&pcm.acceptedFrames>0&&pcm.playedFrames>0&&field(player,"media")==null,"Real Wave MP3 goes through production MediaCodec/DSP/AudioTrack without parallel playback or a browser");
            live.put("source",player.current().sourceUrl).put("id",player.current().id).put("millisecondsToClock",SystemClock.elapsedRealtime()-started).put("acceptedFrames",pcm.acceptedFrames).put("playedFrames",pcm.playedFrames).put("inputRms",pcm.inputRms).put("outputRms",pcm.outputRms).put("audioSession",pcm.audioSession);
            SystemClock.sleep(1200);touch("wave_play");await(()->!player.isPlaying()&&!player.isLoading(),5000,"Pause real station");
            long position=player.position();SystemClock.sleep(200);check(Math.abs(player.position()-position)<80,"The visible Wave pause button stops the actual output clock");
            JSONObject sent=store.waveRequest("",0,null,new ArrayList<JSONObject>(),gno.sourceUrl,new ArrayList<JSONObject>(),System.currentTimeMillis());
            check(sent.getJSONArray("history").length()>0&&sent.getJSONArray("history").getJSONObject(0).getDouble("seconds")>0,"Listening seconds come from real progress and survive a pause");
            check(!sent.toString().contains("file:")&&!sent.toString().contains("content:")&&!sent.toString().contains("audioUrl")&&!sent.toString().contains("Cookie"),"Recommendation input contains whitelisted public metadata and no local URI, signed stream or cookie");
            JSONObject exported=new JSONObject(store.exportProfile());boolean found=false;for(String key:WaveApi.fingerprints(WaveApi.metadata(gno)))if(exported.getJSONObject("wave").getJSONObject("played24h").has(key))found=true;
            check(found,"The real Wave saves PC-compatible played24h fingerprints before handing off audio");capture("wave-live.png");

            Track manual=audio("manual",901,.1,30,910000),a=audio("alpha",910,.1,.25,910001),b=audio("beta",997,.1,.3,910002),c=audio("gamma",1200,.1,30,910003),d=audio("delta",1700,.1,30,910004),e=audio("epsilon",1900,.1,30,910005);
            Track oldOffline=new Track(c.id,"Old cached title","Old cached artist",c.uri,c.duration,c.addedAt,"https://soundcloud.com/lolzcloud-qa/old-gamma","");store.add(oldOffline);
            Track remoteC=c.withUri("https://lolzcloud.com/music/audio/910003/aaaaaaaaaaaaaaaaaaaaaaaa.mp3",c.duration);
            onMain(()->player.setQueue(Arrays.asList(manual),0,false));await(()->player.isPrepared(),10000,"Prepare manual fixture");installControlled();
            onMain(()->player.startWave("первый тестовый запрос",false));Pending stalePause=provider.take();
            onMain(()->player.pause());stalePause.release(batch(a,b));SystemClock.sleep(350);
            check(player.current().id.equals(manual.id)&&player.queue().size()==1&&!player.isPlaying()&&!player.isLoading(),"Pause fences a transport that ignores cancellation; its late first batch cannot replace the queue or autoplay");
            onMain(()->player.startWave("старый запрос",false));Pending older=provider.take();onMain(()->player.startWave("новый запрос",false));older.release(batch(a));Pending newer=provider.take();newer.release(batch(remoteC,d));
            await(()->player.current().id.equals(c.id)&&player.isPlaying(),10000,"Newest station request wins");SystemClock.sleep(150);
            check(player.current().id.equals(c.id)&&player.queue().size()==2,"A late result from the old station cannot cancel or overwrite the newer station");
            check(player.current().uri.equals(c.uri)&&player.current().sourceUrl.equals(c.sourceUrl)&&player.current().title.equals(c.title),"Verified Wave metadata updates the current identity while the existing private offline audio URI wins");
            await(()->provider.pending.size()>0,5000,"Service starts bounded prefetch");Pending prefetch=provider.take();onMain(()->player.pause());prefetch.release(batch(e));SystemClock.sleep(200);
            check(player.queue().size()==2&&!player.isPlaying(),"Pause also retires an in-flight background refill without appending or starting its result");
            onMain(()->player.startWave("ручная очередь побеждает",false));Pending manualWins=provider.take();onMain(()->player.setQueue(Arrays.asList(manual,manual),1,false));manualWins.release(batch(a,b));SystemClock.sleep(250);
            check(!player.waveState().active&&player.currentIndex()==1&&player.queue().size()==2&&!player.isPlaying(),"Manual queue keeps its exact duplicate index and pause after a late station response");

            // Fresh fixture IDs avoid the intentionally persistent24-hour exclusions of the preceding station.
            store.preferences().edit().remove("portable_profile").remove("wave_metadata").commit();
            onMain(()->{player.startWave("непрерывная тестовая волна",false);});Pending continuous=provider.take();
            Track duplicate=audio("alpha-official",910,.1,.25,910011);JSONObject duplicateMeta=WaveApi.metadata(duplicate);duplicateMeta.put("title",a.title+" (Official Audio)");
            List<WaveApi.Row> rows=new ArrayList<>();rows.add(row(a));rows.add(new WaveApi.Row(duplicate,duplicateMeta,"duplicate recording fixture"));rows.add(row(b));rows.add(row(c));
            MainActivity closedActivity=activity;onMain(()->closedActivity.finishAndRemoveTask());await(()->closedActivity.isDestroyed(),7000,"Close Activity during Wave preparation");continuous.release(new WaveApi.Batch(rows,3,"Тестовое время","непрерывная тестовая волна",""));
            await(()->player.current().id.equals(c.id)&&player.currentIndex()==2&&player.isPlaying()&&player.pcmSnapshot()!=null&&player.pcmSnapshot().playedFrames>8000,12000,"Service-owned natural continuation");
            check(player.queue().size()==3&&player.current().id.equals(c.id),"The service deduplicates recordings then advances exactly once through two real natural AudioTrack completions");
            long occurrence=player.waveOccurrence();WaveSession activeWave=(WaveSession)field(player,"wave");onMain(()->activeWave.completed(occurrence-1));SystemClock.sleep(120);
            check(player.currentIndex()==2&&player.current().id.equals(c.id),"A stale prior occurrence completion cannot consume the new recording");
            check((Boolean)field(player,"foreground")&&closedActivity.isDestroyed()&&player.isPlaying(),"Wave selection, PCM and refill remain owned by the foreground service after Activity destruction");
            Pending refill=provider.take();onMain(()->player.pause());refill.release(batch(d,e));SystemClock.sleep(200);
            check(player.queue().size()==3&&!player.isPlaying(),"Late refill after background pause preserves the existing station queue and silent output");
            long exact=player.waveOccurrence();onMain(()->player.reactWave("love",exact));
            JSONObject reaction=new JSONObject(store.exportProfile()).getJSONObject("wave").getJSONObject("feedback").getJSONObject(c.sourceUrl);
            check(reaction.getInt("loves")==1&&!reaction.getBoolean("banned"),"A real station reaction persists in the shared PC portable schema");
            store.configureWave(new JSONObject().put("genre","QA ambient"));onMain(()->player.undoWave());
            JSONObject afterUndo=new JSONObject(store.exportProfile()).getJSONObject("wave");
            check(!afterUndo.getJSONObject("feedback").has(c.sourceUrl)&&afterUndo.getJSONObject("preferences").getString("genre").equals("QA ambient")&&afterUndo.getJSONObject("played24h").length()>0,"Undo changes only its own feedback row and preserves concurrent settings and played fingerprints");
            boolean wrong=false;try{onMain(()->player.reactWave("ban",exact-1));}catch(IOException expected){wrong=true;}
            check(wrong&&!new JSONObject(store.exportProfile()).getJSONObject("wave").getJSONObject("feedback").has(c.sourceUrl),"Reaction with a stale exact occurrence is rejected without changing taste");
            LibraryStore.WaveUndo ban=store.reactWave(WaveApi.metadata(c),"artist-ban",0);store.undoWave(ban);
            check(new JSONObject(store.exportProfile()).getJSONObject("wave").getJSONArray("blockedArtists").length()==0,"Artist ban and its targeted Undo use the canonical persisted value");
            String before=store.preferences().getString("portable_profile","");boolean invalid=false;try{store.configureWave(new JSONObject().put("mood","forged"));}catch(IOException expected){invalid=true;}
            check(invalid&&before.equals(store.preferences().getString("portable_profile","")),"Invalid Wave settings fail before mutation");
            store.setPrivateMode(true);String privateBefore=store.preferences().getString("portable_profile","");store.markWavePlayed(WaveApi.metadata(d),System.currentTimeMillis());boolean rejected=false;try{store.reactWave(WaveApi.metadata(c),"love",0);}catch(IOException expected){rejected=true;}
            JSONObject privateRequest=store.waveRequest("мой явный запрос",0,null,Arrays.asList(WaveApi.metadata(c)),c.sourceUrl,new ArrayList<JSONObject>(),System.currentTimeMillis());
            check(rejected&&privateBefore.equals(store.preferences().getString("portable_profile",""))&&privateRequest.getJSONArray("history").length()==0&&privateRequest.getJSONObject("feedback").length()==0&&privateRequest.getJSONArray("recent").length()==0&&privateRequest.getString("current").isEmpty(),"Private mode suppresses history, implicit current/recent and feedback without writing a new taste signal");store.setPrivateMode(false);

            Track legacyShort=audio("legacy-short",1300,.1,.3,910101),legacyLong=audio("legacy-long",1400,.1,30,910102);
            onMain(()->{player.stopWave();player.setPortableEnabled(false);player.setNormalization(false);player.startWave("проверка обычного движка",false);});provider.take().release(batch(legacyShort,legacyLong));
            await(()->player.current().id.equals(legacyLong.id)&&player.currentIndex()==1&&player.isPlaying()&&field(player,"media")!=null,10000,"Legacy MediaPlayer Wave natural end");
            check(!player.pcmActive()&&player.queue().size()==2,"The unprocessed legacy MediaPlayer also advances Wave exactly once through real natural completion");
            Pending legacyRefill=provider.take();onMain(()->player.pause());legacyRefill.release(batch(e));SystemClock.sleep(100);

            onMain(()->player.startWave("комната отменяет ожидающий подбор",false));Pending roomPending=provider.take();String beforeRoom=player.current().id;int roomQueue=player.queue().size();openRoom();
            await(()->!player.waveState().loading&&!player.isPlaying(),5000,"Production room document pauses a pending Wave request");roomPending.release(batch(e));SystemClock.sleep(300);
            check(player.current().id.equals(beforeRoom)&&player.queue().size()==roomQueue&&!player.isPlaying()&&!player.isLoading(),"Actual OnlineActivity room entry fences the pending Wave POST; its late result cannot replace native audio or mix over the room");closeRoom();launch();
            onMain(()->{player.stopWave();player.setPortableEnabled(true);player.setNormalization(false);player.setQueue(Arrays.asList(manual,c),0,true);});
            await(()->player.pcmSnapshot()!=null&&player.isPlaying()&&player.pcmSnapshot().playedFrames>12000,10000,"Native PCM before room handoff");openRoom();await(()->!player.isPlaying(),5000,"Actual room pauses PCM");long roomPosition=player.position();SystemClock.sleep(250);
            check(Math.abs(player.position()-roomPosition)<80&&!(Boolean)field(player,"hasFocus")&&!(Boolean)field(player,"focusRequested")&&!(Boolean)field(player,"resumeOnFocus"),"Production room navigation pauses the real PCM output clock and abandons native focus without a resume-on-focus intent");closeRoom();

            onMain(()->{player.stopWave();player.setNormalization(true);});JSONObject unchecked=PortableProfile.normalize(new JSONObject().put("format","lolzcloud-profile").put("version",1));unchecked.getJSONObject("tools").put("normalization",false);store.importProfile(unchecked.toString(),false);onMain(()->{player.reloadSettings();player.resetEffects();});
            store.configureWave(new JSONObject().put("mood","calm"));onMain(()->{player.reloadSettings();player.setQueue(Arrays.asList(manual,c),0,false);});await(()->player.isPrepared(),10000,"PCM after Wave profile mutation");
            check(player.normalization()&&player.normalizationPending()&&!player.isPlaying(),"Wave sidecar edits preserve the unchecked normalization decision on the next real prepared PCM source");
            JSONObject parserFixture=catalogResponse(gno);check(WaveApi.parse(parserFixture.toString()).tracks.size()==1,"Wave response parser accepts the real canonical signed metadata contract");
            for(String unsafe:new String[]{gno.sourceUrl,"http://lolzcloud.com/music/audio/1930572542/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://evil.example/song.mp3"}){JSONObject corrupt=catalogResponse(gno);corrupt.getJSONArray("tracks").getJSONObject(0).put("audioUrl",unsafe);boolean failed=false;try{WaveApi.parse(corrupt.toString());}catch(IOException expected){failed=true;}check(failed,"Wave parser rejects a non-audio source or an untrusted stream "+checks.length());}

            shutdown();launch();
            check(!player.waveState().active&&!player.waveState().loading&&!player.isPlaying()&&player.current()!=null,"Service recreation restores its queue and applied sound without reactivating recommendations or autoplay");
            check(store.waveSettings().getJSONObject("preferences").getString("mood").equals("calm"),"Wave preferences survive actual service and Activity recreation");
            onMain(()->{android.widget.EditText input=activity.findViewById(android.R.id.content).findViewWithTag("wave_prompt");input.setText("сохранённый черновик волны");});
            ActivityMonitor monitor=addMonitor(MainActivity.class.getName(),null,false);onMain(()->activity.recreate());activity=(MainActivity)waitForMonitorWithTimeout(monitor,7000);removeMonitor(monitor);if(activity==null)throw new AssertionError("Main recreated");await(()->field(activity,"player")!=null,7000,"Rebind after recreation");player=(PlaybackService)field(activity,"player");
            waitForIdleSync();final boolean[] draft={false};onMain(()->{android.widget.EditText input=activity.findViewById(android.R.id.content).findViewWithTag("wave_prompt");draft[0]=input!=null&&input.getText().toString().equals("сохранённый черновик волны");});
            check(draft[0],"Native Wave draft survives real Activity recreation");capture("wave-restored.png");
            }
            report.put("status","passed");
        }catch(Throwable failure){result=Activity.RESULT_CANCELED;try{StringWriter trace=new StringWriter();failure.printStackTrace(new PrintWriter(trace));report.put("status","failed").put("error",failure.toString()).put("stack",trace.toString()).put("playbackError",player==null?"":player.error());if(player!=null)report.put("waveError",player.waveState().error);}catch(Exception ignored){}}
        finally{
            try{if(provider!=null)provider.releaseAll();closeRoom();shutdown();}catch(Throwable failure){result=Activity.RESULT_CANCELED;try{report.put("status","failed").put("cleanupError",failure.toString());}catch(Exception ignored){}}
            try{if(original!=null){restore(store.preferences(),original);restored=snapshot(store.preferences()).equals(original);if(restored&&backup!=null)backup.delete();}if(fixtures!=null&&fixtures.getCanonicalFile().getParentFile().equals(getTargetContext().getCacheDir().getCanonicalFile())){File[] files=fixtures.listFiles();if(files!=null)for(File file:files)if(file.isFile())file.delete();fixtures.delete();}}catch(Throwable failure){result=Activity.RESULT_CANCELED;try{report.put("status","failed").put("restoreError",failure.toString());}catch(Exception ignored){}}
        }
        try{android.content.pm.PackageInfo info=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0);report.put("checks",checks).put("live",live).put("screenshots",screenshots).put("preferencesRestored",restored).put("runId",arguments==null?"":arguments.getString("runId","")).put("version",info.versionName).put("versionCode",info.versionCode).put("apkSha256",sha(new File(info.applicationInfo.sourceDir))).put("scope","Real public /music/wave + known liked MP3 through MediaCodec/DSP/AudioTrack; genuine native start/pause touch. Cancellation/refill/end tests then use an explicitly controlled provider and generated private WAV fixtures with test metadata. Actual service, SharedPreferences, natural audio completions, background and Activity recreation. No personal account, protected-source, physical acoustic or arbitrary provider-success claim.");write("android-wave-test.json",report.toString(2));Bundle response=new Bundle();response.putString("stream",report.toString(2));finish(result,response);}catch(Throwable failure){Bundle response=new Bundle();response.putString("stream",failure.toString());finish(Activity.RESULT_CANCELED,response);}
    }

    private void installControlled()throws Exception{provider=new Controlled();onMain(()->{WaveSession old=(WaveSession)field(player,"wave");WaveSession.Host host=(WaveSession.Host)field(old,"host");old.close();setField(player,"wave",new WaveSession(store,host,provider));});}
    private void bookmarkProbe()throws Exception{
        JSONObject config=PortableProfile.normalize(new JSONObject().put("format","lolzcloud-profile").put("version",1));config.getJSONObject("music").getJSONObject("dsp").put("enabled",true);store.importProfile(config.toString(),true);onMain(()->player.reloadSettings());
        Track ephemeral=audio("bookmark-ephemeral",1000,.1,30,910201);installControlled();onMain(()->player.startWave("тест момента новой волны",false));provider.take().release(batch(ephemeral));
        await(()->player.isPlaying()&&player.current().id.equals(ephemeral.id),10000,"Play ephemeral Wave occurrence");onMain(()->player.pause());
        check(store.find(ephemeral.id)==null,"A new Wave recording stays ephemeral before an explicit save action");
        long position=player.position();
        onMain(()->{java.lang.reflect.Method navigate=MainActivity.class.getDeclaredMethod("navigate",String.class);navigate.setAccessible(true);navigate.invoke(activity,"player");});waitForIdleSync();View[] more={null};onMain(()->more[0]=description(activity.findViewById(android.R.id.content),"Действия с треком"));if(more[0]==null)throw new AssertionError("Actual player menu opener");tapView(more[0]);
        await(()->{
            android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();if(root==null)return false;
            boolean clicked=false;List<android.view.accessibility.AccessibilityNodeInfo> nodes=root.findAccessibilityNodeInfosByText("Сохранить момент");for(android.view.accessibility.AccessibilityNodeInfo node:nodes){if(!clicked&&node.isVisibleToUser()){android.view.accessibility.AccessibilityNodeInfo target=node;while(target!=null&&!target.isClickable())target=target.getParent();if(target!=null)clicked=target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);}node.recycle();}root.recycle();return clicked;
        },5000,"Genuine native PopupMenu save-moment action");waitForIdleSync();
        JSONObject profile=new JSONObject(store.exportProfile());JSONArray moments=profile.getJSONObject("tools").getJSONArray("bookmarks");boolean exported=false;for(int i=0;i<moments.length();i++)if(ephemeral.sourceUrl.equals(moments.getJSONObject(i).getString("url")))exported=true;
        check(store.find(ephemeral.id)!=null&&store.bookmarks(ephemeral.id).size()==1&&exported,"Saving a Wave moment also retains its metadata for the visible list and common portable export");
        check(!player.isPlaying()&&player.queue().size()==1&&player.current().id.equals(ephemeral.id)&&Math.abs(player.position()-position)<80,"Explicit Wave bookmark save preserves the exact current occurrence, queue and pause");
        onMain(()->{java.lang.reflect.Method navigate=MainActivity.class.getDeclaredMethod("navigate",String.class);navigate.setAccessible(true);navigate.invoke(activity,"bookmarks");});waitForIdleSync();
        android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();boolean visible=root!=null&&!root.findAccessibilityNodeInfosByText(ephemeral.title).isEmpty();if(root!=null)root.recycle();
        check(visible&&!profile.toString().contains("file:")&&!profile.toString().contains("content:"),"The actual native moments page shows the saved Wave track while exported JSON excludes its private file URI");capture("wave-bookmark.png");
    }
    private void openRoom()throws Exception{roomFixture=true;roomActivity=(OnlineActivity)startActivitySync(new Intent(getTargetContext(),OnlineActivity.class).putExtra("url",ROOM).putExtra("title","Проверка перехода в комнату").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));await(()->{String[] url={null};onMain(()->url[0]=((WebView)field(roomActivity,"webView")).getUrl());return ROOM.equals(url[0]);},7000,"Declared real WebView room document");waitForIdleSync();}
    private void closeRoom()throws Exception{if(roomActivity!=null&&!roomActivity.isDestroyed()){OnlineActivity old=roomActivity;onMain(old::finish);await(old::isDestroyed,5000,"Close room document");}roomActivity=null;roomFixture=false;}
    private WaveApi.Row row(Track track)throws Exception{JSONObject metadata=WaveApi.metadata(track);metadata.put("genre","QA ambient");return new WaveApi.Row(track,metadata,"Generated recommendation fixture");}
    private WaveApi.Batch batch(Track...tracks)throws Exception{List<WaveApi.Row> rows=new ArrayList<>();for(Track track:tracks)rows.add(row(track));return new WaveApi.Batch(rows,1,"Тестовое время","","");}
    private JSONObject catalogResponse(Track track)throws Exception{return new JSONObject().put("version",1).put("nextCursor",1).put("context","").put("request",JSONObject.NULL).put("tracks",new JSONArray().put(new JSONObject().put("id",track.id.substring(11)).put("url",track.sourceUrl).put("title",track.title).put("artist",track.artist).put("cover",track.coverUrl).put("duration",track.duration/1000d).put("audioUrl",track.uri)));}
    private static final class Pending{
        final JSONObject body;final CountDownLatch done=new CountDownLatch(1);volatile WaveApi.Batch batch;
        Pending(JSONObject body){this.body=body;}
        void release(WaveApi.Batch batch){this.batch=batch;done.countDown();}
    }
    private static final class Controlled implements WaveSession.Provider{
        final BlockingQueue<Pending> pending=new LinkedBlockingQueue<>();final List<Pending> all=Collections.synchronizedList(new ArrayList<Pending>());
        public WaveApi.Batch recommend(JSONObject body)throws IOException{Pending row=new Pending(body);all.add(row);pending.add(row);long until=SystemClock.elapsedRealtime()+20000;while(row.done.getCount()>0){try{row.done.await(100,TimeUnit.MILLISECONDS);}catch(InterruptedException ignored){/* Deliberately uncancellable transport exercises the real generation fence. */}if(SystemClock.elapsedRealtime()>until)throw new IOException("Controlled fixture was not released");}return row.batch;}
        public void cancel(){ }
        Pending take()throws Exception{Pending row=pending.poll(8000,TimeUnit.MILLISECONDS);if(row==null)throw new AssertionError("Expected a bounded Wave request");return row;}
        void releaseAll(){synchronized(all){for(Pending row:all)row.release(new WaveApi.Batch(Collections.<WaveApi.Row>emptyList(),0,"","",""));}}
    }
    private Track audio(String name,double frequency,double amplitude,double seconds,long id)throws Exception{File file=new File(fixtures,name+".wav");int frames=(int)Math.round(48000*seconds),bytes=frames*4;try(OutputStream out=new BufferedOutputStream(new FileOutputStream(file))){out.write("RIFF".getBytes("US-ASCII"));le(out,bytes+36,4);out.write("WAVEfmt ".getBytes("US-ASCII"));le(out,16,4);le(out,1,2);le(out,2,2);le(out,48000,4);le(out,192000,4);le(out,4,2);le(out,16,2);out.write("data".getBytes("US-ASCII"));le(out,bytes,4);for(int i=0;i<frames;i++){int sample=(int)Math.round(amplitude*Math.sin(2*Math.PI*frequency*i/48000)*32767);le(out,sample,2);le(out,sample,2);}}return new Track("soundcloud:"+id,"Wave QA "+name,"Generated Wave QA",Uri.fromFile(file).toString(),Math.round(seconds*1000),System.currentTimeMillis(),"https://soundcloud.com/lolzcloud-qa/"+name,"");}
    private void launch()throws Exception{activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));await(()->field(activity,"player")!=null,10000,"Bind service");player=(PlaybackService)field(activity,"player");}
    private void shutdown()throws Exception{PlaybackService previous=player;onMain(()->{if(previous!=null)previous.stopPlayback();if(activity!=null&&!activity.isDestroyed())activity.finishAndRemoveTask();getTargetContext().stopService(new Intent(getTargetContext(),PlaybackService.class));});if(previous!=null)await(()->(Boolean)field(previous,"destroyed"),10000,"Release service");}
    private void touch(String tag)throws Exception{View[] target={null};onMain(()->{target[0]=activity.findViewById(android.R.id.content).findViewWithTag(tag);if(target[0]==null)throw new AssertionError("Missing control "+tag);target[0].requestRectangleOnScreen(new android.graphics.Rect(0,0,target[0].getWidth(),target[0].getHeight()),true);});SystemClock.sleep(180);int[] location=new int[2];onMain(()->target[0].getLocationOnScreen(location));long now=SystemClock.uptimeMillis();float x=location[0]+target[0].getWidth()/2f,y=location[1]+target[0].getHeight()/2f;for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,x,y,0);getUiAutomation().injectInputEvent(event,true);event.recycle();SystemClock.sleep(30);}}
    private void tapView(View target)throws Exception{int[] location=new int[2];onMain(()->target.getLocationOnScreen(location));long now=SystemClock.uptimeMillis();float x=location[0]+target.getWidth()/2f,y=location[1]+target.getHeight()/2f;for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,x,y,0);getUiAutomation().injectInputEvent(event,true);event.recycle();SystemClock.sleep(45);}}
    private static View description(View root,String text){if(text.contentEquals(root.getContentDescription()==null?"":root.getContentDescription()))return root;if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++){View found=description(group.getChildAt(i),text);if(found!=null)return found;}}return null;}
    private void onMain(Task task)throws Exception{Throwable[] problem={null};runOnMainSync(()->{try{task.run();}catch(Throwable failure){problem[0]=failure;}});if(problem[0] instanceof Error)throw(Error)problem[0];if(problem[0]!=null)throw(Exception)problem[0];}
    private void await(Condition condition,long timeout,String message)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(!condition.ready()){if(SystemClock.elapsedRealtime()>end)throw new AssertionError(message+(player==null?"":"; audio="+player.error()+"; wave="+player.waveState().error));SystemClock.sleep(35);}}
    private void check(boolean value,String message)throws Exception{if(!value)throw new AssertionError(message);checks.put(message);write("progress.json",new JSONObject().put("checks",checks).toString());}
    private void capture(String name)throws Exception{SystemClock.sleep(400);Bitmap image=getUiAutomation().takeScreenshot();if(image!=null){try(OutputStream out=new FileOutputStream(new File(output,name))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();screenshots.put(name);}}
    private static Object field(Object object,String name)throws Exception{Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(object);}
    private static void setField(Object object,String name,Object value)throws Exception{Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);field.set(object,value);}
    private String shell(String command)throws IOException{try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[8192];int count;while((count=in.read(bytes))!=-1)out.write(bytes,0,count);return out.toString("UTF-8");}}
    private void write(String name,String value)throws IOException{writeFile(new File(output,name),value);}
    private static void writeFile(File file,String value)throws IOException{try(OutputStream out=new FileOutputStream(file)){out.write(value.getBytes(StandardCharsets.UTF_8));}}
    private static String read(File file)throws IOException{try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[8192];int count;while((count=in.read(bytes))!=-1)out.write(bytes,0,count);return out.toString("UTF-8");}}
    private static void le(OutputStream out,int value,int count)throws IOException{for(int i=0;i<count;i++)out.write(value>>>(i*8)&255);}
    private static Map<String,Object> snapshot(SharedPreferences prefs){Map<String,Object> values=new HashMap<>();for(Map.Entry<String,?> row:prefs.getAll().entrySet())values.put(row.getKey(),row.getValue() instanceof Set?new HashSet<>((Set<?>)row.getValue()):row.getValue());return values;}
    private static JSONObject encode(Map<String,Object> values)throws JSONException{JSONObject result=new JSONObject();for(Map.Entry<String,Object> row:values.entrySet()){Object value=row.getValue();String kind=value instanceof String?"string":value instanceof Boolean?"boolean":value instanceof Integer?"int":value instanceof Long?"long":value instanceof Float?"float":"set";result.put(row.getKey(),new JSONObject().put("type",kind).put("value",value instanceof Set?new JSONArray((Set<?>)value):value));}return result;}
    private static Map<String,Object> decode(JSONObject input)throws JSONException{Map<String,Object> result=new HashMap<>();for(Iterator<String> keys=input.keys();keys.hasNext();){String key=keys.next();JSONObject row=input.getJSONObject(key);String kind=row.getString("type");Object value;if(kind.equals("string"))value=row.getString("value");else if(kind.equals("boolean"))value=row.getBoolean("value");else if(kind.equals("int"))value=row.getInt("value");else if(kind.equals("long"))value=row.getLong("value");else if(kind.equals("float"))value=(float)row.getDouble("value");else{Set<String> set=new HashSet<>();JSONArray array=row.getJSONArray("value");for(int i=0;i<array.length();i++)set.add(array.getString(i));value=set;}result.put(key,value);}return result;}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,Object> values)throws IOException{SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,Object> row:values.entrySet()){String key=row.getKey();Object value=row.getValue();if(value instanceof String)edit.putString(key,(String)value);else if(value instanceof Boolean)edit.putBoolean(key,(Boolean)value);else if(value instanceof Integer)edit.putInt(key,(Integer)value);else if(value instanceof Long)edit.putLong(key,(Long)value);else if(value instanceof Float)edit.putFloat(key,(Float)value);else if(value instanceof Set)edit.putStringSet(key,(Set<String>)value);}if(!edit.commit())throw new IOException("Preference restoration failed");}
    private static String sha(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] bytes=new byte[8192];int count;while((count=in.read(bytes))!=-1)digest.update(bytes,0,count);}StringBuilder result=new StringBuilder();for(byte value:digest.digest())result.append(String.format(Locale.ROOT,"%02x",value&255));return result.toString();}
}
