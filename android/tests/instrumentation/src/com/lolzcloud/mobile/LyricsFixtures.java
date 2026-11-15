package com.lolzcloud.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Only in the test APK: declared lyrics responses; real native views, files and MediaPlayer. */
public final class LyricsFixtures {
    private final Instrumentation test;
    private final JSONArray checks=new JSONArray();
    private final JSONArray captures=new JSONArray();
    private MainActivity activity;
    private PlaybackService player;
    private LibraryStore store;
    private final AtomicInteger mode=new AtomicInteger(),calls=new AtomicInteger();
    private final List<String> paths=new ArrayList<>();
    private volatile CountDownLatch started,release;
    private interface Condition{boolean get()throws Exception;}
    public LyricsFixtures(Instrumentation test){this.test=test;}
    public JSONArray checks(){return checks;}
    public JSONArray captures(){return captures;}
    public JSONArray run()throws Exception{
        Context context=test.getTargetContext();store=new LibraryStore(context);Map<String,?> before=store.preferences().getAll();
        SharedPreferences metadata=context.getSharedPreferences("lyrics-test-"+UUID.randomUUID(),Context.MODE_PRIVATE);
        File directory=new File(context.getCacheDir(),"lyrics-test-"+UUID.randomUUID()),audio=new File(context.getCacheDir(),"lyrics-audio-"+UUID.randomUUID()+".mp3");
        LyricsProvider provider=new LyricsProvider((path,deadline)->response(path));LyricsRepository repository=new LyricsRepository(provider,metadata,directory);
        try{
            store.preferences().edit().clear().putBoolean("notification_permission_asked",true).commit();
            try(InputStream input=test.getContext().getAssets().open("fixtures/night-route.mp3");FileOutputStream output=new FileOutputStream(audio)){byte[] data=new byte[8192];int count;while((count=input.read(data))!=-1)output.write(data,0,count);}
            activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            await(()->{player=(PlaybackService)field(activity,"player");return player!=null;},15000,"Production MediaPlayer service binds for lyrics integration");
            final Track first=new Track("lyrics-test-first","Fixture Song","Fixture Singer",android.net.Uri.fromFile(audio).toString(),40000);
            final Track second=new Track("lyrics-test-second","Second Song","Second Singer",first.uri,40000);
            onMain(()->{set(activity,"lyricsRepository",repository);player.stopPlayback();player.setRepeat(0);player.setShuffle(false);player.setQueue(Arrays.asList(first,second),0,true);});
            await(()->player.isPlaying()&&player.position()>250,10000,"Real local audio advances before opening lyrics");
            check(!player.pcmActive(),"Lyrics fixture explicitly uses the genuine legacy MediaPlayer with neutral audio preferences");
            mode.set(0);started=new CountDownLatch(1);release=new CountDownLatch(1);
            onMain(()->call(activity,"navigate",new Class<?>[]{String.class},"lyrics"));
            check(started.await(5,TimeUnit.SECONDS),"Declared provider is requested by the production lyrics page");
            await(()->tag("lyrics_loading")!=null&&tag("lyrics_loading").getVisibility()==View.VISIBLE,3000,"Native lyrics page displays loading while the request is in flight");
            long position=player.position();SystemClock.sleep(350);check(player.isPlaying()&&player.position()>position,"Opening/loading lyrics never pauses or restarts native music");
            release.countDown();await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==3,5000,"Matched source text becomes actual native lyric views");
            capture("lyrics-found");
            check(((List<LrcParser.Line>)field(activity,"lyricLines")).get(2).time==10000,"Production UI retains source timestamps rather than estimating line times");
            tap(lines().get(2));await(()->player.position()>=9700&&player.position()<12500,3000,"Touching a timed native line seeks the real MediaPlayer");
            await(()->((Integer)field(activity,"activeLyric"))==2,2000,"Playback position highlights the current genuine timed line");
            check(player.queue().size()==2&&player.current().id.equals(first.id),"Lyrics interaction preserves the current native queue and track");

            LyricsMetadata.Query query=new LyricsMetadata.Query(first.title,first.artist,player.duration());int fetched=calls.get();
            LyricsProvider.Result cached=repository.load(first.id,query,false);check(cached.timed&&calls.get()==fetched,"Successful automatic lyrics persist separately and can load without another network request");
            LyricsProvider.Result unknown=repository.load(first.id,new LyricsMetadata.Query("Temporary reupload label","Temporary account",0),false);check(unknown.timed&&calls.get()==fetched,"Completed same-recording lyrics survive transient unknown duration and uploader metadata without a new fetch");
            LyricsProvider.Result nearby=repository.load(first.id,new LyricsMetadata.Query("Different formatting","Upload account",query.duration+2490),false);check(nearby.timed&&calls.get()==fetched,"Same recording reuses completed timings across measured duration jitter below2.5s");
            repository.load("imported-url-alias","https://soundcloud.com/fixture/shared-recording",query,false);int sourceCalls=calls.get();LyricsProvider.Result migrated=repository.load("soundcloud:12345","https://soundcloud.com/fixture/shared-recording",new LyricsMetadata.Query("Temporary title","Temporary uploader",0),false);check(migrated.timed&&calls.get()==sourceCalls,"Canonical source URL reuses a completed match after alias-to-numeric-ID migration");fetched=calls.get();
            provider.cancel();cached=repository.load(first.id,query,false);check(cached.timed&&calls.get()==fetched,"Cancelling another lookup never deletes a completed positive recording cache");
            mode.set(1);clickRetry();await(()->!((Boolean)field(activity,"lyricsLoading"))&&tag("lyrics_error")!=null,5000,"Network/provider failures expose an actual Retry state instead of a false not-found result");
            capture("lyrics-error");
            check(player.current().id.equals(first.id)&&player.isPlaying(),"A lyric network error leaves audio playing");
            check(lines().size()==3&&((List<LrcParser.Line>)field(activity,"lyricLines")).get(2).time==10000,"A failed refresh leaves known-good same-recording lyrics visible beside Retry");
            mode.set(2);clickRetry();await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==3,5000,"A later successful provider miss does not overwrite completed same-recording text");
            check(tag("lyrics_error")==null&&((String)field(activity,"lyricsError")).isEmpty(),"A refresh miss keeps existing good text without inventing a network error");
            LyricsProvider.Result changed=repository.load(first.id,new LyricsMetadata.Query(first.title,first.artist,query.duration+20000),false);check(!changed.found(),"A different known recording duration cannot reuse earlier synchronized or written cache entries");
            mode.set(3);repository.resetIdentity(first.id);clickRetry();await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==1,5000,"Explicit identity reset permits a fresh different-duration written match");
            capture("lyrics-plain");
            check(((List<LrcParser.Line>)field(activity,"lyricLines")).get(0).time==-1&&!lines().get(0).hasOnClickListeners(),"Different-version written text has no seek action or synthetic synchronization");

            mode.set(4);onMain(()->tag("lyrics_identity").performClick());
            await(()->findDialog()!=null,3000,"Metadata correction opens an actual native dialog");
            AlertDialog dialog=findDialog();onMain(()->{((EditText)dialog.getWindow().getDecorView().findViewWithTag("lyrics_title")).setText("Corrected Song");((EditText)dialog.getWindow().getDecorView().findViewWithTag("lyrics_artist")).setText("Corrected Singer");dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();});
            await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==1&&lines().get(0).getText().toString().equals("Corrected fixture"),5000,"Explicit corrected metadata drives a new successful native lookup");
            LyricsRepository reopened=new LyricsRepository(provider,metadata,directory);check(reopened.identity(first.id,first.title,first.artist,40000).artist.equals("Corrected Singer"),"Manual lookup identity survives repository recreation for that recording");
            check(player.current().title.equals(first.title)&&player.current().artist.equals(first.artist),"Lyrics metadata correction never changes the playing track's real metadata");

            mode.set(6);final Track variant=new Track("lyrics-test-speedup","Fixture Singer - Fixture Song (speedup)","Reupload account",first.uri,40000);onMain(()->player.setQueue(Arrays.asList(variant,second),0,true));
            await(()->{LyricsProvider.Result value=(LyricsProvider.Result)field(activity,"automaticLyrics");return !((Boolean)field(activity,"lyricsLoading"))&&lines().size()==2&&value!=null&&value.adapted&&Math.abs(value.adaptationRate-50000d/value.duration)<.000001&&((List<LrcParser.Line>)field(activity,"lyricLines")).get(1).time==Math.round(20000/value.adaptationRate);},8000,"Marked reupload uses canonical search and duration-retimed real native lines");
            check(hasText(activity.getWindow().getDecorView(),"LRCLIB · Под версию · 1.25× (по длительности)"),"Native UI identifies duration-estimated adaptation rather than claiming acoustic detection");
            long adaptedMoment=((List<LrcParser.Line>)field(activity,"lyricLines")).get(1).time;int variantCalls=calls.get();LyricsMetadata.Query variantQuery=repository.identity(variant.id,variant.title,variant.artist,player.duration());LyricsProvider.Result adapted=repository.load(variant.id,variantQuery,false);check(adapted.adapted&&adapted.referenceEvidence.equals("catalog-consensus")&&LrcParser.parse(adapted.text).get(1).time==adaptedMoment&&calls.get()==variantCalls,"Adapted consensus result survives disk cache without another fetch or second timestamp scaling");
            onMain(()->{player.setSpeed(1.4f);player.setPitch(.9f);call(activity,"render",new Class<?>[0]);});check(((List<LrcParser.Line>)field(activity,"lyricLines")).get(1).time==adaptedMoment&&calls.get()==variantCalls,"Changing native tempo/tone never rescales source lyric timestamps or starts another lookup");onMain(()->player.pause());capture("lyrics-adapted");tap(lines().get(1));await(()->!player.isPlaying()&&Math.abs(player.position()-adaptedMoment)<100,3000,"Touching a retimed line seeks real native source position exactly once and preserves pause");
            onMain(()->{player.setSpeed(1);player.setPitch(1);player.setQueue(Arrays.asList(first,second),0,true);});await(()->player.current().id.equals(first.id)&&!((Boolean)field(activity,"lyricsLoading")),5000,"Return to the corrected first recording");

            mode.set(5);started=new CountDownLatch(1);release=new CountDownLatch(1);clickRetry();check(started.await(5,TimeUnit.SECONDS),"A delayed first-track request is genuinely in flight");
            onMain(()->player.playIndex(1));release.countDown();await(()->player.current().id.equals(second.id)&&!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==1&&lines().get(0).getText().toString().equals("Second-track fixture"),6000,"Track change cancels stale lyrics and presents only the new recording's response");
            check(!lines().get(0).getText().toString().contains("Old"),"A late old-track response cannot overwrite the next track");
            int beforeImport=calls.get();onMain(()->{store.saveLyrics(second.id,"[00:01.00]My imported fixture\n[00:03.00]My other fixture");call(activity,"render",new Class<?>[0]);});
            await(()->lines().size()==2&&lines().get(0).getText().toString().equals("My imported fixture"),3000,"User-imported LRC takes priority over an automatic result");
            check(calls.get()==beforeImport&&tag("lyrics_retry")==null,"Opening imported lyrics does not issue an automatic lookup or overwrite the user's text");
            check(store.lyrics(second.id).contains("My imported fixture"),"Automatic result cache never writes the LibraryStore imported-lyrics field");
            onMain(()->{player.pause();store.saveLyrics(second.id,"[offset:250]\n[00:01]<00:01>My <00:01.5>imported <00:02>fixture<00:03>");call(activity,"render",new Class<?>[0]);player.seekTo(1800);});
            await(()->player.position()>=1700&&player.position()<1950&&(Integer)field(activity,"activeLyricWord")==1,4000,"Paused source position selects the real imported enhanced-LRC word");
            LrcParser.Line wordLine=((List<LrcParser.Line>)field(activity,"lyricLines")).get(0);
            check(wordLine.words.size()==3&&wordLine.words.get(1).time==1750&&wordLine.words.get(2).end==3250,"Actual native model retains immutable imported word start/end timestamps with one offset");
            android.text.Spanned words=(android.text.Spanned)lines().get(0).getText();android.text.style.ForegroundColorSpan[] highlights=words.getSpans(0,words.length(),android.text.style.ForegroundColorSpan.class);
            check(highlights.length==1&&words.subSequence(words.getSpanStart(highlights[0]),words.getSpanEnd(highlights[0])).toString().equals("imported"),"The real TextView highlights the source word rather than the entire enhanced line");
            check(!player.isPlaying()&&player.current().id.equals(second.id)&&player.queue().size()==2,"Word updates and paused seeking preserve playback intent and the exact queue");
            capture("lyrics-word-highlight");
            onMain(()->tag("lyrics_remove_own").performClick());AlertDialog oldRemoval=findDialog();
            onMain(()->{store.saveLyrics(second.id,"[00:01]Newer imported fixture");oldRemoval.getButton(AlertDialog.BUTTON_POSITIVE).performClick();});
            test.waitForIdleSync();
            check(store.lyrics(second.id).contains("Newer imported fixture"),"A stale remove confirmation cannot delete a newer import of the same recording");
            onMain(()->{call(activity,"render",new Class<?>[0]);tag("lyrics_remove_own").performClick();});AlertDialog remove=findDialog();onMain(()->remove.getButton(AlertDialog.BUTTON_POSITIVE).performClick());
            await(()->store.lyrics(second.id).isEmpty()&&tag("lyrics_retry")!=null&&!((Boolean)field(activity,"lyricsLoading"))&&lines().get(0).getText().toString().equals("Second-track fixture"),5000,"Removing imported lyrics exposes cached automatic lyrics again through the actual native control");
            check(!player.isPlaying()&&player.current().id.equals(second.id),"Returning to the automatic provider never resumes paused music");
            onMain(()->{store.saveLyrics(second.id,"[00:01]Captured second import");store.saveLyrics(first.id,"[00:01]Untouched first import");call(activity,"render",new Class<?>[0]);tag("lyrics_remove_own").performClick();});AlertDialog captured=findDialog();
            onMain(()->{player.playIndex(0);player.pause();captured.getButton(AlertDialog.BUTTON_POSITIVE).performClick();});
            test.waitForIdleSync();await(()->store.lyrics(second.id).isEmpty()&&store.lyrics(first.id).contains("Untouched first import"),3000,"Track switching while the dialog is open edits only its captured recording");
            onMain(()->{set(activity,"searchSource","soundcloud");set(activity,"query","Declared unavailable page");set(activity,"catalogQuery","Declared unavailable page");set(activity,"catalogNextOffset","20");set(activity,"catalogError","");((List<?>)uncheckedField(activity,"catalogTracks")).clear();call(activity,"navigate",new Class<?>[]{String.class},"search");});
            await(()->activity.findViewById(com.lolzcloud.mobile.R.id.search_more)!=null,3000,"An empty filtered catalogue page retains its actual next-page button");
            check(hasText(activity.getWindow().getDecorView(),"На этой странице нет доступных записей. Попробуй следующие результаты."),"Empty-page wording distinguishes filtered records from an exhausted search");
            return checks;
        }finally{
            if(release!=null)release.countDown();
            onMain(()->{if(player!=null)player.stopPlayback();if(activity!=null)activity.finish();context.stopService(new Intent(context,PlaybackService.class));});
            test.waitForIdleSync();SystemClock.sleep(150);restore(store.preferences(),before);check(before.equals(store.preferences().getAll()),"Original native library/settings preferences are restored after lyrics fixtures");metadata.edit().clear().commit();
            File[] files=directory.listFiles();if(files!=null)for(File file:files)if(file.getName().matches("[a-f0-9]{64}\\.json(?:\\.tmp)?"))file.delete();directory.delete();audio.delete();
        }
    }
    private LyricsProvider.Response response(String path)throws IOException{
        calls.incrementAndGet();synchronized(paths){paths.add(path);}int value=mode.get();
        if(value==0||value==5&&!path.contains("Second")){
            started.countDown();try{release.await(8,TimeUnit.SECONDS);}catch(InterruptedException ignored){/* Return a stale declared response so production's generation guard is exercised. */}
        }
        if(value==1)return new LyricsProvider.Response(500,"","");if(value==2)return new LyricsProvider.Response(path.startsWith("/api/get?")?404:200,"[]","");
        String title=value==4||value==5?"Corrected Song":"Fixture Song",artist=value==4||value==5?"Corrected Singer":"Fixture Singer",text=value==4?"[00:02]Corrected fixture":value==5?"[00:02]Old delayed fixture":value==6?"[00:00.00]Tempo fixture\n[00:20.00]Retimed fixture":"[00:00.00]First fixture\n[00:02.00]Second fixture\n[00:10.00]Third fixture";int seconds=value==3?100:value==6?50:40;
        if(path.contains("Second")){title="Second Song";artist="Second Singer";text="[00:02]Second-track fixture";}
        try{JSONObject record=new JSONObject().put("id",991).put("trackName",title).put("artistName",artist).put("duration",seconds).put("instrumental",false).put("syncedLyrics",text).put("plainLyrics",value==3?"Different-duration written fixture":JSONObject.NULL);if(value==6&&path.startsWith("/api/search?")){JSONArray rows=new JSONArray();for(int i=0;i<5;i++)rows.put(new JSONObject(record.toString()).put("id",1000+i));rows.put(new JSONObject(record.toString()).put("id",2000).put("duration",60));return new LyricsProvider.Response(200,rows.toString(),"");}String row=record.toString();return new LyricsProvider.Response(200,path.startsWith("/api/search?")?"["+row+"]":row,"");}catch(Exception error){throw new IOException(error);}
    }
    private AlertDialog findDialog()throws Exception{return(AlertDialog)field(activity,"lyricsDialog");}
    private static Object uncheckedField(Object target,String name){try{return field(target,name);}catch(Exception error){throw new RuntimeException(error);}}
    private static boolean hasText(View view,String text){if(view instanceof TextView&&((TextView)view).getText().toString().equals(text))return true;if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)if(hasText(group.getChildAt(i),text))return true;}return false;}
    private void capture(String name)throws Exception{test.waitForIdleSync();SystemClock.sleep(300);test.waitForIdleSync();android.graphics.Bitmap bitmap=test.getUiAutomation().takeScreenshot();if(bitmap==null)throw new IOException("Screenshot unavailable");File directory=new File(test.getTargetContext().getExternalFilesDir(null),"lyrics-review");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Screenshot directory unavailable");File file=new File(directory,name+".png");try(FileOutputStream output=new FileOutputStream(file)){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}finally{bitmap.recycle();}captures.put(file.getAbsolutePath());}
    @SuppressWarnings("unchecked")private List<TextView> lines()throws Exception{return(List<TextView>)field(activity,"lyricViews");}
    private View tag(String name){return activity.getWindow().getDecorView().findViewWithTag(name);}
    private void clickRetry()throws Exception{onMain(()->tag("lyrics_retry").performClick());}
    private void tap(View view)throws Exception{int index=lines().indexOf(view);onMain(()->view.requestRectangleOnScreen(new android.graphics.Rect(0,0,view.getWidth(),view.getHeight()),true));test.waitForIdleSync();SystemClock.sleep(200);android.graphics.Rect visible=new android.graphics.Rect();onMain(()->{View current=index<0?view:linesUnchecked(index);if(current.getWindowToken()==null||!current.getGlobalVisibleRect(visible)||visible.isEmpty())throw new AssertionError("Timed lyric touch target is detached or hidden");});long now=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,visible.exactCenterX(),visible.exactCenterY(),0),up=MotionEvent.obtain(now,now+50,MotionEvent.ACTION_UP,visible.exactCenterX(),visible.exactCenterY(),0);try{test.sendPointerSync(down);test.sendPointerSync(up);}finally{down.recycle();up.recycle();}test.waitForIdleSync();}
    private View linesUnchecked(int index){try{return lines().get(index);}catch(Exception error){throw new RuntimeException(error);}}
    private void await(Condition condition,long timeout,String label)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){boolean[] okay={false};Exception[] error={null};onMain(()->{try{okay[0]=condition.get();}catch(Exception failure){error[0]=failure;}});if(error[0]!=null)throw error[0];if(okay[0]){check(true,label);return;}SystemClock.sleep(50);}check(false,label);}
    private void check(boolean value,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",value));if(!value)throw new AssertionError(label);}
    private void onMain(Runnable action){test.runOnMainSync(action);}
    private static Object field(Object target,String name)throws Exception{Field value=target.getClass().getDeclaredField(name);value.setAccessible(true);return value.get(target);}
    private static void set(Object target,String name,Object value){try{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);field.set(target,value);}catch(Exception error){throw new RuntimeException(error);}}
    private static void call(Object target,String name,Class<?>[] types,Object... args){try{Method method=target.getClass().getDeclaredMethod(name,types);method.setAccessible(true);method.invoke(target,args);}catch(Exception error){throw new RuntimeException(error);}}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,?> values){SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,?> row:values.entrySet()){Object value=row.getValue();String key=row.getKey();if(value instanceof String)edit.putString(key,(String)value);else if(value instanceof Integer)edit.putInt(key,(Integer)value);else if(value instanceof Long)edit.putLong(key,(Long)value);else if(value instanceof Boolean)edit.putBoolean(key,(Boolean)value);else if(value instanceof Float)edit.putFloat(key,(Float)value);else if(value instanceof Set)edit.putStringSet(key,(Set<String>)value);}edit.commit();}
}
