package com.lolzcloud.mobile;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** The service owns this session. Activity destruction never owns recommendation requests or Next. */
public final class WaveSession {
    public interface Provider { WaveApi.Batch recommend(JSONObject request) throws IOException; void cancel(); }
    public interface Host {
        List<Track> tracks(); int index(); Track current(); long occurrence(); long position(); boolean playing();
        void replace(List<Track> tracks); int append(List<Track> tracks); void trimFuture(); void select(int index,boolean play); void hold();
        Track preferred(Track track); void changed();
    }
    public static final class State {
        public final boolean active,loading,waiting,canReact,loved;
        public final String error,context,request,note,reason;
        public final int queued;
        public final long generation;
        State(boolean active,boolean loading,boolean waiting,boolean canReact,boolean loved,String error,String context,String request,String note,String reason,int queued,long generation){this.active=active;this.loading=loading;this.waiting=waiting;this.canReact=canReact;this.loved=loved;this.error=error;this.context=context;this.request=request;this.note=note;this.reason=reason;this.queued=queued;this.generation=generation;}
    }

    private final LibraryStore store;
    private final Host host;
    private final Provider provider;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> new Thread(r,"LolzCloud-wave"));
    private final WavePolicy.Gate gate = new WavePolicy.Gate();
    private final List<JSONObject> recent = new ArrayList<>();
    private final List<JSONObject> extraOmit = new ArrayList<>();
    private final Map<String,String> reasons = new HashMap<>();
    private final Map<String,Long> privatePlayed = new HashMap<>();
    private final String historySession = UUID.randomUUID().toString();
    private Future<?> task;
    private Runnable deadline;
    private int cursor;
    private boolean initial,waiting,closed;
    private long nextWarm;
    private String prompt="",context="",request="",note="",error="";
    private JSONObject anchor;
    private LibraryStore.WaveUndo undo;
    private long observedOccurrence=Long.MIN_VALUE,observedAt,observedPosition,playedAt,lastHistorySave;
    private boolean observedPlaying,quickSkip;
    private boolean observedPrivate;
    private long observedSegment;
    private double listened;
    private JSONObject observedMetadata;
    private Track observedTrack;
    private long selectedOccurrence=Long.MIN_VALUE;
    private String settingsJson;
    private JSONObject settingsCache;

    public WaveSession(LibraryStore store,Host host){this(store,host,new WaveApi());}
    public WaveSession(LibraryStore store,Host host,Provider provider){this.store=store;this.host=host;this.provider=provider;}

    public State state(){
        boolean loved=false;Track current=host.current();boolean can=gate.active()&&!waiting&&!store.privateMode()&&current!=null&&store.waveMetadata(current)!=null;
        if(can)try{JSONObject row=settings().getJSONObject("feedback").optJSONObject(current.sourceUrl);loved=row!=null&&row.optInt("loves")>0;}catch(IOException|JSONException ignored){}
        return new State(gate.active(),gate.loading(),waiting,can,loved,error,context,request,note,current==null?"":reasons.containsKey(current.sourceUrl)?reasons.get(current.sourceUrl):"",remaining(),gate.generation());
    }
    public boolean active(){return gate.active();}
    public boolean buffering(){return gate.active()&&gate.intent()&&waiting&&gate.loading();}
    public boolean loading(){return gate.loading();}
    public long generation(){return gate.generation();}
    public void replaying(){if(!gate.active())return;cancelRequest();gate.invalidate();gate.resume();waiting=initial=false;error="";gate.rearm();}

    /** Explicit user action. The old track is paused; its queue stays intact until a valid batch arrives. */
    public void start(String input,boolean fromCurrent){
        if(closed)return;
        String text=input==null?"":input.trim();
        if(text.length()>240||text.matches("(?s).*[\\p{Cntrl}].*")){error="Опиши волну в пределах 240 символов";host.changed();return;}
        JSONObject seed=fromCurrent?store.waveMetadata(host.current()):null;
        if(fromCurrent&&seed==null){error="Сначала включи публичную запись SoundCloud для этой волны";host.changed();return;}
        observe();cancelRequest();host.hold();gate.start();initial=waiting=true;cursor=0;nextWarm=0;
        prompt=fromCurrent?"":text;anchor=seed;error=context=request=note="";recent.clear();extraOmit.clear();reasons.clear();undo=null;selectedOccurrence=Long.MIN_VALUE;
        fetch();
    }

    public void stop(){if(closed)return;observe();cancelRequest();gate.stop();initial=waiting=false;error="";host.changed();}
    public void paused(){if(closed)return;observe();cancelRequest();gate.pause();host.changed();}
    /** Returns true when Play is waiting for a new station batch instead of replaying the old source. */
    public boolean playRequested(){
        if(!gate.active())return false;
        gate.resume();error="";
        if(waiting){fetch();return true;}
        host.changed();return false;
    }
    public void retry(){if(!gate.active()){start(prompt,false);return;}error="";if(waiting||initial){gate.resume();fetch();}else{nextWarm=0;fetch(true);}}

    public boolean next(boolean skipped){
        if(!gate.active())return false;
        if(waiting&&gate.loading())return true;
        gate.resume();observe();
        if(skipped&&!waiting&&!store.privateMode())try{signal("skip",false);}catch(IOException failure){error=failure.getMessage();}
        quickSkip=skipped&&observedPosition<15000&&listened<12;saveListening();
        advance();return true;
    }
    public boolean completed(long occurrence){
        if(!gate.active())return false;
        if(occurrence!=selectedOccurrence)return true;
        if(!gate.complete(occurrence))return true;
        observe();saveListening();advance();return true;
    }
    public void seeking(){gate.rearm();observedPlaying=false;}
    public void loaded(long occurrence){if(gate.active()&&!initial&&!waiting)selectedOccurrence=occurrence;}

    public void configure(JSONObject patch)throws IOException{
        store.configureWave(patch);
        if(patch.length()>1||!patch.has("adventurous")){prompt=request=note="";anchor=null;cursor=0;}
        tasteChanged();
    }
    public void clearRequest(){prompt=request=note="";anchor=null;cursor=0;tasteChanged();host.changed();}
    public void shake(){
        if(!gate.active())return;
        extraOmit.clear();List<Track> tracks=host.tracks();for(int i=Math.max(0,host.index()+1);i<tracks.size()&&extraOmit.size()<40;i++){JSONObject row=store.waveMetadata(tracks.get(i));if(row!=null)extraOmit.add(row);}
        cursor=(cursor+3)%1_000_001;tasteChanged();
    }
    public void tasteChanged(){
        if(!gate.active())return;
        cancelRequest();gate.invalidate();nextWarm=0;error="";
        // Existing queued songs were ranked with different settings. Keep only the audible occurrence.
        if(!initial)host.trimFuture();
        if(gate.intent())fetch();else host.changed();
    }

    public void react(String kind,long expectedOccurrence)throws IOException{
        if(!gate.active()||waiting||host.occurrence()!=expectedOccurrence)throw new IOException("Трек уже изменился. Реакция не применена.");
        signal(kind,true);
        if(kind.equals("ban")||kind.equals("artist-ban"))advance();else host.changed();
    }
    public boolean canUndo(){return undo!=null;}
    public void undo()throws IOException{store.undoWave(undo);undo=null;tasteChanged();host.changed();}
    public void unblockArtist(String name)throws IOException{store.unblockWaveArtist(name);tasteChanged();host.changed();}

    public void tick(){
        if(closed)return;observe();
        if(gate.active()&&gate.intent()&&!waiting&&host.playing()&&remaining()<=5&&!gate.loading()&&error.isEmpty()&&SystemClock.elapsedRealtime()>=nextWarm){nextWarm=SystemClock.elapsedRealtime()+30000;fetch();}
    }

    private void advance(){
        error="";
        List<Track> tracks=host.tracks();int selected=host.index()+1;
        while(selected<tracks.size()&&!allowed(store.waveMetadata(tracks.get(selected)),false))selected++;
        if(selected<tracks.size()){
            try{selected(tracks.get(selected));waiting=initial=false;host.select(selected,gate.intent());host.changed();}
            catch(IOException failure){error=failure.getMessage();waiting=true;host.hold();host.changed();}
        }else{waiting=true;host.hold();fetch();host.changed();}
    }

    private void selected(Track track)throws IOException{
        JSONObject metadata=store.waveMetadata(track);if(metadata==null)throw new IOException("У записи нет сведений для волны");
        long now=System.currentTimeMillis();
        store.markWavePlayed(metadata,now);
        if(store.privateMode())for(String key:WaveApi.fingerprints(metadata))privatePlayed.put(key,now);
        if(privatePlayed.size()>2000){java.util.Iterator<Map.Entry<String,Long>> keys=privatePlayed.entrySet().iterator();while(keys.hasNext()){Map.Entry<String,Long> entry=keys.next();if(entry.getValue()<=now-WavePolicy.DAY||privatePlayed.size()>2000)keys.remove();}}
        recent.add(metadata);while(recent.size()>8)recent.remove(0);
        gate.rearm();
    }

    private boolean allowed(JSONObject metadata,boolean queued){
        if(metadata==null)return false;
        try{
            JSONObject settings=settings();JSONArray blocked=settings.getJSONArray("blockedArtists");String artist=WavePolicy.normalized(metadata.optString("artist"));
            for(int i=0;i<blocked.length();i++)if(artist.equals(WavePolicy.normalized(blocked.getString(i))))return false;
            JSONObject feedback=settings.getJSONObject("feedback").optJSONObject(metadata.getString("url"));if(feedback!=null&&feedback.optBoolean("banned"))return false;
            JSONObject played=settings.getJSONObject("played24h");long now=System.currentTimeMillis();
            for(String key:WaveApi.fingerprints(metadata))if(played.optDouble(key,0)>now-WavePolicy.DAY||privatePlayed.containsKey(key)&&privatePlayed.get(key)>now-WavePolicy.DAY)return false;
            if(queued){Set<String> keys=new HashSet<>(WaveApi.fingerprints(metadata));List<Track> tracks=host.tracks();for(int i=Math.max(0,host.index());i<tracks.size();i++){JSONObject other=store.waveMetadata(tracks.get(i));if(other!=null)for(String key:WaveApi.fingerprints(other))if(keys.contains(key))return false;}}
            return true;
        }catch(IOException|JSONException invalid){return false;}
    }

    private void fetch(){fetch(false);}
    private void fetch(boolean permitPaused){
        if(closed||!gate.active()||!gate.intent()&&!permitPaused||gate.loading())return;
        final long token=gate.request();if(token<0)return;
        final String requestedPrompt=prompt,current=host.current()==null?"":host.current().sourceUrl;
        final int requestedCursor=cursor;
        final JSONObject requestedAnchor=anchor;
        final List<JSONObject> requestedRecent=new ArrayList<>(recent),omit=new ArrayList<>();
        List<Track> queued=host.tracks();for(int i=Math.max(0,host.index());i<queued.size()&&omit.size()<40;i++){JSONObject row=store.waveMetadata(queued.get(i));if(row!=null)omit.add(row);}
        for(JSONObject row:extraOmit)if(omit.size()<40)omit.add(row);
        error="";
        deadline=()->{if(gate.finish(token)){provider.cancel();if(task!=null)task.cancel(true);task=null;error="Волна долго отвечает. Нажми «Повторить».";host.changed();}};
        main.postDelayed(deadline,25000);
        task=io.submit(()->{
            try{
                JSONObject body=store.waveRequest(requestedPrompt,requestedCursor,requestedAnchor,requestedRecent,current,omit,System.currentTimeMillis());
                final WaveApi.Batch batch=provider.recommend(body);
                main.post(()->accept(token,batch));
            }catch(IOException|RuntimeException failure){String message=failure.getMessage()==null?"Не удалось подобрать музыку. Повтори позже.":failure.getMessage();main.post(()->{if(gate.finish(token)){clearDeadline();task=null;error=message;host.changed();}});}
        });
        host.changed();
    }

    private void accept(long token,WaveApi.Batch batch){
        if(closed||!gate.finish(token))return;
        clearDeadline();task=null;
        try{
            boolean firstBatch=initial;
            List<Track> accepted=new ArrayList<>();Set<String> keys=new HashSet<>();List<WaveApi.Row> metadata=new ArrayList<>();
            for(WaveApi.Row row:batch.tracks){if(!allowed(row.metadata,!initial))continue;List<String> identity=WaveApi.fingerprints(row.metadata);boolean duplicate=false;for(String key:identity)if(keys.contains(key))duplicate=true;if(duplicate)continue;keys.addAll(identity);accepted.add(host.preferred(row.track));metadata.add(row);reasons.put(row.track.sourceUrl,row.reason);}
            while(reasons.size()>300)reasons.remove(reasons.keySet().iterator().next());
            if(accepted.isEmpty())throw new IOException("В этом режиме закончились треки без повторов за сутки. Смени запрос, жанр или настройки.");
            store.rememberWaveMetadata(metadata);cursor=batch.nextCursor;context=batch.context;request=batch.request;note=batch.note;error="";extraOmit.clear();
            if(initial){selected(accepted.get(0));initial=waiting=false;host.replace(accepted);}
            else{int first=host.append(accepted);if(waiting&&gate.intent()){Track selected=host.tracks().get(first);selected(selected);waiting=false;host.select(first,true);}}
            nextWarm=firstBatch?0:SystemClock.elapsedRealtime()+30000;host.changed();
        }catch(IOException|RuntimeException failure){error=failure.getMessage()==null?"Не удалось применить подбор. Повтори позже.":failure.getMessage();host.changed();}
    }

    private void signal(String kind,boolean rememberUndo)throws IOException{
        JSONObject metadata=store.waveMetadata(host.current());
        LibraryStore.WaveUndo changed=store.reactWave(metadata,kind,host.position());if(rememberUndo)undo=changed;
    }

    private JSONObject settings()throws IOException{String json=store.preferences().getString("portable_profile","");if(settingsCache==null||!json.equals(settingsJson)){settingsCache=store.waveSettings();settingsJson=json;}return settingsCache;}

    private int remaining(){return Math.max(0,host.tracks().size()-host.index()-1);}
    private void clearDeadline(){if(deadline!=null){main.removeCallbacks(deadline);deadline=null;}}
    private void cancelRequest(){clearDeadline();provider.cancel();if(task!=null)task.cancel(true);task=null;}

    private void observe(){
        long now=SystemClock.elapsedRealtime(),occurrence=host.occurrence(),position=host.position();Track track=host.current();
        boolean playing=host.playing(),privateMode=store.privateMode();
        if(occurrence!=observedOccurrence||track==null||privateMode!=observedPrivate){saveListening();observedOccurrence=occurrence;observedPrivate=privateMode;observedSegment++;observedMetadata=privateMode?null:store.waveMetadata(track);observedTrack=track;playedAt=System.currentTimeMillis();listened=0;quickSkip=false;observedPlaying=false;}
        if(playing&&observedPlaying&&observedMetadata!=null){double elapsed=(now-observedAt)/1000d,progress=(position-observedPosition)/1000d;if(elapsed>0&&elapsed<6&&progress>0&&progress<=elapsed*2+3)listened+=Math.min(elapsed,progress);}
        observedAt=now;observedPosition=position;observedPlaying=playing&&!privateMode;
        if(now-lastHistorySave>=5000)saveListening();
    }
    private void saveListening(){
        if(observedMetadata==null||observedTrack==null||listened<=0||store.privateMode())return;
        try{store.saveWaveListening(historySession+":"+observedOccurrence+":"+observedSegment,observedMetadata,playedAt,listened,quickSkip,store.isLiked(observedTrack.id));lastHistorySave=SystemClock.elapsedRealtime();}
        catch(IOException ignored){/* Failure to keep optional listening history never interrupts audio. */}
    }
    public void close(){if(closed)return;observe();saveListening();cancelRequest();gate.stop();closed=true;io.shutdownNow();}
}
