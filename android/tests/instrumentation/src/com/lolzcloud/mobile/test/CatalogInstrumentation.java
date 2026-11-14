package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.EditText;
import com.lolzcloud.mobile.LibraryStore;
import com.lolzcloud.mobile.MainActivity;
import com.lolzcloud.mobile.OnlineActivity;
import com.lolzcloud.mobile.OnlineCatalog;
import com.lolzcloud.mobile.PlaybackService;
import com.lolzcloud.mobile.Track;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;

/** Emulator-only real public API/native views/MediaPlayer regression. No media SDK is substituted. */
public final class CatalogInstrumentation extends Instrumentation {
    private final JSONArray checks = new JSONArray(), captures = new JSONArray();
    private MainActivity activity;
    private PlaybackService player;
    private LibraryStore store;
    private Map<String, ?> backup;
    private Set<String> previousFiles = new HashSet<>();
    private String wifi, data;
    private File createdFile;
    private ActivityMonitor browserMonitor, webMonitor;
    private Bundle arguments;
    private interface Condition { boolean get() throws Exception; }
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); this.arguments=arguments; start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject(); int result = Activity.RESULT_OK;
        try {
            check(shell("getprop ro.kernel.qemu").trim().equals("1"), "Only the isolated Android emulator may run library/network mutations");
            store = new LibraryStore(getTargetContext()); backup = store.preferences().getAll();
            for (Track track : store.tracks()) previousFiles.add(track.uri);
            IntentFilter browserFilter=new IntentFilter(Intent.ACTION_VIEW);browserFilter.addDataScheme("http");browserFilter.addDataScheme("https");
            browserMonitor = addMonitor(browserFilter, new ActivityResult(Activity.RESULT_CANCELED, null), true);
            webMonitor = addMonitor(OnlineActivity.class.getName(), new ActivityResult(Activity.RESULT_CANCELED, null), true);
            activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            await(() -> { player = (PlaybackService) field(activity, "player"); return player != null; }, 15000, "Production native playback service binds");
            onMain(() -> { player.stopPlayback(); player.setRepeat(0); player.setShuffle(false); store.setPrivateMode(false); });
            if(arguments!=null&&"audio-audit".equals(arguments.getString("phase"))){ audioAudit(); report.put("phase","audio-audit");report.put("injectedFocusCallbacks",true);report.put("generatedSilentAudioFixture",true); }
            else if(arguments!=null&&"audio-retry".equals(arguments.getString("phase"))){ audioRecovery(); report.put("phase","audio-retry"); }
            else { parser(); audioRecovery(); uiAndAudio(); }
            report.put("status", "passed");
        } catch (Throwable error) { result = Activity.RESULT_CANCELED; try { report.put("status", "failed"); report.put("error", error.toString()); if (player != null) report.put("playbackError", player.error()); } catch (Exception ignored) { } }
        finally {
            try { restoreNetwork(); } catch (Exception ignored) { }
            try {
                if (activity != null) onMain(() -> { if (player != null) player.stopPlayback(); activity.finish(); getTargetContext().stopService(new Intent(getTargetContext(), PlaybackService.class)); });
                waitForIdleSync(); SystemClock.sleep(200);
                if (activity != null) {
                    java.util.concurrent.ExecutorService downloads=(java.util.concurrent.ExecutorService)field(activity,"io"); downloads.shutdownNow();
                    if(!downloads.awaitTermination(25,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("Test download worker did not stop before restoring preferences");
                }
                restorePreferences();
                if (createdFile != null && !previousFiles.contains(android.net.Uri.fromFile(createdFile).toString())) {
                    File base = new File(getTargetContext().getFilesDir(), "offline").getCanonicalFile();
                    if (base.equals(createdFile.getCanonicalFile().getParentFile())) createdFile.delete();
                }
            } catch (Throwable error) { try { report.put("cleanupError", error.toString()); report.put("status", "failed"); result = Activity.RESULT_CANCELED; } catch (Exception ignored) { } }
            if (browserMonitor != null) removeMonitor(browserMonitor); if (webMonitor != null) removeMonitor(webMonitor);
        }
        try {
            report.put("checks", checks); report.put("screenshots", captures); report.put("realPublicHttps", !"audio-audit".equals(report.optString("phase"))); report.put("nativeMediaPlayer", true); report.put("fakeMediaSdk", false); report.put("personalAccountsUsed", false);
            report.put("version",getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0).versionName);
            java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");try(InputStream apk=new java.io.FileInputStream(getTargetContext().getApplicationInfo().sourceDir)){byte[] buffer=new byte[32768];int size;while((size=apk.read(buffer))!=-1)digest.update(buffer,0,size);}StringBuilder hash=new StringBuilder();for(byte value:digest.digest())hash.append(String.format(java.util.Locale.ROOT,"%02x",value&255));report.put("apkSha256",hash.toString());
            File output = new File(getTargetContext().getFilesDir(), "android-catalog-test.json");
            try (FileOutputStream out = new FileOutputStream(output)) { out.write(report.toString(2).getBytes(StandardCharsets.UTF_8)); }
            File external=new File(getTargetContext().getExternalFilesDir(null),"native-catalog");external.mkdirs();
            try(FileOutputStream out=new FileOutputStream(new File(external,"android-catalog-test.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
            Bundle bundle = new Bundle(); bundle.putString("stream", report.toString(2) + "\n"); finish(result, bundle);
        } catch (Exception error) { Bundle bundle = new Bundle(); bundle.putString("stream", error.toString()); finish(Activity.RESULT_CANCELED, bundle); }
    }

    private void parser() throws Exception {
        String audio = "https://lolzcloud.com/music/audio/1930572542/bcd527cc110efa95cb49a325.mp3";
        JSONObject track = new JSONObject().put("id", "1930572542").put("title", "Catalog parser fixture").put("artist", "Test")
                .put("url", "https://soundcloud.com/darkprinceee/gnoy").put("cover", "https://i1.sndcdn.com/fixture.jpg").put("duration", 89).put("audioUrl", audio);
        JSONObject response = new JSONObject().put("tracks", new JSONArray().put(track)).put("nextOffset", "");
        Track decoded = OnlineCatalog.parse(response.toString()).tracks.get(0);
        check(decoded.id.equals("soundcloud:1930572542") && decoded.duration == 89000 && decoded.sourceUrl.equals(track.getString("url")), "Real Android JSON parser maps stable SoundCloud identity, source and milliseconds");
        for (String[] invalid : new String[][]{{"audioUrl", "https://evil.test/song.mp3"}, {"audioUrl", audio.replace("1930572542", "1930572543")}, {"cover", "https://evil.test/cover.jpg"}, {"url", "https://soundcloud.com/artist/sets/playlist"}}) {
            JSONObject changed = new JSONObject(track.toString()).put(invalid[0], invalid[1]); boolean rejected = false;
            try { OnlineCatalog.parse(new JSONObject(response.toString()).put("tracks", new JSONArray().put(changed)).toString()); } catch (java.io.IOException expected) { rejected = true; }
            check(rejected, "Android parser rejects malformed " + invalid[0] + " before playback");
        }
        JSONObject tooLong = new JSONObject(track.toString()).put("duration", 1201); boolean rejected = false;
        try { OnlineCatalog.parse(new JSONObject(response.toString()).put("tracks", new JSONArray().put(tooLong)).toString()); } catch (java.io.IOException expected) { rejected = true; }
        check(rejected, "Android parser enforces the 20-minute catalog bound");
        Track legacy = Track.fromJson(new JSONObject().put("id", "legacy-fixture").put("title", "Local").put("artist", "Test").put("uri", "content://fixture/file").put("duration", 40000));
        check(legacy.sourceUrl.isEmpty() && legacy.coverUrl.isEmpty() && Track.fromJson(decoded.toJson()).sourceUrl.equals(decoded.sourceUrl), "Legacy track JSON migrates without losing new catalog attribution");
        Method preparation = OnlineCatalog.class.getDeclaredMethod("parsePreparation", int.class, String.class, String.class); preparation.setAccessible(true);
        Object ready = preparation.invoke(null, 200, new JSONObject().put("state", "ready").put("audioUrl", audio).toString(), audio);
        check((Boolean)field(ready,"ready"), "Preparation accepts only the requested canonical audio URL");
        Object pending = preparation.invoke(null, 202, new JSONObject().put("state","preparing").put("retryAfterMs",1000).toString(), audio);
        check(!(Boolean)field(pending,"ready"), "A preparing response cannot be played as a ready MP3");
        for(String body:new String[]{"{}", "{\"state\":\"ready\",\"audioUrl\":\"https://evil.test/song.mp3\"}", new JSONObject().put("state","ready").put("audioUrl",audio.replace("1930572542","1930572543")).toString()}) {
            boolean denied = false; try { preparation.invoke(null, 200, body, audio); } catch(java.lang.reflect.InvocationTargetException expected) { denied = expected.getCause() instanceof java.io.IOException; }
            check(denied, "Malformed or substituted preparation response never reaches native playback");
        }
        boolean unsupported = false;
        try { preparation.invoke(null,503,new JSONObject().put("error","Источник не отдал поддерживаемый полный поток. Выбери другую запись").toString(),audio); }
        catch(java.lang.reflect.InvocationTargetException expected) { unsupported = expected.getCause().getMessage().contains("поддерживаемый полный поток"); }
        check(unsupported, "Unsupported stream error is preserved without blaming a local file");
    }

    private void audioRecovery() throws Exception {
        Track supported = new OnlineCatalog().search("https://soundcloud.com/darkprinceee/gnoy", "0").tracks.get(0);
        Track denied = new Track("soundcloud:1930572543", "Denied signature test fixture", "Instrumentation",
                "https://lolzcloud.com/music/audio/1930572543/000000000000000000000000.mp3", supported.duration);
        final List<Track> queue = new ArrayList<>(); queue.add(supported); queue.add(denied);
        onMain(() -> { player.setQueue(queue,1,true); player.seekTo(17000); invoke(activity,"navigate",new Class<?>[]{String.class},"player"); });
        await(() -> !player.error().isEmpty() && !player.isLoading(), 20000, "A genuinely rejected signed URL yields a bounded native playback error");
        check(player.currentIndex()==1 && player.queue().size()==2 && player.current().uri.equals(denied.uri)
                && store.savedIndex()==1 && store.savedQueue().size()==2 && store.savedQueue().get(1).uri.equals(denied.uri)
                && player.position()==17000 && store.savedPosition()==17000, "Preparation failure preserves selected queue, index and seek in memory and on disk");
        await(() -> activity.getWindow().getDecorView().findViewWithTag("audio_retry")!=null
                && activity.getWindow().getDecorView().findViewWithTag("audio_retry").isShown(), 5000,"Playback failure exposes the native Retry action");
        final boolean[] readable={false};onMain(()->{android.widget.TextView status=(android.widget.TextView)fieldUnchecked(activity,"audioStatusText");readable[0]=status.isShown()&&status.getText().toString().equals(player.error());});
        check(readable[0],"The native player displays the actual readable failure beside Retry");
        screenshot("catalog-audio-retry");
        final boolean[] retryStarted={false}; onMain(() -> {
            View retry=activity.getWindow().getDecorView().findViewWithTag("audio_retry");retry.performClick();
            retryStarted[0]=player.isLoading() && player.error().isEmpty() && !player.loadingMessage().isEmpty();
        });
        check(retryStarted[0], "Tapping the visible native Retry button clears the error and prepares the existing selection");
        await(() -> !player.error().isEmpty() && !player.isLoading(), 20000, "A rejected retry remains an actionable error");
        check(player.currentIndex()==1 && player.queue().size()==2 && player.position()==17000 && store.savedPosition()==17000,
                "Retry never resets the selected queue or last position");
        onMain(() -> { player.play(); player.playIndex(0); player.pause(); });
        SystemClock.sleep(1300);
        check(!player.isLoading() && !player.isPlaying() && player.error().isEmpty() && player.currentIndex()==0,
                "Pause cancels preparation and stale requests cannot autoplay or overwrite the new selection");
        onMain(() -> player.play());
        await(() -> player.isPlaying() && player.error().isEmpty() && player.currentIndex()==0, 60000,
                "The supported source plays through prepare and native MediaPlayer after cancellation");
        onMain(() -> player.pause());
    }

    private void audioAudit() throws Exception {
        File directory=new File(getTargetContext().getFilesDir(),"offline");directory.mkdirs();
        createdFile=new File(directory,"audit-"+java.util.UUID.randomUUID()+".audio");
        try(InputStream in=getContext().getAssets().open("fixtures/night-route.mp3");FileOutputStream out=new FileOutputStream(createdFile)){
            byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
        }
        String uri=android.net.Uri.fromFile(createdFile).toString(),suffix=java.util.UUID.randomUUID().toString();
        Track a=new Track("audit-a-"+suffix,"Generated audit A","Silent test fixture",uri,40000);
        Track b=new Track("audit-b-"+suffix,"Generated audit B","Silent test fixture",uri,40000);
        Track c=new Track("audit-c-"+suffix,"Generated audit C","Silent test fixture",uri,40000);
        onMain(()->player.setQueue(java.util.Collections.singletonList(a),0,true));
        await(()->player.isPlaying(),10000,"Real native MediaPlayer plays the generated local audit fixture");
        onMain(()->player.seekTo(15000));await(()->!(Boolean)field(player,"seeking")&&player.position()>=14500,8000,"Audit fixture reaches an actual nonzero decoder position");
        onMain(()->{player.removeFromQueue(0);player.enqueue(b);});
        check(player.current().id.equals(b.id)&&player.position()==0&&store.savedPosition()==0,"Enqueue into an emptied playing queue starts at zero, not the removed track position");
        onMain(()->player.play());await(()->player.isPlaying(),10000,"The newly enqueued local track plays");
        check(player.position()<3000,"The actual new decoder starts near zero");

        onMain(()->{player.setQueue(java.util.Arrays.asList(a,b,c),0,true);player.next();player.seekTo(11000);player.next();player.seekTo(7000);});
        await(()->player.isPlaying()&&player.current().id.equals(c.id)&&!(Boolean)field(player,"seeking"),10000,"Rapid Next/seek resolves only the final native source");
        check(player.currentIndex()==2&&player.position()>=6500&&player.position()<10000,"Late decoder callbacks preserve the final selected track and seek");
        android.media.AudioManager.OnAudioFocusChangeListener old=(android.media.AudioManager.OnAudioFocusChangeListener)field(player,"focusCallback");
        final float[] applied={0};
        onMain(()->{old.onAudioFocusChange(android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);player.setVolume(.7f);try{Method gain=PlaybackService.class.getDeclaredMethod("outputVolume");gain.setAccessible(true);applied[0]=(Float)gain.invoke(player);}catch(Exception error){throw new RuntimeException(error);}});
        check(Math.abs(applied[0]-.14f)<.001f&&Math.abs(player.volume()-.7f)<.001f,"Changing user volume during a focus duck retains attenuation");
        onMain(()->{player.pause();old.onAudioFocusChange(android.media.AudioManager.AUDIOFOCUS_GAIN);});
        check(!player.isPlaying()&&!(Boolean)field(player,"hasFocus"),"Late focus gain after user Pause cannot reclaim focus or resume audio");
        onMain(()->player.play());await(()->player.isPlaying(),10000,"Playback reacquires a fresh focus request");
        onMain(()->old.onAudioFocusChange(android.media.AudioManager.AUDIOFOCUS_LOSS));
        check(player.isPlaying(),"A stale focus loss from the old request cannot pause the new request");
        android.media.AudioManager.OnAudioFocusChangeListener active=(android.media.AudioManager.OnAudioFocusChangeListener)field(player,"focusCallback");
        onMain(()->active.onAudioFocusChange(android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT));
        check(!player.isPlaying(),"The current transient focus loss still pauses native audio");
        onMain(()->active.onAudioFocusChange(android.media.AudioManager.AUDIOFOCUS_GAIN));
        await(()->player.isPlaying(),10000,"The current focus gain resumes a transiently interrupted source");
        onMain(()->player.pause());

        LibraryStore concurrent=new LibraryStore(getTargetContext());
        Track stream=new Track("audit-stream-"+suffix,"Store concurrency fixture","Test","https://example.invalid/audit.mp3",40000);
        Track local=stream.withUri(uri,40000);store.add(stream);store.saveQueue(java.util.Collections.singletonList(stream),0,4500);store.recordPlayed(stream);
        concurrent.savedQueue(); // Warm its old metadata cache before another instance commits the download.
        store.preferences().edit().putBoolean("audio_audit_setting",true).commit();store.toggleLike(stream.id);
        store.replaceWithOffline(stream,local);
        concurrent.saveQueue(java.util.Collections.singletonList(stream),0,6000);concurrent.recordPlayed(stream);
        check(new JSONArray(store.preferences().getString("queue","[]")).getJSONObject(0).getString("uri").equals(uri)
                &&new JSONArray(store.preferences().getString("history","[]")).getJSONObject(0).getString("uri").equals(uri),
                "A stale second LibraryStore cannot overwrite completed offline queue/history with HTTPS");
        check(concurrent.savedQueue().get(0).uri.equals(uri)&&store.savedPosition()==6000&&store.isLiked(stream.id)&&store.preferences().getBoolean("audio_audit_setting",false),
                "Cross-instance offline metadata invalidation preserves new position, likes and unrelated settings");
        Track interruptedSource=new Track("audit-interrupted-"+suffix,"Interrupted commit fixture","Test","https://example.invalid/interrupted.mp3",40000);
        store.add(interruptedSource);final boolean[] interruptedCommit={false};
        Thread committing=new Thread(()->{
            Thread.currentThread().interrupt();
            try{store.replaceWithOffline(interruptedSource,interruptedSource.withUri(uri,40000));}
            catch(java.io.IOException expected){interruptedCommit[0]=true;}
            finally{Thread.interrupted();}
        });committing.start();committing.join(10000);
        Method references=LibraryStore.class.getDeclaredMethod("referencesUri",String.class);references.setAccessible(true);
        check(!committing.isAlive()&&interruptedCommit[0]&&store.find(interruptedSource.id).uri.equals(uri)
                &&(Boolean)references.invoke(store,uri)&&createdFile.isFile(),
                "Real Android interrupted commit already publishes its offline URI and rollback must retain the referenced file");
        onMain(()->player.setQueue(java.util.Collections.singletonList(stream),0,false));
        Method completion=PlaybackService.class.getDeclaredMethod("offlineSaved",Track.class);completion.setAccessible(true);
        final Throwable[] failure={null};Thread worker=new Thread(()->{try{completion.invoke(null,local);}catch(Throwable error){failure[0]=error;}});worker.start();worker.join(3000);
        if(failure[0]!=null)throw new AssertionError(failure[0]);
        await(()->player.current().uri.equals(uri)&&player.isPrepared(),10000,"Background offline completion updates the live service without an Activity binder");
        check(!player.isPlaying(),"Completing an offline replacement does not autoplay a paused queue");
    }

    private void uiAndAudio() throws Exception {
        int originalCount = store.tracks().size();
        onMain(() -> invoke(activity, "selectTab", new Class<?>[]{String.class}, "search")); search("gno");
        List<Track> initial = results(); check(!initial.isEmpty() && initial.size() <= 20 && store.tracks().size() == originalCount, "Real SoundCloud search renders a native page without importing all results");
        check(browserMonitor.getHits() == 0 && webMonitor.getHits() == 0, "SoundCloud search launches neither browser Intent nor OnlineActivity");
        if (view("search_more") != null) { int count = initial.size(); click(view("search_more")); await(() -> !loading() && results().size() > count, 35000, "Native next-page button appends real results"); check(store.tracks().size() == originalCount, "Pagination keeps the library unchanged"); }
        screenshot("catalog-search");
        final Track another = initial.get(0);
        onMain(()->{((EditText)view("search_query")).setText("gno stale probe");view("search_submit").performClick();((EditText)view("search_query")).setText("https://soundcloud.com/darkprinceee/gnoy");view("search_submit").performClick();});
        await(()->!loading()&&results().size()==1&&results().get(0).id.equals("soundcloud:1930572542"),35000,"Rapid native query replacement only displays the latest full-link result");
        List<Track> exact = results();
        check(exact.size() == 1 && exact.get(0).id.equals("soundcloud:1930572542"), "A full SoundCloud link resolves to its exact native result");
        final Track cached = exact.get(0); click(findDescription(cached.title + ". " + cached.artist));
        await(() -> player.current() != null && player.current().id.equals(cached.id) && player.isPlaying(), 60000, "Real HTTPS audio prepares and plays through native MediaPlayer");
        check(store.find(cached.id) != null && store.tracks().size() == originalCount + (previousId(cached.id) ? 0 : 1), "Selecting a result saves only that stable track");
        long position = player.position(); SystemClock.sleep(1300); check(player.position() > position + 600, "Native online playback position advances");
        onMain(() -> player.seekTo(20000)); await(() -> Math.abs(player.position() - 20000) < 1500, 12000, "Native stream seek applies");
        onMain(() -> player.pause()); long paused = player.position(); SystemClock.sleep(650); check(!player.isPlaying() && Math.abs(player.position() - paused) < 250, "Native stream pause holds its position");
        onMain(() -> player.play()); await(() -> player.isPlaying() && player.position() > paused + 300, 15000, "Native stream resumes from pause");
        shell("input keyevent KEYCODE_HOME"); long background = player.position(); SystemClock.sleep(1500); check(player.isPlaying() && player.position() > background + 700, "SoundCloud continues in the foreground playback service after Home");
        activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        await(() -> field(activity, "player") != null, 10000, "Native activity returns to the same service");
        onMain(() -> invoke(activity, "selectTab", new Class<?>[]{String.class}, "search")); search("gno");
        click(findDescription("Действия: " + another.title)); menu("Добавить в очередь"); await(() -> player.queue().size() == 2, 6000, "Native result menu appends a distinct SoundCloud track");
        check(player.current().id.equals(cached.id) && player.queue().get(1).id.equals(another.id), "Adding a result preserves the currently playing track");
        onMain(() -> invoke(activity, "navigate", new Class<?>[]{String.class}, "player")); click(findDescription("Следующий трек"));
        await(() -> player.current() != null && player.current().id.equals(another.id) && player.isPlaying(), 60000, "Native Next plays the second real SoundCloud track");
        click(findDescription("Предыдущий трек")); await(() -> player.current().id.equals(cached.id) && player.isPlaying(), 20000, "Native Previous returns to the first SoundCloud track");
        View like = findDescription("Добавить в любимые"); if (like != null) click(like);
        check(store.isLiked(cached.id) && store.history().get(0).id.equals(cached.id), "Native SoundCloud likes and played history use the same stable identity");
        screenshot("catalog-player"); click(findDescription("Действия с треком")); menu("Сохранить аудио офлайн");
        await(() -> { Track stored = store.find(cached.id); return stored != null && stored.uri.startsWith("file:") && player.current().uri.equals(stored.uri); }, 90000, "Real audio download atomically replaces the active source with a private file");
        Track offline = store.find(cached.id); createdFile = new File(android.net.Uri.parse(offline.uri).getPath());
        check(createdFile.isFile() && createdFile.length() > 1000 && !offline.sourceUrl.isEmpty() && !offline.coverUrl.isEmpty(), "Offline source keeps canonical attribution and cover metadata");
        Track rediscovered = store.rememberCatalog(cached);
        check(rediscovered.uri.equals(offline.uri) && store.resolveCatalog(cached).uri.equals(offline.uri) && store.isLiked(cached.id), "Rediscovery never overwrites an existing offline URI or its liked identity");
        check(player.queue().get(0).uri.equals(offline.uri) && store.savedQueue().get(0).uri.equals(offline.uri), "Active and persisted queues agree on the offline source");
        wifi = shell("settings get global wifi_on").trim(); data = shell("settings get global mobile_data").trim(); shell("svc wifi disable"); shell("svc data disable");
        android.net.ConnectivityManager connectivity=(android.net.ConnectivityManager)getTargetContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        await(() -> connectivity.getActiveNetwork()==null, 12000, "Emulator has no active network after Wi-Fi and mobile data disable");
        onMain(() -> { List<Track> queue = new ArrayList<>(); queue.add(store.find(cached.id)); player.setQueue(queue, 0, true); });
        await(() -> player.isPlaying() && player.position() > 700, 15000, "Downloaded SoundCloud audio prepares and plays while emulator networking is disabled");
        onMain(() -> invoke(activity, "selectTab", new Class<?>[]{String.class}, "search"));
        onMain(() -> { ((EditText) view("search_query")).setText("gno offline probe"); view("search_submit").performClick(); });
        await(() -> !loading() && !((String) field(activity, "catalogError")).isEmpty() && view("search_retry") != null, 35000, "Network failure stays in native search with a visible Retry");
        check(player.isPlaying() && player.current().uri.startsWith("file:"), "Native search failure leaves offline music playing");
        screenshot("catalog-offline-retry"); restoreNetwork(); await(this::healthy, 35000, "Real public catalog is reachable after restoring emulator networking");
        click(view("search_retry")); await(() -> !loading() && ((String) field(activity, "catalogError")).isEmpty(), 35000, "Native Retry returns to the real catalog");
        check(browserMonitor.getHits() == 0 && webMonitor.getHits() == 0, "Search, links, queue, audio, offline and Retry never launch a SoundCloud browser/WebView");
    }

    private boolean previousId(String id) throws Exception { JSONArray rows = new JSONArray(String.valueOf(backup.get("tracks") == null ? "[]" : backup.get("tracks"))); for (int i=0;i<rows.length();i++) if (rows.getJSONObject(i).optString("id").equals(id)) return true; return false; }
    @SuppressWarnings("unchecked") private List<Track> results() throws Exception { return new ArrayList<>((List<Track>) field(activity, "catalogTracks")); }
    private boolean loading() throws Exception { return (Boolean) field(activity, "catalogLoading"); }
    private void search(String query) throws Exception { onMain(() -> { ((EditText) view("search_query")).setText(query); view("search_soundcloud").performClick(); view("search_submit").performClick(); }); await(() -> !loading() && ((String) field(activity, "catalogError")).isEmpty() && !results().isEmpty(),35000,"Native catalog search: "+query); }
    private View view(String name) { return activity.findViewById(getTargetContext().getResources().getIdentifier(name,"id",getTargetContext().getPackageName())); }
    private View findDescription(String text) { return find(activity.getWindow().getDecorView(),text); }
    private View find(View root,String text) { if(text.contentEquals(root.getContentDescription()==null?"":root.getContentDescription()))return root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View found=find(((ViewGroup)root).getChildAt(i),text);if(found!=null)return found;}return null; }
    private void click(View view) { if(view==null)throw new AssertionError("Native view is missing");onMain(()->view.performClick());waitForIdleSync(); }
    private void menu(String text) throws Exception { await(()->{AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();if(root==null)return false;for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(text)){if(text.contentEquals(node.getText()==null?"":node.getText())){AccessibilityNodeInfo target=node;while(target!=null&&!target.isClickable())target=target.getParent();if(target!=null&&target.performAction(AccessibilityNodeInfo.ACTION_CLICK))return true;}}return false;},5000,"Native menu action: "+text);waitForIdleSync(); }
    private void onMain(Runnable action) { runOnMainSync(action); }
    private static Object field(Object owner,String name)throws Exception{Field field=owner.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(owner);}
    private static Object fieldUnchecked(Object owner,String name){try{return field(owner,name);}catch(Exception error){throw new RuntimeException(error);}}
    private static void invoke(Object owner,String name,Class<?>[] types,Object...args){try{Method method=owner.getClass().getDeclaredMethod(name,types);method.setAccessible(true);method.invoke(owner,args);}catch(Exception error){throw new RuntimeException(error);}}
    private void await(Condition condition,long millis,String label)throws Exception{long deadline=SystemClock.elapsedRealtime()+millis;while(!condition.get()){if(SystemClock.elapsedRealtime()>deadline)throw new AssertionError(label+" timed out"+(player==null?"":"; "+player.error()));SystemClock.sleep(150);}check(true,label);}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);checks.put(label);Bundle status=new Bundle();status.putString("stream","PASS: "+label+"\n");sendStatus(0,status);}
    private String shell(String command)throws Exception{try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);return new String(out.toByteArray(),StandardCharsets.UTF_8);}}
    private void restoreNetwork()throws Exception{if(wifi!=null){shell("svc wifi "+(wifi.equals("1")?"enable":"disable"));wifi=null;}if(data!=null){shell("svc data "+(data.equals("1")?"enable":"disable"));data=null;}}
    private boolean healthy(){HttpsURLConnection connection=null;try{connection=(HttpsURLConnection)new URL("https://lolzcloud.com/music/health").openConnection();connection.setConnectTimeout(2000);connection.setReadTimeout(2000);connection.setInstanceFollowRedirects(false);return connection.getResponseCode()==200;}catch(Exception error){return false;}finally{if(connection!=null)connection.disconnect();}}
    @SuppressWarnings("unchecked") private void restorePreferences(){if(backup==null)return;SharedPreferences.Editor editor=store.preferences().edit().clear();for(Map.Entry<String,?> row:backup.entrySet()){Object value=row.getValue();String key=row.getKey();if(value instanceof String)editor.putString(key,(String)value);else if(value instanceof Boolean)editor.putBoolean(key,(Boolean)value);else if(value instanceof Integer)editor.putInt(key,(Integer)value);else if(value instanceof Long)editor.putLong(key,(Long)value);else if(value instanceof Float)editor.putFloat(key,(Float)value);else if(value instanceof Set)editor.putStringSet(key,new HashSet<>((Set<String>)value));}if(!editor.commit())throw new AssertionError("Original emulator preferences could not be restored");}
    private void screenshot(String name)throws Exception{SystemClock.sleep(700);waitForIdleSync();File directory=new File(getTargetContext().getExternalFilesDir(null),"native-catalog");directory.mkdirs();File file=new File(directory,name+".png");Bitmap image=getUiAutomation().takeScreenshot();if(image==null)throw new AssertionError("Screenshot unavailable");try(FileOutputStream out=new FileOutputStream(file)){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();captures.put(file.getAbsolutePath());}
}
