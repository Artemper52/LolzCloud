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
            try(InputStream input=test.getContext().getAssets().open("fixtures/night-route.mp3");FileOutputStream output=new FileOutputStream(audio)){byte[] data=new byte[8192];int count;while((count=input.read(data))!=-1)output.write(data,0,count);}
            activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            await(()->{player=(PlaybackService)field(activity,"player");return player!=null;},15000,"Production MediaPlayer service binds for lyrics integration");
            final Track first=new Track("lyrics-test-first","Fixture Song","Fixture Singer",android.net.Uri.fromFile(audio).toString(),40000);
            final Track second=new Track("lyrics-test-second","Second Song","Second Singer",first.uri,40000);
            onMain(()->{set(activity,"lyricsRepository",repository);player.stopPlayback();player.setRepeat(0);player.setShuffle(false);player.setQueue(Arrays.asList(first,second),0,true);});
            await(()->player.isPlaying()&&player.position()>250,10000,"Real local audio advances before opening lyrics");
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
            mode.set(1);clickRetry();await(()->!((Boolean)field(activity,"lyricsLoading"))&&tag("lyrics_error")!=null,5000,"Network/provider failures expose an actual Retry state instead of a false not-found result");
            capture("lyrics-error");
            check(player.current().id.equals(first.id)&&player.isPlaying(),"A lyric network error leaves audio playing");
            mode.set(2);clickRetry();await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().isEmpty(),5000,"A successful empty provider response clears stale lines");
            check(tag("lyrics_error")==null&&((String)field(activity,"lyricsError")).isEmpty(),"An empty catalogue remains a neutral no-result, distinct from errors");
            mode.set(3);clickRetry();await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==1,5000,"A different-duration match still offers the written source text");
            capture("lyrics-plain");
            check(((List<LrcParser.Line>)field(activity,"lyricLines")).get(0).time==-1&&!lines().get(0).hasOnClickListeners(),"Different-version written text has no seek action or synthetic synchronization");

            mode.set(4);onMain(()->tag("lyrics_identity").performClick());
            await(()->findDialog()!=null,3000,"Metadata correction opens an actual native dialog");
            AlertDialog dialog=findDialog();onMain(()->{((EditText)dialog.getWindow().getDecorView().findViewWithTag("lyrics_title")).setText("Corrected Song");((EditText)dialog.getWindow().getDecorView().findViewWithTag("lyrics_artist")).setText("Corrected Singer");dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();});
            await(()->!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==1&&lines().get(0).getText().toString().equals("Corrected fixture"),5000,"Explicit corrected metadata drives a new successful native lookup");
            LyricsRepository reopened=new LyricsRepository(provider,metadata,directory);check(reopened.identity(first.id,first.title,first.artist,40000).artist.equals("Corrected Singer"),"Manual lookup identity survives repository recreation for that recording");
            check(player.current().title.equals(first.title)&&player.current().artist.equals(first.artist),"Lyrics metadata correction never changes the playing track's real metadata");

            mode.set(5);started=new CountDownLatch(1);release=new CountDownLatch(1);clickRetry();check(started.await(5,TimeUnit.SECONDS),"A delayed first-track request is genuinely in flight");
            onMain(()->player.playIndex(1));release.countDown();await(()->player.current().id.equals(second.id)&&!((Boolean)field(activity,"lyricsLoading"))&&lines().size()==1&&lines().get(0).getText().toString().equals("Second-track fixture"),6000,"Track change cancels stale lyrics and presents only the new recording's response");
            check(!lines().get(0).getText().toString().contains("Old"),"A late old-track response cannot overwrite the next track");
            int beforeImport=calls.get();onMain(()->{store.saveLyrics(second.id,"[00:01.00]My imported fixture\n[00:03.00]My other fixture");call(activity,"render",new Class<?>[0]);});
            await(()->lines().size()==2&&lines().get(0).getText().toString().equals("My imported fixture"),3000,"User-imported LRC takes priority over an automatic result");
            check(calls.get()==beforeImport&&tag("lyrics_retry")==null,"Opening imported lyrics does not issue an automatic lookup or overwrite the user's text");
            check(store.lyrics(second.id).contains("My imported fixture"),"Automatic result cache never writes the LibraryStore imported-lyrics field");
            onMain(()->{set(activity,"searchSource","soundcloud");set(activity,"query","Declared unavailable page");set(activity,"catalogQuery","Declared unavailable page");set(activity,"catalogNextOffset","20");set(activity,"catalogError","");((List<?>)uncheckedField(activity,"catalogTracks")).clear();call(activity,"navigate",new Class<?>[]{String.class},"search");});
            await(()->activity.findViewById(com.lolzcloud.mobile.R.id.search_more)!=null,3000,"An empty filtered catalogue page retains its actual next-page button");
            check(hasText(activity.getWindow().getDecorView(),"На этой странице нет доступных записей. Попробуй следующие результаты."),"Empty-page wording distinguishes filtered records from an exhausted search");
            return checks;
        }finally{
            if(release!=null)release.countDown();
            onMain(()->{if(player!=null)player.stopPlayback();if(activity!=null)activity.finish();context.stopService(new Intent(context,PlaybackService.class));});
            test.waitForIdleSync();SystemClock.sleep(150);restore(store.preferences(),before);metadata.edit().clear().commit();
            File[] files=directory.listFiles();if(files!=null)for(File file:files)if(file.getName().matches("[a-f0-9]{64}\\.json(?:\\.tmp)?"))file.delete();directory.delete();audio.delete();
        }
    }
    private LyricsProvider.Response response(String path)throws IOException{
        calls.incrementAndGet();synchronized(paths){paths.add(path);}int value=mode.get();
        if(value==0||value==5&&!path.contains("Second")){
            started.countDown();try{release.await(8,TimeUnit.SECONDS);}catch(InterruptedException ignored){/* Return a stale declared response so production's generation guard is exercised. */}
        }
        if(value==1)return new LyricsProvider.Response(500,"","");if(value==2)return new LyricsProvider.Response(path.startsWith("/api/get?")?404:200,"[]","");
        String title=value==4||value==5?"Corrected Song":"Fixture Song",artist=value==4||value==5?"Corrected Singer":"Fixture Singer",text=value==4?"[00:02]Corrected fixture":value==5?"[00:02]Old delayed fixture":"[00:00.00]First fixture\n[00:02.00]Second fixture\n[00:10.00]Third fixture";int seconds=value==3?100:40;
        if(path.contains("Second")){title="Second Song";artist="Second Singer";text="[00:02]Second-track fixture";}
        try{String row=new JSONObject().put("id",991).put("trackName",title).put("artistName",artist).put("duration",seconds).put("instrumental",false).put("syncedLyrics",text).put("plainLyrics",value==3?"Different-duration written fixture":JSONObject.NULL).toString();return new LyricsProvider.Response(200,path.startsWith("/api/search?")?"["+row+"]":row,"");}catch(Exception error){throw new IOException(error);}
    }
    private AlertDialog findDialog()throws Exception{return(AlertDialog)field(activity,"lyricsDialog");}
    private static Object uncheckedField(Object target,String name){try{return field(target,name);}catch(Exception error){throw new RuntimeException(error);}}
    private static boolean hasText(View view,String text){if(view instanceof TextView&&((TextView)view).getText().toString().equals(text))return true;if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)if(hasText(group.getChildAt(i),text))return true;}return false;}
    private void capture(String name)throws Exception{test.waitForIdleSync();SystemClock.sleep(300);test.waitForIdleSync();android.graphics.Bitmap bitmap=test.getUiAutomation().takeScreenshot();if(bitmap==null)throw new IOException("Screenshot unavailable");File directory=new File(test.getTargetContext().getExternalFilesDir(null),"lyrics-review");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Screenshot directory unavailable");File file=new File(directory,name+".png");try(FileOutputStream output=new FileOutputStream(file)){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}finally{bitmap.recycle();}captures.put(file.getAbsolutePath());}
    @SuppressWarnings("unchecked")private List<TextView> lines()throws Exception{return(List<TextView>)field(activity,"lyricViews");}
    private View tag(String name){return activity.getWindow().getDecorView().findViewWithTag(name);}
    private void clickRetry()throws Exception{onMain(()->tag("lyrics_retry").performClick());}
    private void tap(View view)throws Exception{onMain(()->view.requestRectangleOnScreen(new android.graphics.Rect(0,0,view.getWidth(),view.getHeight()),true));test.waitForIdleSync();int[] point=new int[2];onMain(()->view.getLocationOnScreen(point));long now=SystemClock.uptimeMillis();float x=point[0]+view.getWidth()/2f,y=point[1]+view.getHeight()/2f;test.sendPointerSync(MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0));test.sendPointerSync(MotionEvent.obtain(now,now+50,MotionEvent.ACTION_UP,x,y,0));test.waitForIdleSync();}
    private void await(Condition condition,long timeout,String label)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){boolean[] okay={false};Exception[] error={null};onMain(()->{try{okay[0]=condition.get();}catch(Exception failure){error[0]=failure;}});if(error[0]!=null)throw error[0];if(okay[0]){check(true,label);return;}SystemClock.sleep(50);}check(false,label);}
    private void check(boolean value,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",value));if(!value)throw new AssertionError(label);}
    private void onMain(Runnable action){test.runOnMainSync(action);}
    private static Object field(Object target,String name)throws Exception{Field value=target.getClass().getDeclaredField(name);value.setAccessible(true);return value.get(target);}
    private static void set(Object target,String name,Object value){try{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);field.set(target,value);}catch(Exception error){throw new RuntimeException(error);}}
    private static void call(Object target,String name,Class<?>[] types,Object... args){try{Method method=target.getClass().getDeclaredMethod(name,types);method.setAccessible(true);method.invoke(target,args);}catch(Exception error){throw new RuntimeException(error);}}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,?> values){SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,?> row:values.entrySet()){Object value=row.getValue();String key=row.getKey();if(value instanceof String)edit.putString(key,(String)value);else if(value instanceof Integer)edit.putInt(key,(Integer)value);else if(value instanceof Long)edit.putLong(key,(Long)value);else if(value instanceof Boolean)edit.putBoolean(key,(Boolean)value);else if(value instanceof Float)edit.putFloat(key,(Float)value);else if(value instanceof Set)edit.putStringSet(key,(Set<String>)value);}edit.commit();}
}
