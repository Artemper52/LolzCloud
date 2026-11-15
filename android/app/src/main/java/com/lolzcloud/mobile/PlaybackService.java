package com.lolzcloud.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.PresetReverb;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Foreground native audio service. Only local documents and direct HTTPS audio are played here. */
public final class PlaybackService extends Service {
    public static final String ACTION_PLAY = "com.lolzcloud.mobile.PLAY";
    public static final String ACTION_PAUSE = "com.lolzcloud.mobile.PAUSE";
    public static final String ACTION_NEXT = "com.lolzcloud.mobile.NEXT";
    public static final String ACTION_PREVIOUS = "com.lolzcloud.mobile.PREVIOUS";
    public static final String ACTION_STOP = "com.lolzcloud.mobile.STOP";
    private static final String ACTION_KEEP = "com.lolzcloud.mobile.KEEP";
    private static final String CHANNEL = "lolzcloud_playback";
    private static final int NOTIFICATION_ID = 19;
    private float portableGain = 1f;
    private static volatile PlaybackService running;

    /** Download completion is independent of whichever Activity started it. */
    static void offlineSaved(final Track track) {
        final PlaybackService active = running;
        if (active == null || track == null) return;
        active.handler.post(() -> {
            if (running == active && !active.destroyed) active.replaceStoredTrack(track);
        });
    }

    static void profileImported() {
        profileImported(true);
    }
    static void profileImported(final boolean applySound) {
        final PlaybackService active = running;
        if (active != null) active.handler.post(() -> { if (running == active && !active.destroyed) { if(applySound)active.reloadSettings();if(active.wave!=null)active.wave.tasteChanged(); } });
    }

    /** Main-thread native navigation controller; it creates no service and is never exposed to JavaScript. */
    static void pauseForOnlineRoom() { if (running != null) running.pause(); }

    public interface Listener { void onStateChanged(); }
    public final class LocalBinder extends Binder {
        public PlaybackService getService() { return PlaybackService.this; }
    }

    private final LocalBinder binder = new LocalBinder();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();
    private final ArrayList<Track> queue = new ArrayList<>();
    private final ArrayList<Integer> previousIndices = new ArrayList<>();
    private final Set<Integer> cycleVisited = new HashSet<>();
    private final ExecutorService sourceIo = Executors.newSingleThreadExecutor();
    private final OnlineCatalog sourceCatalog = new OnlineCatalog();
    private Future<?> sourceTask;
    private boolean preparingAudio;
    private long sourceGeneration;
    private Runnable sourceDeadline;
    private Runnable playerDeadline;
    private PowerManager.WakeLock preparationWake;
    private LibraryStore store;
    private MediaPlayer media;
    private PcmPlayback pcm;
    private WaveSession wave;
    private boolean waveInternal;
    private PowerManager.WakeLock waveWake;
    private long waveWakeGeneration=Long.MIN_VALUE;
    private long dspRevision=1;
    private boolean normalization;
    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private AudioManager.OnAudioFocusChangeListener focusCallback;
    private Equalizer equalizer;
    private BassBoost bassBoost;
    private final AudioEffectsPolicy.BassDriver bassDriver = new AudioEffectsPolicy.BassDriver() {
        public boolean hasControl() { return bassBoost.hasControl(); }
        public boolean strengthSupported() { return bassBoost.getStrengthSupported(); }
        public int roundedStrength() { return bassBoost.getRoundedStrength(); }
        public boolean enabled() { return bassBoost.getEnabled(); }
        public void strength(int value) { bassBoost.setStrength((short) value); }
        public boolean enable(boolean value) { return bassBoost.setEnabled(value) == android.media.audiofx.AudioEffect.SUCCESS; }
    };
    private PresetReverb reverb;
    private LoudnessEnhancer loudness;
    private Listener listener;
    private int index = -1;
    private boolean prepared;
    private boolean seeking;
    private boolean playWhenReady;
    private boolean resumeOnFocus;
    private boolean foreground;
    private boolean hasFocus;
    private boolean focusRequested;
    private boolean ducked;
    private boolean destroyed;
    private long focusGeneration;
    private boolean shuffle;
    private int repeat;
    private float speed = 1f;
    private float pitch = 1f;
    private float volume = 1f;
    private long pendingSeek;
    private long lastSave;
    private long sleepAt;
    private static final String SLEEP_DEADLINE = "sleep_deadline";
    private String error = "";
    private String metadataId = "";
    private long metadataDuration = -1;

    @Override public void onCreate() {
        super.onCreate();
        running = this;
        store = new LibraryStore(this);
        SharedPreferences prefs = store.preferences();
        repeat = prefs.getInt("repeat", 0);
        shuffle = prefs.getBoolean("shuffle", false);
        speed = prefs.getFloat("speed", 1f);
        pitch = prefs.getFloat("pitch", 1f);
        normalization = prefs.getBoolean("pcm_normalization", false);
        syncImportedNormalization();
        long savedSleep = prefs.getLong(SLEEP_DEADLINE, 0);
        SleepTimerPolicy.Deadline sleep = SleepTimerPolicy.restore(savedSleep, System.currentTimeMillis(), SystemClock.elapsedRealtime());
        sleepAt = sleep.elapsed;
        if (savedSleep != sleep.wall) prefs.edit().putLong(SLEEP_DEADLINE, sleep.wall).apply();
        queue.addAll(store.savedQueue());
        if (!queue.isEmpty()) index = Math.min(Math.max(store.savedIndex(), 0), queue.size() - 1);
        pendingSeek = store.savedPosition();
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        session = new MediaSession(this, "LolzCloud");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { next(); }
            @Override public void onSkipToPrevious() { previous(); }
            @Override public void onSeekTo(long pos) { seekTo(pos); }
            @Override public void onStop() { stopPlayback(); }
            @Override public void onSetPlaybackSpeed(float value) { setSpeed(value); }
        }, handler);
        session.setActive(true);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Музыка LolzCloud", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Фоновое воспроизведение и управление музыкой");
        channel.setSound(null, null);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisyReceiver, filter);
        wave = new WaveSession(store, new WaveSession.Host() {
            public List<Track> tracks(){return queue();}
            public int index(){return index;}
            public Track current(){return PlaybackService.this.current();}
            public long occurrence(){return sourceGeneration;}
            public long position(){return PlaybackService.this.position();}
            public boolean playing(){return isPlaying();}
            public Track preferred(Track track){Track saved=store.find(track.id);return saved!=null&&!saved.isCatalogReference()&&!saved.uri.startsWith("https:")?new Track(saved.id,track.title,track.artist,saved.uri,saved.duration>0?saved.duration:track.duration,saved.addedAt,track.sourceUrl,track.coverUrl.isEmpty()?saved.coverUrl:track.coverUrl):track;}
            public void replace(List<Track> tracks){save();queue.clear();queue.addAll(tracks);index=0;previousIndices.clear();cycleVisited.clear();pendingSeek=0;loadCurrent(true);}
            public int append(List<Track> tracks){
                // Retain a short back history without allowing a day-long station to grow without bound.
                if(index>30){int remove=index-20;queue.subList(0,remove).clear();index-=remove;previousIndices.clear();cycleVisited.clear();}
                int first=queue.size();queue.addAll(tracks);save();return first;
            }
            public void trimFuture(){if(index>=0&&index+1<queue.size()){queue.subList(index+1,queue.size()).clear();previousIndices.clear();cycleVisited.clear();save();}}
            public void select(int selected,boolean play){if(selected<0||selected>=queue.size())return;if(index>=0&&selected!=index)previousIndices.add(index);index=selected;pendingSeek=0;loadCurrent(play);}
            public void hold(){waveInternal=true;try{pauseInternal(false);}finally{waveInternal=false;}}
            public void changed(){waveChanged();}
        });
        handler.post(tick);
        updateSession();
    }

    @Override public IBinder onBind(Intent intent) { return binder; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PLAY.equals(action)) play();
        else if (ACTION_PAUSE.equals(action)) pause();
        else if (ACTION_NEXT.equals(action)) next();
        else if (ACTION_PREVIOUS.equals(action)) previous();
        else if (ACTION_STOP.equals(action)) stopPlayback();
        else if (ACTION_KEEP.equals(action) && !foreground) stopSelf(startId);
        return START_NOT_STICKY;
    }

    public void setListener(Listener listener) {
        this.listener = listener;
        if (listener != null) listener.onStateChanged();
    }

    public Track current() { return index >= 0 && index < queue.size() ? queue.get(index) : null; }
    public List<Track> queue() { return new ArrayList<>(queue); }
    public int currentIndex() { return index; }
    public boolean isPlaying() {
        if(pcm!=null)return prepared&&pcm.playing();
        try { return media != null && prepared && media.isPlaying(); }
        catch (IllegalStateException ignored) { return false; }
    }
    public boolean isLoading() { return wave!=null&&wave.buffering() || playWhenReady && (preparingAudio || (media != null || pcm != null) && !prepared || pcm!=null&&prepared&&!pcm.playing()); }
    public String loadingMessage() { return !isLoading() ? "" : wave!=null&&wave.buffering()?"Подбираем музыку для волны…":preparingAudio ? current() != null && current().isCatalogReference() ? "Находим запись из профиля…" : "Готовим трек…" : pcm!=null?"Готовим нативную обработку звука…":"Загружаем аудио…"; }
    public boolean isPrepared() { return prepared; }
    public long position() {
        try {
            if(pcm!=null&&prepared&&!seeking)pendingSeek=pcm.position();
            if (media != null && prepared && !seeking) pendingSeek = Math.max(0, media.getCurrentPosition());
            return pendingSeek;
        }
        catch (IllegalStateException ignored) { return pendingSeek; }
    }
    public long duration() {
        try {
            if(pcm!=null&&prepared&&pcm.duration()>0)return pcm.duration();
            if (media != null && prepared) return Math.max(0, media.getDuration());
        } catch (IllegalStateException ignored) { }
        Track track = current();
        return track == null ? 0 : track.duration;
    }
    public String error() { return error; }
    public int repeat() { return repeat; }
    public boolean shuffle() { return shuffle && (wave==null||!wave.active()); }
    public float speed() { return speed; }
    public float pitch() { return pitch; }
    public float volume() { return volume; }
    public long sleepRemainingMillis() { return sleepAt == 0 ? 0 : Math.max(0, sleepAt - SystemClock.elapsedRealtime()); }

    public WaveSession.State waveState(){return wave.state();}
    public void startWave(String prompt,boolean fromCurrent){wave.start(prompt,fromCurrent);}
    public void stopWave(){wave.stop();}
    public void retryWave(){wave.retry();}
    public void shakeWave(){wave.shake();}
    public void clearWaveRequest(){wave.clearRequest();}
    public void configureWave(JSONObject patch)throws IOException{wave.configure(patch);}
    public void reactWave(String kind,long occurrence)throws IOException{wave.react(kind,occurrence);}
    public long waveOccurrence(){return sourceGeneration;}
    public boolean canUndoWave(){return wave.canUndo();}
    public void undoWave()throws IOException{wave.undo();}
    public void unblockWaveArtist(String name)throws IOException{wave.unblockArtist(name);}

    private void waveChanged(){
        if(wave==null||destroyed)return;
        if(wave.loading()){
            if(waveWake!=null&&waveWakeGeneration!=wave.generation()){try{if(waveWake.isHeld())waveWake.release();}catch(RuntimeException ignored){}waveWake=null;}
            if(waveWake==null)try{waveWake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"LolzCloud:wave");waveWake.setReferenceCounted(false);waveWake.acquire(27000);waveWakeGeneration=wave.generation();}catch(RuntimeException ignored){}
            if(wave.buffering()&&!foreground&&!ensureForeground()){wave.paused();return;}
        }else if(waveWake!=null){try{if(waveWake.isHeld())waveWake.release();}catch(RuntimeException ignored){}waveWake=null;}
        if(!isPlaying()&&!isLoading()&&foreground){stopForeground(false);foreground=false;}
        changed(true);
    }

    public void setQueue(List<Track> tracks, int selected, boolean play) {
        if (tracks == null || tracks.isEmpty()) return;
        if(wave!=null)wave.stop();
        save();
        queue.clear();
        queue.addAll(tracks);
        index = Math.max(0, Math.min(selected, queue.size() - 1));
        previousIndices.clear();
        cycleVisited.clear();
        pendingSeek = 0;
        loadCurrent(play);
    }

    public void enqueue(Track track) {
        if (track == null) return;
        if(wave!=null)wave.stop();
        if (queue.isEmpty()) { index = 0; pendingSeek = 0; error = ""; }
        queue.add(track);
        if (index < 0) index = 0;
        save();
        changed(true);
    }

    /** A completed offline download replaces the active source without resetting its queue or position. */
    public void replaceStoredTrack(Track track) {
        if (destroyed || track == null) return;
        Track playing = current();
        boolean replaceCurrent = playing != null && playing.id.equals(track.id) && !playing.uri.equals(track.uri);
        long resumePosition = position();
        boolean resume = isPlaying() || isLoading();
        for (int i = 0; i < queue.size(); i++) if (queue.get(i).id.equals(track.id)) queue.set(i, track);
        if (replaceCurrent) { pendingSeek = resumePosition; loadCurrent(resume); }
        else { save(); changed(true); }
    }

    public void removeFromQueue(int row) {
        if (row < 0 || row >= queue.size()) return;
        if(wave!=null)wave.stop();
        boolean removedCurrent = row == index;
        boolean wasPlaying = isPlaying() || playWhenReady;
        queue.remove(row);
        previousIndices.clear();
        cycleVisited.clear();
        if (queue.isEmpty()) {
            index = -1; stopPlayback(); pendingSeek = 0; error = "";
        } else {
            if (row < index || index >= queue.size()) index--;
            if (removedCurrent) { pendingSeek = 0; loadCurrent(wasPlaying); }
        }
        save();
        changed(true);
    }

    public void playIndex(int selected) {
        if (selected < 0 || selected >= queue.size()) return;
        if(wave!=null)wave.stop();
        if (index >= 0 && selected != index) previousIndices.add(index);
        index = selected;
        pendingSeek = 0;
        loadCurrent(true);
    }

    /** Select a saved moment without replacing the queue or changing play/pause intent.
     * Returns true only when the track was appended to the end of the queue. */
    public boolean openBookmark(Track requested, long milliseconds) {
        if (requested == null) return false;
        if(wave!=null)wave.stop();
        Track stored = store.find(requested.id), track = stored == null ? requested : stored;
        boolean currentRecording = current() != null && current().id.equals(track.id);
        int selected = currentRecording ? index : -1;
        if (selected < 0) for (int item = 0; item < queue.size(); item++) if (queue.get(item).id.equals(track.id)) { selected = item; break; }
        boolean appended = selected < 0;
        if (appended) { selected = queue.size(); queue.add(track); }
        else queue.set(selected, track);
        if (currentRecording && selected == index) { seekTo(milliseconds); return appended; }
        boolean resume = isPlaying() || playWhenReady;
        if (index >= 0) previousIndices.add(index);
        index = selected; pendingSeek = Math.max(0, milliseconds);
        // The existing load generation/media identity owns this pending seek.
        // Next/previous invalidate it synchronously before another player prepares.
        loadCurrent(resume);
        return appended;
    }

    public void toggle() { if (isPlaying() || isLoading()) pause(); else play(); }

    public void play() {
        if(wave!=null&&wave.playRequested())return;
        if (current() == null) {
            error = "Сначала добавьте музыку в библиотеку";
            changed(false);
            return;
        }
        error = "";
        playWhenReady = true;
        resumeOnFocus = false;
        if (preparingAudio) { if (ensureForeground()) changed(true); return; }
        if(pcm!=null){if(!prepared){if(ensureForeground())changed(true);return;}if(ensureForeground()&&acquireFocus()){pcm.parameters(speed,pitch);pcm.volume(outputVolume());pcm.play();store.recordPlayed(current());changed(true);}return;}
        if (media == null) { loadCurrent(true); return; }
        if (!prepared) { if (ensureForeground()) changed(true); return; }
        try {
            if (!ensureForeground() || !acquireFocus()) return;
            media.start();
            applySpeed();
            store.recordPlayed(current());
            changed(true);
        } catch (RuntimeException failure) { fail("Не удалось начать воспроизведение. Попробуйте снова"); }
    }

    public void pause() { pauseInternal(false); }

    private void pauseInternal(boolean resumeLater) {
        if(wave!=null&&!waveInternal)wave.paused();
        resumeOnFocus = resumeLater;
        playWhenReady = false;
        if (preparingAudio || (media != null || pcm != null) && !prepared) releasePlayer();
        if(pcm!=null&&prepared)pcm.pause();
        if (media != null && prepared) {
            try { media.pause(); } catch (IllegalStateException ignored) { }
        }
        save();
        if (!resumeLater) abandonFocus();
        if (foreground) { stopForeground(false); foreground = false; }
        changed(true);
    }

    public void next() {
        if(wave!=null&&wave.next(true))return;
        if (queue.isEmpty()) return;
        previousIndices.add(index);
        if (previousIndices.size() > 200) previousIndices.remove(0);
        if (shuffle && queue.size() > 1) {
            ArrayList<Integer> candidates = new ArrayList<>();
            for (int i = 0; i < queue.size(); i++) if (!cycleVisited.contains(i)) candidates.add(i);
            if (candidates.isEmpty()) {
                cycleVisited.clear();
                cycleVisited.add(index);
                for (int i = 0; i < queue.size(); i++) if (i != index) candidates.add(i);
            }
            index = candidates.get(random.nextInt(candidates.size()));
        } else index = (index + 1) % queue.size();
        pendingSeek = 0;
        loadCurrent(true);
    }

    public void previous() {
        if(wave!=null)wave.replaying();
        if (queue.isEmpty()) return;
        if (position() > 3_000) { seekTo(0); return; }
        if (!previousIndices.isEmpty()) index = previousIndices.remove(previousIndices.size() - 1);
        else index = (index - 1 + queue.size()) % queue.size();
        if (index < 0 || index >= queue.size()) index = 0;
        pendingSeek = 0;
        loadCurrent(true);
    }

    public void seekTo(long milliseconds) {
        if(wave!=null)wave.seeking();
        long length = duration();
        pendingSeek = Math.max(0, length > 0 ? Math.min(milliseconds, length) : milliseconds);
        if(pcm!=null&&prepared){seeking=true;pcm.seek(pendingSeek);}
        if (media != null && prepared) {
            try { seeking = true; media.seekTo(pendingSeek, MediaPlayer.SEEK_CLOSEST); }
            catch (IllegalStateException ignored) { seeking = false; }
        }
        save();
        changed(false);
    }

    /** 0: no repeat, 1: repeat queue, 2: repeat current track. */
    public void setRepeat(int mode) {
        repeat = Math.max(0, Math.min(2, mode));
        store.preferences().edit().putInt("repeat", repeat).apply();
        changed(true);
    }

    public void setShuffle(boolean enabled) {
        if(enabled&&wave!=null)wave.stop();
        shuffle = enabled;
        store.preferences().edit().putBoolean("shuffle", enabled).apply();
        changed(true);
    }

    public void setSpeed(float value) {
        if (Float.isNaN(value) || Float.isInfinite(value)) return;
        speed = Math.max(.5f, Math.min(2f, value));
        store.preferences().edit().putFloat("speed", speed).apply();
        updatePortableTransport("rate");
        applySpeed();
        changed(false);
    }

    public void setPitch(float value) {
        if (Float.isNaN(value) || Float.isInfinite(value)) return;
        pitch = Math.max(.5f, Math.min(2f, value));
        store.preferences().edit().putFloat("pitch", pitch).apply();
        updatePortableTransport("preservesPitch");
        applySpeed();
        changed(false);
    }

    public void setVolume(float value) {
        if (Float.isNaN(value) || Float.isInfinite(value)) return;
        volume = Math.max(0f, Math.min(1f, value));
        try { if (media != null) media.setVolume(outputVolume(), outputVolume()); }
        catch (IllegalStateException ignored) { }
        if(pcm!=null)pcm.volume(outputVolume());
        changed(false);
    }

    public boolean setBass(int strength) {
        int value = AudioEffectsPolicy.bassRequest(strength);
        store.preferences().edit().putInt("bass", value).apply();
        return AudioEffectsPolicy.applyBass(bassBoost == null ? null : bassDriver, value);
    }

    AudioEffectsPolicy.BassState bassState() { return AudioEffectsPolicy.readBass(bassBoost == null ? null : bassDriver); }
    public int bass() { return bassState().strength; }
    public boolean bassAvailable() { return bassState().editable(); }
    public boolean bassStrengthSupported() { return bassState().adjustable; }
    public boolean bassEnabled() { return bassState().enabled; }
    public String bassStatus() {
        AudioEffectsPolicy.BassState state = bassState();
        if (!state.available) return media == null || !prepared ? "Включи трек, чтобы проверить поддержку эффекта." : "Аудиосистема этого устройства не поддерживает эффект.";
        if (!state.controllable) return "Эффект сейчас управляется другой аудиосистемой. Настройка недоступна.";
        return state.adjustable ? "Показана фактически применённая сила эффекта." : "Устройство поддерживает только включение и выключение. Сила фиксирована.";
    }
    public String effectsCapabilitiesKey() {
        AudioEffectsPolicy.BassState bass = bassState(); int audioSession = 0;
        try { if (media != null) audioSession = media.getAudioSessionId(); } catch (RuntimeException unavailable) { }
        StringBuilder key = new StringBuilder().append(audioSession).append(':').append(bass.available).append(':')
                .append(bass.controllable).append(':').append(bass.adjustable).append(':').append(eqAvailable()).append(':').append(reverbAvailable());
        short[] range = eqRange(); key.append(':').append(range[0]).append(':').append(range[1]);
        for (int band = 0; band < eqBandCount(); band++) key.append(':').append(eqCenterHz(band));
        if(pcm!=null){PcmPlayback.Snapshot state=pcm.snapshot();key.append(":pcm:").append(state.audioSession).append(':').append(state.sampleRate).append(':').append(state.channels);}
        return key.toString();
    }
    public boolean eqAvailable() {
        try { return equalizer != null && equalizer.hasControl() && equalizer.getNumberOfBands() > 0; }
        catch (RuntimeException unavailable) { return false; }
    }
    public int eqBandCount() {
        try { return equalizer == null ? 0 : equalizer.getNumberOfBands(); }
        catch (RuntimeException ignored) { return 0; }
    }
    public int eqCenterHz(int band) {
        try { return equalizer == null ? 0 : equalizer.getCenterFreq((short) band) / 1000; }
        catch (RuntimeException ignored) { return 0; }
    }
    public short[] eqRange() {
        try { return equalizer == null ? new short[]{-1500, 1500} : equalizer.getBandLevelRange(); }
        catch (RuntimeException ignored) { return new short[]{-1500, 1500}; }
    }
    public short eqBandLevel(int band) {
        try { return equalizer == null ? 0 : equalizer.getBandLevel((short) band); }
        catch (RuntimeException ignored) { return 0; }
    }
    public boolean setEqBand(int band, short level) {
        if (equalizer == null || band < 0 || band >= eqBandCount()) return false;
        try {
            short[] range = equalizer.getBandLevelRange();
            short value = (short) Math.max(range[0], Math.min(range[1], level));
            equalizer.setBandLevel((short) band, value);
            if (equalizer.setEnabled(true) != android.media.audiofx.AudioEffect.SUCCESS || !equalizer.getEnabled()) return false;
            store.preferences().edit().putInt("eq_" + band, value).putBoolean("eq_enabled", true).apply();
            if (store.preferences().getBoolean("portable_dsp_apply", false)) {
                JSONObject sound = portableSound(); sound.put("gains", hardwareCurve()).put("enabled", true).put("preset", "Custom");
                store.preferences().edit().putString("portable_dsp", sound.toString()).apply();
                exportPortableKeys(sound, "gains", "enabled", "preset");
            }
            return true;
        } catch (RuntimeException | JSONException ignored) { return false; }
    }

    public boolean setReverb(boolean enabled) {
        store.preferences().edit().putBoolean("reverb", enabled).apply();
        if (reverb == null || media == null) return false;
        try {
            reverb.setPreset(PresetReverb.PRESET_SMALLROOM);
            if (reverb.setEnabled(enabled) != android.media.audiofx.AudioEffect.SUCCESS) return false;
            media.attachAuxEffect(enabled ? reverb.getId() : 0);
            media.setAuxEffectSendLevel(enabled ? .2f : 0f);
            return reverb.getEnabled() == enabled;
        } catch (RuntimeException ignored) { return false; }
    }
    public boolean reverbAvailable() { try { return reverb != null && reverb.hasControl(); } catch (RuntimeException unavailable) { return false; } }
    public boolean reverb() { try { return reverb != null && reverb.getEnabled(); } catch (RuntimeException unavailable) { return false; } }

    public boolean setLoudness(int millibels) {
        int value = Math.max(0, Math.min(1000, millibels));
        store.preferences().edit().putInt("loudness", value).apply();
        if (loudness == null) return false;
        try { loudness.setTargetGain(value); loudness.setEnabled(value > 0); return true; }
        catch (RuntimeException ignored) { return false; }
    }

    public void setSleepMinutes(int minutes) {
        SleepTimerPolicy.Deadline deadline = SleepTimerPolicy.minutes(minutes, System.currentTimeMillis(), SystemClock.elapsedRealtime());
        sleepAt = deadline.elapsed;
        store.preferences().edit().putLong(SLEEP_DEADLINE, deadline.wall).apply();
        changed(false);
    }

    /** Includes stored bands from an earlier device/session, without changing queue or timer. */
    public boolean resetEffects() {
        SharedPreferences prefs = store.preferences();
        syncImportedNormalization(); // Capture an unchecked import before clearing only its DSP selection.
        SharedPreferences.Editor edit = prefs.edit().putFloat("speed", 1f).putFloat("pitch", 1f)
                .putInt("bass", 0).putBoolean("reverb", false).putInt("loudness", 0).putBoolean("eq_enabled", false);
        for (String key : AudioEffectsPolicy.storedEqBands(prefs.getAll().keySet())) edit.remove(key);
        edit.apply(); speed = 1f; pitch = 1f; applySpeed();
        try { String neutral = PortableProfile.sound(new JSONObject()).toString(); store.preferences().edit().putString("portable_dsp", neutral).putString("portable_export_dsp", neutral).putBoolean("portable_dsp_apply", true).putBoolean("portable_dsp_pending", false).apply(); }
        catch (IOException | JSONException impossible) { throw new IllegalStateException(impossible); }
        applyPortableGain();
        updatePcmConfiguration();
        boolean applied = bassBoost == null || AudioEffectsPolicy.applyBass(bassDriver, 0);
        if (equalizer != null) try {
            for (short band = 0; band < equalizer.getNumberOfBands(); band++) equalizer.setBandLevel(band, (short) 0);
            applied &= equalizer.setEnabled(false) == android.media.audiofx.AudioEffect.SUCCESS && !equalizer.getEnabled();
        } catch (RuntimeException unavailable) { applied = false; }
        if (reverb != null) try {
            if (media != null) { media.setAuxEffectSendLevel(0f); media.attachAuxEffect(0); }
            applied &= reverb.setEnabled(false) == android.media.audiofx.AudioEffect.SUCCESS && !reverb.getEnabled();
        } catch (RuntimeException unavailable) { applied = false; }
        if (loudness != null) try {
            applied &= loudness.setEnabled(false) == android.media.audiofx.AudioEffect.SUCCESS && !loudness.getEnabled();
        } catch (RuntimeException unavailable) { applied = false; }
        changed(false); return applied;
    }

    private void applyEqPreferences() {
        if (equalizer == null) return;
        SharedPreferences prefs = store.preferences();
        if (prefs.getBoolean("portable_dsp_apply", false) && prefs.contains("portable_dsp")) {
            JSONObject sound = portableSound(); double[] gains = portableGains(); short[] range = equalizer.getBandLevelRange();
            for (short band = 0; band < equalizer.getNumberOfBands(); band++) equalizer.setBandLevel(band,
                    PortableAudioCurve.nativeLevel(gains, equalizer.getCenterFreq(band) / 1000d, range[0], range[1]));
            equalizer.setEnabled(sound.optBoolean("enabled", false)); return;
        }
        for (short band = 0; band < equalizer.getNumberOfBands(); band++) {
            short[] range = equalizer.getBandLevelRange();
            equalizer.setBandLevel(band, (short) Math.max(range[0], Math.min(range[1], prefs.getInt("eq_" + band, 0))));
        }
        // Old installations had no bypass preference; preserve that behaviour.
        equalizer.setEnabled(prefs.getBoolean("eq_enabled", true));
    }

    private JSONObject portableSound() {
        try {
            SharedPreferences prefs = store.preferences();
            if (prefs.contains("portable_dsp")) return PortableProfile.sound(new JSONObject(prefs.getString("portable_dsp", "{}")));
            JSONObject sound = PortableProfile.sound(new JSONObject()).put("rate", speed).put("preservesPitch", Math.abs(pitch - 1f) < .001f);
            if (eqAvailable()) sound.put("gains", hardwareCurve()).put("enabled", equalizer.getEnabled());
            return sound;
        } catch (IOException | JSONException | RuntimeException invalid) {
            try { return new JSONObject("{\"enabled\":false,\"preset\":\"Original\",\"gains\":[0,0,0,0,0],\"rate\":1,\"preservesPitch\":false,\"reverb\":0,\"echo\":0,\"preampDb\":0}"); }
            catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        }
    }

    private JSONArray hardwareCurve() throws JSONException {
        JSONArray result = new JSONArray(); int count = eqBandCount();
        double[] frequencies = new double[count], levels = new double[count];
        for (int band = 0; band < count; band++) { frequencies[band] = eqCenterHz(band); levels[band] = eqBandLevel(band) / 100d; }
        for (double frequency : PortableAudioCurve.FREQUENCIES) result.put(count == 0 ? 0 : Math.max(-12, Math.min(12, PortableAudioCurve.at(frequencies, levels, frequency))));
        return result;
    }

    private void updatePortableTransport(String key) {
        try { JSONObject sound = portableSound().put("rate", speed).put("preservesPitch", Math.abs(pitch - 1f) < .001f); if (store.preferences().contains("portable_dsp")) store.preferences().edit().putString("portable_dsp", sound.toString()).apply(); exportPortableKeys(sound, key); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    private void exportPortableKeys(JSONObject sound, String... keys) {
        try { JSONObject exported = store.preferences().contains("portable_export_dsp") ? PortableProfile.sound(new JSONObject(store.preferences().getString("portable_export_dsp", "{}"))) : new JSONObject(sound.toString()); for (String key : keys) exported.put(key, sound.get(key)); store.preferences().edit().putString("portable_export_dsp", exported.toString()).apply(); }
        catch (IOException | JSONException invalid) { throw new IllegalStateException(invalid); }
    }

    public double[] portableGains() {
        JSONArray gains = portableSound().optJSONArray("gains"); double[] result = new double[5];
        for (int i = 0; i < result.length; i++) result[i] = gains == null ? 0 : gains.optDouble(i, 0);
        return result;
    }
    public boolean portableSoundActive() { return store.preferences().getBoolean("portable_dsp_apply", false); }
    public boolean portableProfilePending() { return store.preferences().getBoolean("portable_dsp_pending", false); }
    public boolean portableSoundEnabled() { return portableSound().optBoolean("enabled", false); }
    public double portablePreampDb() { return portableSound().optDouble("preampDb", 0); }

    public void activatePortableSound() {
        JSONObject sound = portableSound();
        if (portableProfilePending()) try { sound = PortableProfile.sound(new JSONObject(store.preferences().getString("portable_profile", "{}")).getJSONObject("music").getJSONObject("dsp")); } catch (IOException | JSONException invalid) { error = "Не удалось прочитать сохранённый звук профиля"; changed(false); return; }
        float rate = (float) sound.optDouble("rate", 1);
        store.preferences().edit().putString("portable_dsp", sound.toString()).putString("portable_export_dsp", sound.toString()).putBoolean("portable_dsp_apply", true).putBoolean("portable_dsp_pending", false)
                .putFloat("speed", rate).putFloat("pitch", sound.optBoolean("preservesPitch", false) ? 1f : rate)
                .putInt("bass", 0).putBoolean("reverb", false).putInt("loudness", 0).apply();
        syncImportedNormalization(true);
        reloadSettings();
    }
    public void setPortableEnabled(boolean enabled) { try { JSONObject sound = portableSound().put("enabled", enabled); store.preferences().edit().putString("portable_dsp", sound.toString()).putBoolean("portable_dsp_apply", true).apply(); exportPortableKeys(sound,"enabled");updatePcmConfiguration(); changed(true); } catch (JSONException impossible) { throw new IllegalStateException(impossible); } }
    public void setPortableBand(int band, double gain) {
        if (band < 0 || band >= 5 || !Double.isFinite(gain) || gain < -12 || gain > 12) return;
        try { JSONObject sound = portableSound(); JSONArray gains = sound.getJSONArray("gains"); gains.put(band, gain); sound.put("enabled", true).put("preset", "Custom"); store.preferences().edit().putString("portable_dsp", sound.toString()).putBoolean("portable_dsp_apply", true).apply(); exportPortableKeys(sound,"gains","enabled","preset");updatePcmConfiguration(); changed(false); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    public void setPortablePreamp(double db) {
        if (!Double.isFinite(db) || db < -12 || db > 0) return;
        try { JSONObject sound = portableSound().put("preampDb", db); store.preferences().edit().putString("portable_dsp", sound.toString()).putBoolean("portable_dsp_apply", true).apply(); exportPortableKeys(sound,"preampDb");updatePcmConfiguration(); changed(false); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    private void applyPortableGain() {
        JSONObject sound = portableSound(); portableGain = portableSoundActive() && sound.optBoolean("enabled", false) ? (float) Math.pow(10, sound.optDouble("preampDb", 0) / 20d) : 1f;
        try { if (media != null && prepared) media.setVolume(outputVolume(), outputVolume()); } catch (RuntimeException unavailable) { }
        if(pcm!=null)pcm.volume(outputVolume());
    }

    /** Reapply portable preferences after a profile import without restarting playback. */
    public void reloadSettings() {
        SharedPreferences prefs = store.preferences();
        repeat = Math.max(0, Math.min(2, prefs.getInt("repeat", 0)));
        shuffle = prefs.getBoolean("shuffle", false);
        speed = Math.max(.5f, Math.min(2f, prefs.getFloat("speed", 1f)));
        pitch = Math.max(.5f, Math.min(2f, prefs.getFloat("pitch", 1f)));
        syncImportedNormalization();
        applySpeed();
        setBass(prefs.getInt("bass", 0));
        setReverb(prefs.getBoolean("reverb", false));
        setLoudness(prefs.getInt("loudness", 0));
        try { applyEqPreferences(); } catch (RuntimeException unavailable) { /* Keep honest device availability. */ }
        applyPortableGain();
        updatePcmConfiguration();
        changed(true);
    }

    public boolean pcmActive(){return pcm!=null;}
    public PcmPlayback.Snapshot pcmSnapshot(){return pcm==null?null:pcm.snapshot();}
    public boolean normalization(){return normalization;}
    public boolean normalizationPending(){return store.preferences().getBoolean("pcm_normalization_pending",false);}
    public void activateProfileNormalization(){syncImportedNormalization(true);updatePcmConfiguration();changed(false);}
    public double portableEcho(){return portableSound().optDouble("echo",0);}
    public double portableReverb(){return portableSound().optDouble("reverb",0);}
    public void setPortableEffect(String effect,double value){
        if(!(effect.equals("echo")||effect.equals("reverb"))||!Double.isFinite(value)||value<0||value>.8)return;
        try{JSONObject sound=portableSound().put(effect,value).put("enabled",true);store.preferences().edit().putString("portable_dsp",sound.toString()).putBoolean("portable_dsp_apply",true).apply();exportPortableKeys(sound,effect,"enabled");updatePcmConfiguration();changed(false);}catch(JSONException impossible){throw new IllegalStateException(impossible);}
    }
    public void setNormalization(boolean enabled){
        try{SharedPreferences prefs=store.preferences();JSONObject snapshot=prefs.contains("portable_profile")?PortableProfile.parse(prefs.getString("portable_profile","")):PortableProfile.normalize(new JSONObject().put("format","lolzcloud-profile").put("version",1));snapshot.getJSONObject("tools").put("normalization",enabled);String json=PortableProfile.normalize(snapshot).toString();prefs.edit().putBoolean("pcm_normalization",enabled).putString("portable_profile",json).putString("pcm_normalization_snapshot",profileFingerprint(json)).putBoolean("pcm_normalization_pending",false).apply();normalization=enabled;updatePcmConfiguration();changed(false);}catch(IOException|JSONException invalid){error="Не удалось сохранить нормализацию: "+invalid.getMessage();changed(true);}
    }
    private void syncImportedNormalization(){syncImportedNormalization(false);}
    private void syncImportedNormalization(boolean explicit){
        SharedPreferences prefs=store.preferences();if(!prefs.contains("portable_profile"))return;
        String json=prefs.getString("portable_profile",""),fingerprint=profileFingerprint(json);boolean same=fingerprint.equals(prefs.getString("pcm_normalization_snapshot",""));
        if(!explicit&&prefs.getBoolean("portable_dsp_pending",false)){if(!same)prefs.edit().putString("pcm_normalization_snapshot",fingerprint).putBoolean("pcm_normalization_pending",true).apply();return;}
        if(!explicit&&(same||!prefs.getBoolean("portable_dsp_apply",false)))return;
        try{normalization=PortableProfile.parse(json).getJSONObject("tools").getBoolean("normalization");prefs.edit().putBoolean("pcm_normalization",normalization).putString("pcm_normalization_snapshot",fingerprint).putBoolean("pcm_normalization_pending",false).apply();}catch(IOException|JSONException invalid){/* A damaged sidecar never changes the applied setting. */}
    }
    private static String profileFingerprint(String json){try{byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte b:hash)result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return result.toString();}catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}}
    private boolean wantsPcm(){return normalization||portableSoundActive()&&portableSoundEnabled();}
    private PcmDsp.Config pcmConfiguration(){JSONObject sound=portableSound();return new PcmDsp.Config(dspRevision,portableSoundActive()&&sound.optBoolean("enabled",false),portableGains(),sound.optDouble("preampDb",0),sound.optDouble("echo",0),sound.optDouble("reverb",0),normalization);}
    private void updatePcmConfiguration(){
        dspRevision++;
        if(pcm!=null){pcm.configure(pcmConfiguration());pcm.volume(outputVolume());return;}
        if(media!=null&&wantsPcm()){long at=position();boolean resume=isPlaying()||playWhenReady;pendingSeek=at;loadCurrent(resume);return;}
        try{applyEqPreferences();}catch(RuntimeException unavailable){}applyPortableGain();
    }
    public String pcmStatus(){
        if(pcm==null)return wantsPcm()?(error.isEmpty()?"Настройки сохранены. Включи трек, чтобы проверить PCM вывод.":error):"Исходный режим. Общая обработка выключена.";
        PcmPlayback.Snapshot state=pcm.snapshot();if(!prepared)return "Готовим декодер и AudioTrack…";
        if(state.state.equals("bypassed"))return "AudioTrack · исходный PCM. Обработка выключена.";
        if(state.appliedRevision!=state.requestedRevision)return "Настройки ожидают вывода PCM. На паузе звук не запускается.";
        String status="PCM · "+state.sampleRate+" Гц · "+state.channels+" кан. · "+(isPlaying()?"обработка в аудиовыходе":"пауза");
        if(normalization)status+=state.normalizationMeasured?String.format(java.util.Locale.ROOT,"\nНормализация: %.1f LUFS · %+.1f дБ",state.loudness,state.normalizationDb):"\nИзмеряем громкость: первые3секунды.";
        return status;
    }

    public void stopPlayback() {
        if(wave!=null)wave.stop();
        pause();
        pendingSeek = position();
        releasePlayer();
        if (foreground) { stopForeground(true); foreground = false; }
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION_ID);
        stopSelf();
        changed(false);
    }

    private void loadCurrent(boolean play) {
        releasePlayer();
        syncImportedNormalization();
        error = "";
        playWhenReady = play;
        Track track = current();
        if(wave!=null)wave.loaded(sourceGeneration);
        if (track == null) { changed(true); return; }
        if (track.isCatalogReference()) {
            Track saved = store.find(track.id);
            if (saved != null && !saved.isCatalogReference()) {
                String referenceId = track.id;
                for (int i = 0; i < queue.size(); i++) if (queue.get(i).id.equals(referenceId)) queue.set(i, saved);
                track = saved;
            }
        }
        cycleVisited.add(index);
        // The selected queue must survive a network/prepare failure before onPrepared.
        save();
        if (track.isCatalogReference()) { resolvePortableReference(track, play); return; }
        if (!LibraryStore.isPlayable(this, track.uri)) {
            fail("Источник нельзя воспроизвести. Выберите локальный файл или прямую HTTPS-ссылку на аудио");
            return;
        }
        if (!OnlineCatalog.audioId(track.uri).isEmpty()) {
            prepareCatalogAudio(track, play);
            return;
        }
        if (play && !ensureForeground()) return;
        openPlayer(track);
    }

    private void resolvePortableReference(final Track reference, boolean play) {
        preparingAudio = true;
        if (play && !ensureForeground()) { preparingAudio = false; return; }
        final long generation = sourceGeneration;
        try {
            preparationWake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LolzCloud:profile-resolve");
            preparationWake.acquire(35_000);
        } catch (RuntimeException ignored) { }
        sourceDeadline = () -> { if (ownsPreparation(generation, reference)) fail("Не удалось найти запись вовремя. Нажми «Повторить»"); };
        handler.postDelayed(sourceDeadline, 30_000); changed(true);
        sourceTask = sourceIo.submit(() -> {
            try {
                final Track resolved = sourceCatalog.resolveReference(reference);
                handler.post(() -> {
                    if (!ownsPreparation(generation, reference)) return;
                    try {
                        Track canonical = store.resolvePortableReference(reference, resolved);
                        for (int i = 0; i < queue.size(); i++) if (queue.get(i).id.equals(reference.id)) queue.set(i, canonical);
                        boolean resume = playWhenReady;
                        finishPreparation(); loadCurrent(resume);
                    } catch (IOException failure) { fail(failure.getMessage()); }
                });
            } catch (IOException failure) {
                final String message = failure.getMessage() == null ? "Не удалось найти запись. Нажми «Повторить»" : failure.getMessage();
                handler.post(() -> { if (ownsPreparation(generation, reference)) fail(message); });
            } catch (RuntimeException failure) {
                handler.post(() -> { if (ownsPreparation(generation, reference)) fail("Не удалось найти запись. Нажми «Повторить»"); });
            }
        });
    }

    private void prepareCatalogAudio(final Track track, boolean play) {
        preparingAudio = true;
        if (play && !ensureForeground()) { preparingAudio = false; return; }
        final long generation = sourceGeneration;
        try {
            preparationWake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LolzCloud:prepare");
            preparationWake.acquire(AudioPreparation.BUDGET_MS + 10_000);
        } catch (RuntimeException ignored) { }
        sourceDeadline = () -> {
            if (sourceGeneration == generation && preparingAudio)
                fail("Подготовка трека заняла слишком много времени. Нажми «Повторить»");
        };
        handler.postDelayed(sourceDeadline, AudioPreparation.BUDGET_MS);
        changed(true);
        sourceTask = sourceIo.submit(() -> {
            try {
                sourceCatalog.prepareAudio(track.uri);
                handler.post(() -> {
                    if (!ownsPreparation(generation, track)) return;
                    finishPreparation();
                    openPlayer(track);
                });
            } catch (IOException failure) {
                final String message = failure.getMessage() == null ? "Не удалось подготовить запись. Нажми «Повторить»" : failure.getMessage();
                handler.post(() -> { if (ownsPreparation(generation, track)) fail(message); });
            } catch (RuntimeException failure) {
                handler.post(() -> { if (ownsPreparation(generation, track)) fail("Не удалось подготовить запись. Нажми «Повторить»"); });
            }
        });
    }

    private boolean ownsPreparation(long generation, Track track) {
        Track active = current();
        return preparingAudio && generation == sourceGeneration && active != null && active.id.equals(track.id) && active.uri.equals(track.uri);
    }

    private void finishPreparation() {
        preparingAudio = false; sourceTask = null;
        if (sourceDeadline != null) { handler.removeCallbacks(sourceDeadline); sourceDeadline = null; }
        if (preparationWake != null) {
            try { if (preparationWake.isHeld()) preparationWake.release(); } catch (RuntimeException ignored) { }
            preparationWake = null;
        }
    }

    private void openPlayer(final Track track) {
        if(wantsPcm()){openPcm(track);return;}
        final MediaPlayer player;
        try { player = new MediaPlayer(); }
        catch (RuntimeException failure) { fail("Не удалось запустить аудиоплеер Android. Нажми «Повторить»"); return; }
        media = player;
        try {
            player.setAudioAttributes(attributes());
            player.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            player.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                @Override public void onPrepared(MediaPlayer value) {
                    if (media != value) return;
                    if (playerDeadline != null) { handler.removeCallbacks(playerDeadline); playerDeadline = null; }
                    prepared = true;
                    try {
                        if (pendingSeek > 0) {
                            pendingSeek = Math.min(pendingSeek, Math.max(0, value.getDuration()));
                            seeking = true;
                            value.seekTo(pendingSeek, MediaPlayer.SEEK_CLOSEST);
                        }
                        value.setVolume(outputVolume(), outputVolume());
                        createEffects();
                        if (playWhenReady) {
                            if (acquireFocus()) {
                                value.start();
                                applySpeed();
                                store.recordPlayed(current());
                            }
                        }
                        save();
                        changed(true);
                    } catch (RuntimeException failure) { fail(playbackFailure(track.uri, 0, 0)); }
                }
            });
            player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override public void onCompletion(MediaPlayer value) {
                    if (media != value) return;
                    naturalEnd();
                }
            });
            player.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override public boolean onError(MediaPlayer value, int what, int extra) {
                    if (media != value) return true;
                    fail(playbackFailure(track.uri, what, extra));
                    return true;
                }
            });
            player.setOnSeekCompleteListener(new MediaPlayer.OnSeekCompleteListener() {
                @Override public void onSeekComplete(MediaPlayer value) {
                    if (media != value) return;
                    seeking = false;
                    save();
                    changed(false);
                }
            });
            player.setDataSource(this, Uri.parse(track.uri));
            player.prepareAsync();
            playerDeadline = () -> {
                if (media == player && !prepared) fail("Аудио долго не загружается. Проверь соединение и нажми «Повторить»");
            };
            handler.postDelayed(playerDeadline, 30_000);
            changed(true);
        } catch (SecurityException failure) {
            fail("Доступ к файлу потерян. Добавьте его через системный проводник ещё раз");
        } catch (IOException | RuntimeException failure) {
            fail(playbackFailure(track.uri, 0, MediaPlayer.MEDIA_ERROR_IO));
        }
    }

    private void openPcm(final Track track){
        final long generation=sourceGeneration;
        final PcmPlayback player=new PcmPlayback(this,track.uri,pendingSeek,pcmConfiguration(),new PcmPlayback.Listener(){
            private boolean owns(PcmPlayback value){return pcm==value&&!destroyed&&sourceGeneration==generation;}
            public void prepared(PcmPlayback value){if(!owns(value))return;if(playerDeadline!=null){handler.removeCallbacks(playerDeadline);playerDeadline=null;}prepared=true;pendingSeek=value.position();value.parameters(speed,pitch);value.volume(outputVolume());if(playWhenReady&&ensureForeground()&&acquireFocus()){value.play();store.recordPlayed(current());}save();changed(true);}
            public void seeked(PcmPlayback value,long epoch){if(!owns(value)||value.epoch()!=epoch)return;seeking=false;pendingSeek=value.position();save();changed(false);}
            public void completed(PcmPlayback value,long epoch){if(owns(value)&&value.epoch()==epoch)naturalEnd();}
            public void failed(PcmPlayback value,String message){if(owns(value))fail(message);}
            public void stateChanged(PcmPlayback value){if(owns(value))changed(true);}
        });
        pcm=player;prepared=false;seeking=false;player.parameters(speed,pitch);player.volume(outputVolume());
        playerDeadline=()->{if(pcm==player&&!prepared)fail("Подготовка PCM заняла слишком много времени. Нажми «Повторить»");};handler.postDelayed(playerDeadline,30000);player.prepare();changed(true);
    }

    private void naturalEnd(){
        if(!playWhenReady)return;
        if(repeat==2){seekTo(0);play();return;}
        if(wave!=null&&wave.completed(sourceGeneration))return;
        if(repeat==0&&((!shuffle&&index>=queue.size()-1)||(shuffle&&cycleVisited.size()>=queue.size()))){seekTo(0);pause();}
        else next();
    }

    private static String playbackFailure(String address, int what, int extra) {
        if (what == MediaPlayer.MEDIA_ERROR_SERVER_DIED) return "Аудиоплеер Android остановился. Нажми «Повторить»";
        if (extra == MediaPlayer.MEDIA_ERROR_MALFORMED || extra == MediaPlayer.MEDIA_ERROR_UNSUPPORTED)
            return "Android не поддерживает формат этой записи. Выбери другой трек";
        boolean online = "https".equals(Uri.parse(address).getScheme());
        if (extra == MediaPlayer.MEDIA_ERROR_TIMED_OUT || extra == MediaPlayer.MEDIA_ERROR_IO)
            return online ? "Не удалось загрузить аудио. Проверь интернет и нажми «Повторить»" : "Файл недоступен. Проверь доступ к нему или добавь его заново";
        return online ? "Не удалось воспроизвести запись. Нажми «Повторить» или выбери другой трек" : "Не удалось воспроизвести файл. Проверь его формат и доступ к нему";
    }

    private void createEffects() {
        int audioSession = media.getAudioSessionId();
        SharedPreferences prefs = store.preferences();
        try {
            equalizer = new Equalizer(0, audioSession);
            applyEqPreferences();
        } catch (RuntimeException ignored) { if (equalizer != null) equalizer.release(); equalizer = null; }
        try { bassBoost = new BassBoost(0, audioSession); setBass(prefs.getInt("bass", 0)); }
        catch (RuntimeException ignored) { if (bassBoost != null) bassBoost.release(); bassBoost = null; }
        try { reverb = new PresetReverb(0, 0); setReverb(prefs.getBoolean("reverb", false)); }
        catch (RuntimeException ignored) { if (reverb != null) reverb.release(); reverb = null; }
        try { loudness = new LoudnessEnhancer(audioSession); setLoudness(prefs.getInt("loudness", 0)); }
        catch (RuntimeException ignored) { if (loudness != null) loudness.release(); loudness = null; }
        if (!prefs.contains("portable_dsp")) {
            JSONObject initial = portableSound(); prefs.edit().putString("portable_dsp", initial.toString()).putBoolean("portable_dsp_apply", false).apply();
            if (!prefs.contains("portable_profile")) exportPortableKeys(initial, "enabled", "gains");
        }
        applyPortableGain();
    }

    private void applySpeed() {
        if(pcm!=null){pcm.parameters(speed,pitch);return;}
        if (media == null || !prepared) return;
        boolean playing = isPlaying();
        try {
            // PlaybackParams can start a paused MediaPlayer, so restore its paused state explicitly.
            media.setPlaybackParams(new PlaybackParams().allowDefaults().setSpeed(speed).setPitch(pitch));
            if (!playing) media.pause();
        } catch (RuntimeException failure) {
            error = "Этот источник или устройство не поддерживает выбранную скорость";
        }
    }

    private boolean acquireFocus() {
        if (hasFocus) return true;
        if (focusRequested && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
        final long generation = ++focusGeneration;
        focusCallback = change -> {
            if (generation == focusGeneration && focusRequested) focusListener.onAudioFocusChange(change);
        };
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes()).setOnAudioFocusChangeListener(focusCallback, handler)
                .setWillPauseWhenDucked(false).build();
        focusRequested = true;
        if (audio.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            hasFocus = true;
            ducked = false;
            applySinkVolume();
            return true;
        }
        abandonFocus();
        playWhenReady = false;
        error = "Звук занят другим приложением. Нажмите воспроизведение ещё раз";
        if (foreground) { stopForeground(false); foreground = false; }
        changed(true);
        return false;
    }

    private void abandonFocus() {
        focusGeneration++;
        if (focusRequested && audio != null && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
        focusRequested = false;
        hasFocus = false;
        ducked = false;
    }

    private float outputVolume() { return volume * (ducked ? .2f : 1f) * (pcm==null?portableGain:1f); }
    private void applySinkVolume(){try{if(media!=null)media.setVolume(outputVolume(),outputVolume());}catch(IllegalStateException ignored){}if(pcm!=null)pcm.volume(outputVolume());}

    private boolean ensureForeground() {
        if (foreground) return true;
        try {
            // Starting the bound service keeps audio alive when the Activity is closed.
            startForegroundService(new Intent(this, PlaybackService.class).setAction(ACTION_KEEP));
            startForeground(NOTIFICATION_ID, notification());
            foreground = true;
            return true;
        } catch (RuntimeException failure) {
            error = "Android не разрешил фоновое воспроизведение. Откройте приложение и попробуйте снова";
            playWhenReady = false;
            stopSelf();
            changed(false);
            return false;
        }
    }

    private void fail(String message) {
        if(wave!=null)wave.paused();
        pendingSeek = position();
        error = message;
        playWhenReady = false;
        resumeOnFocus = false;
        releasePlayer();
        save();
        abandonFocus();
        if (foreground) { stopForeground(false); foreground = false; }
        changed(true);
    }

    private void releasePlayer() {
        sourceGeneration++;
        if (sourceTask != null) sourceTask.cancel(true);
        sourceCatalog.cancel();
        finishPreparation();
        if(pcm!=null){pcm.close();pcm=null;}
        if (playerDeadline != null) { handler.removeCallbacks(playerDeadline); playerDeadline = null; }
        prepared = false;
        seeking = false;
        if (equalizer != null) { try { equalizer.release(); } catch (RuntimeException ignored) { } equalizer = null; }
        if (bassBoost != null) { try { bassBoost.release(); } catch (RuntimeException ignored) { } bassBoost = null; }
        if (reverb != null) { try { reverb.release(); } catch (RuntimeException ignored) { } reverb = null; }
        if (loudness != null) { try { loudness.release(); } catch (RuntimeException ignored) { } loudness = null; }
        if (media != null) { try { media.release(); } catch (RuntimeException ignored) { } media = null; }
    }

    private void save() {
        if (store != null) store.saveQueue(queue, index, position());
        lastSave = SystemClock.elapsedRealtime();
    }

    private void changed(boolean refreshNotification) {
        updateSession();
        if (refreshNotification && current() != null) {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification());
        }
        if (listener != null) {
            try { listener.onStateChanged(); } catch (RuntimeException ignored) { }
        }
    }

    private void updateSession() {
        if (session == null) return;
        Track track = current();
        int state = error.length() > 0 ? PlaybackState.STATE_ERROR : isLoading() ? PlaybackState.STATE_BUFFERING
                : isPlaying() ? PlaybackState.STATE_PLAYING : track == null ? PlaybackState.STATE_NONE : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder builder = new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SET_PLAYBACK_SPEED)
                .setState(state, position(), isPlaying() ? speed : 0f, SystemClock.elapsedRealtime());
        if (!error.isEmpty()) builder.setErrorMessage(error);
        session.setPlaybackState(builder.build());
        long length = duration();
        if (track != null && (!track.id.equals(metadataId) || length != metadataDuration)) {
            session.setMetadata(new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, track.id)
                    .putString(MediaMetadata.METADATA_KEY_TITLE, track.title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, track.artist)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, length).build());
            metadataId = track.id;
            metadataDuration = length;
        } else if (track == null && !metadataId.isEmpty()) {
            session.setMetadata(null);
            metadataId = "";
            metadataDuration = -1;
        }
    }

    private Notification notification() {
        Track track = current();
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean playing = isPlaying() || isLoading();
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(track == null ? "LolzCloud" : track.title)
                .setContentText(error.isEmpty() ? track == null ? "Твоя музыка" : track.artist : error)
                .setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT).setOnlyAlertOnce(true)
                .setOngoing(playing).setShowWhen(false).setColor(0xffa5e5bd)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Назад", action(ACTION_PREVIOUS, 1)).build())
                .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Пауза" : error.isEmpty() ? "Слушать" : "Повторить", action(playing ? ACTION_PAUSE : ACTION_PLAY, 2)).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Далее", action(ACTION_NEXT, 3)).build())
                .setDeleteIntent(action(ACTION_STOP, 4))
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
                .build();
    }

    private PendingIntent action(String action, int request) {
        return PendingIntent.getService(this, request, new Intent(this, PlaybackService.class).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static AudioAttributes attributes() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
    }

    private final AudioManager.OnAudioFocusChangeListener focusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override public void onAudioFocusChange(int change) {
            if (change == AudioManager.AUDIOFOCUS_LOSS) {
                hasFocus = false;
                pauseInternal(false);
            } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                boolean resume = isPlaying() || playWhenReady;
                hasFocus = false;
                pauseInternal(resume);
            } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                ducked = true;
                applySinkVolume();
            } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
                hasFocus = true;
                ducked = false;
                applySinkVolume();
                if (resumeOnFocus) { resumeOnFocus = false; play(); }
            }
        }
    };

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) pause();
        }
    };

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if(wave!=null)wave.tick();
            if (sleepAt > 0 && SystemClock.elapsedRealtime() >= sleepAt) {
                sleepAt = 0;
                store.preferences().edit().putLong(SLEEP_DEADLINE, 0).apply();
                pause();
            }
            if (isPlaying()) {
                position(); // Keep a recent fallback even when the native player enters its error state.
                // Android extrapolates the lock-screen position from elapsed time and speed.
                // Refresh only at meaningful events and persistence checkpoints, not twice a second.
                if (SystemClock.elapsedRealtime() - lastSave >= 10_000) { save(); updateSession(); }
            }
            if (listener != null) {
                try { listener.onStateChanged(); } catch (RuntimeException ignored) { }
            }
            handler.postDelayed(this, 500);
        }
    };

    @Override public void onTaskRemoved(Intent rootIntent) {
        save();
        if (!isPlaying() && !isLoading()) stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        destroyed = true;
        if (running == this) running = null;
        save();
        if(wave!=null)wave.close();
        if(waveWake!=null){try{if(waveWake.isHeld())waveWake.release();}catch(RuntimeException ignored){}waveWake=null;}
        handler.removeCallbacksAndMessages(null);
        listener = null;
        releasePlayer();
        sourceIo.shutdownNow();
        abandonFocus();
        if (session != null) { session.setActive(false); session.release(); }
        try { unregisterReceiver(noisyReceiver); } catch (IllegalArgumentException ignored) { }
        if (foreground) stopForeground(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION_ID);
        super.onDestroy();
    }
}
