package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.UriPermission;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import com.lolzcloud.mobile.LibraryStore;
import com.lolzcloud.mobile.LrcParser;
import com.lolzcloud.mobile.MainActivity;
import com.lolzcloud.mobile.PlaybackService;
import com.lolzcloud.mobile.Track;
import com.lolzcloud.mobile.UpdateManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Plain platform instrumentation: real system SAF + native service. No AndroidX or network fixture. */
public final class CoreInstrumentation extends Instrumentation {
    private final JSONArray checks = new JSONArray();
    private Bundle args;
    private MainActivity activity;
    private LibraryStore store;
    private PlaybackService player;
    private interface Condition { boolean evaluate() throws Exception; }

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); args = arguments; start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject();
        int code = Activity.RESULT_OK;
        try {
            String phase = args == null ? "fresh" : args.getString("phase", "fresh");
            report.put("phase", phase);
            if ("updates".equals(phase)) validateUpdates();
            else if ("installer".equals(phase)) { launch(); installer(); }
            else {
                launch();
                if ("restore".equals(phase)) restore();
                else if ("configuration".equals(phase)) configuration();
                else fresh();
            }
            report.put("status", "passed");
        } catch (Throwable error) {
            code = Activity.RESULT_CANCELED;
            try { report.put("status", "failed"); report.put("error", error.toString()); report.put("ui", describeUi()); }
            catch (Exception ignored) { }
        }
        try {
            report.put("checks", checks);
            File reportFile = new File(getTargetContext().getFilesDir(), "android-core-test-" + report.optString("phase", "fresh") + ".json");
            try (FileOutputStream out = new FileOutputStream(reportFile)) { out.write(report.toString(2).getBytes(StandardCharsets.UTF_8)); }
            Bundle result = new Bundle(); result.putString("stream", report.toString(2) + "\n");
            result.putString("status", report.optString("status")); result.putInt("checks", checks.length());
            finish(code, result);
        } catch (Exception writeError) {
            Bundle result = new Bundle(); result.putString("stream", "Could not write test report: " + writeError + "\n"); finish(0, result);
        }
    }

    private void launch() throws Exception {
        Intent launch = new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = (MainActivity) startActivitySync(launch);
        store = new LibraryStore(getTargetContext());
        await(() -> { player = (PlaybackService) field(activity, "player"); return player != null; }, 15_000, "Service binding");
    }

    private void fresh() throws Exception {
        store.setPrivateMode(false);
        for (int i = 0; i < FixtureDocumentsProvider.IDS.length; i++) importWithSystemPicker(i);
        ArrayList<Track> fixtures = fixtures();
        check(fixtures.size() == 4, "SAF imported all four generated MP3 fixtures");
        int grants = 0;
        for (UriPermission permission : getTargetContext().getContentResolver().getPersistedUriPermissions())
            if (FixtureDocumentsProvider.AUTHORITY.equals(permission.getUri().getAuthority()) && permission.isReadPermission()) grants++;
        check(grants >= 4, "SAF read permissions were persisted by the production activity");
        check(fixtures.get(0).title.equals("Ночной маршрут") && fixtures.get(0).artist.equals("LolzCloud · демо"), "Real MP3 metadata imported");
        importLyricsWithSystemPicker(fixtures.get(0));
        check(LrcParser.parse(store.lyrics(fixtures.get(0).id)).size() == 6, "Production SAF callback imports real LRC timestamps");

        onMain(() -> { player.setRepeat(0); player.setShuffle(false); player.setSpeed(1f); player.setPitch(1f); player.setQueue(fixtures, 0, true); });
        await(() -> player.isPlaying() && player.position() > 700, 15_000, "Native MediaPlayer start");
        long initial = player.position(); SystemClock.sleep(1300);
        check(player.position() > initial + 700, "Native playback position advances");
        MediaSession session = (MediaSession) field(player, "session");
        MediaController controller = new MediaController(getTargetContext(), session.getSessionToken());
        check(controller.getPlaybackState().getState() == PlaybackState.STATE_PLAYING, "MediaSession exposes PLAYING for lock-screen transport");
        check("Ночной маршрут".equals(controller.getMetadata().getString(MediaMetadata.METADATA_KEY_TITLE)), "MediaSession contains current title");

        controller.getTransportControls().seekTo(10_000);
        await(() -> player.position() >= 9_800 && player.position() < 13_000, 5000, "MediaSession seek");
        check(true, "Seek through MediaSession reaches requested position");
        controller.getTransportControls().pause();
        await(() -> !player.isPlaying(), 3000, "MediaSession pause");
        long paused = player.position(); SystemClock.sleep(700);
        check(Math.abs(player.position() - paused) < 150, "Paused position remains stable");
        controller.getTransportControls().play();
        await(() -> player.isPlaying(), 3000, "MediaSession play");
        check(true, "Pause resumes through MediaSession");

        long beforeHome = player.position();
        try (ParcelFileDescriptor ignored = getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME")) { }
        SystemClock.sleep(1800);
        check(player.isPlaying() && player.position() > beforeHome + 900, "Playback continues while the activity is in the background");
        getTargetContext().startActivity(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        waitForIdleSync(); SystemClock.sleep(500);

        controller.getTransportControls().skipToNext();
        await(() -> player.current() != null && player.current().id.equals(fixtures.get(1).id) && player.isPlaying(), 5000, "Queue next");
        check(true, "Next advances to the second queued file");
        onMain(() -> player.seekTo(0));
        controller.getTransportControls().skipToPrevious();
        await(() -> player.current() != null && player.current().id.equals(fixtures.get(0).id) && player.isPlaying(), 5000, "Queue previous");
        check(true, "Previous returns to the actual queued file");

        onMain(() -> { player.setQueue(fixtures, 2, false); });
        await(() -> player.isPrepared(), 5000, "Prepare paused track");
        onMain(() -> player.play());
        await(() -> player.isPlaying(), 3000, "Play previously prepared track");
        check(!store.history().isEmpty() && store.history().get(0).id.equals(fixtures.get(2).id), "Starting a prepared paused file records real history");

        store.setPrivateMode(true);
        String historyBefore = new LibraryStore(getTargetContext()).history().get(0).id;
        onMain(() -> player.playIndex(3));
        await(() -> player.isPlaying() && player.current().id.equals(fixtures.get(3).id), 5000, "Private playback");
        check(store.history().get(0).id.equals(historyBefore), "Private listening does not update history");
        if (!store.isLiked(fixtures.get(0).id)) store.toggleLike(fixtures.get(0).id);
        JSONObject profile = new JSONObject(store.exportProfile());
        profile.put("speed", 1.25); profile.put("bass", 250); profile.put("repeat", 1);
        int restored = store.importProfile(profile.toString());
        onMain(() -> player.reloadSettings());
        check(restored >= 1 && Math.abs(player.speed() - 1.25f) < .01f && player.repeat() == 1, "Imported sound settings reach the live service");
        check(store.privateMode() && new LibraryStore(getTargetContext()).isLiked(fixtures.get(0).id), "Privacy and liked files survive profile import and store recreation");
        check(store.preferences().contains("profile_backup"), "Profile import saves the previous portable profile");
        String before = store.exportProfile();
        JSONObject invalid = new JSONObject(profile.toString());
        invalid.getJSONArray("liked").getJSONObject(0).put("uri", "file:///data/local/tmp/unsafe.mp3");
        boolean rejected = false;
        try { store.importProfile(invalid.toString()); } catch (IOException expected) { rejected = true; }
        check(rejected && before.equals(store.exportProfile()), "Invalid file URI profile is rejected without changing the portable profile");

        onMain(() -> { player.setSpeed(1f); player.setPitch(1f); player.setRepeat(0); player.setShuffle(false); player.setQueue(fixtures, 0, false); });
        await(() -> player.isPrepared(), 5000, "Prepare persistence state");
        onMain(() -> player.seekTo(8000));
        await(() -> Math.abs(player.position() - 8000) < 200, 3000, "Paused seek persistence");
        SystemClock.sleep(500);
        check(Math.abs(store.savedPosition() - 8000) < 200, "Paused seek is persisted at the requested position");
        store.preferences().edit().putString("instrumentation_expected_track", fixtures.get(0).id).putLong("instrumentation_expected_position", 8000).commit();
        check(true, "Ready for force-stop + second instrumentation restore phase");
    }

    private void restore() throws Exception {
        String expected = store.preferences().getString("instrumentation_expected_track", "");
        long position = store.preferences().getLong("instrumentation_expected_position", -1);
        check(!expected.isEmpty() && position >= 0, "Previous instrumentation phase saved an expected state");
        check(player.current() != null && expected.equals(player.current().id), "Queue and current track survive process restart");
        check(!player.isPlaying() && Math.abs(player.position() - position) < 200, "Process restart restores position without autoplay");
        check(store.privateMode() && store.isLiked(expected), "Private setting and likes survive process restart");
        onMain(() -> player.play());
        await(() -> player.isPlaying() && player.position() > position + 500, 10_000, "Restored native playback");
        check(true, "Persisted SAF permission still permits playback after process restart");
        onMain(() -> { player.pause(); player.setSpeed(1f); player.setPitch(1f); player.setRepeat(0); player.seekTo(8000); });
        store.setPrivateMode(false);
    }

    private void validateUpdates() throws Exception {
        JSONObject fixtures = updateFixtures();
        requireBaseline(fixtures);
        UpdateManager updater = new UpdateManager(getTargetContext(), new UpdateManager.Listener() {
            @Override public void onStatus(String value) { }
            @Override public void onAvailable(String version, String url) { }
        });
        Method validate = UpdateManager.class.getDeclaredMethod("validateApk", File.class);
        validate.setAccessible(true);
        try {
            File current = copyAsset("updates/current.apk", "test-current.apk");
            File next = copyAsset("updates/next.apk", "test-next.apk");
            File wrongSigner = copyAsset("updates/wrong-signer.apk", "test-wrong-signer.apk");
            requireFixture(current, fixtures.getJSONObject("current"));
            requireFixture(next, fixtures.getJSONObject("next"));
            requireFixture(wrongSigner, fixtures.getJSONObject("wrongSigner"));
            boolean rejectedCurrent = false;
            try { validate.invoke(updater, current); }
            catch (InvocationTargetException error) { rejectedCurrent = error.getCause() instanceof IOException && error.getCause().getMessage().contains("такая же"); }
            check(rejectedCurrent, "Updater rejects reinstalling the current APK version");
            validate.invoke(updater, next);
            check(true, "Updater accepts a newer same-package APK with the installed signing certificate");
            boolean rejectedSignature = false;
            try { validate.invoke(updater, wrongSigner); }
            catch (InvocationTargetException error) { rejectedSignature = error.getCause() instanceof IOException && error.getCause().getMessage().contains("Подпись"); }
            check(rejectedSignature, "Updater rejects a newer APK signed by a different certificate");
            File malformed = new File(getTargetContext().getCacheDir(), "test-malformed.apk");
            try (FileOutputStream out = new FileOutputStream(malformed)) { out.write("This is not an APK".getBytes(StandardCharsets.UTF_8)); }
            boolean rejectedMalformed = false;
            try { validate.invoke(updater, malformed); }
            catch (InvocationTargetException error) { rejectedMalformed = error.getCause() instanceof IOException; }
            check(rejectedMalformed, "Updater rejects a malformed non-APK file");
            current.delete(); next.delete(); wrongSigner.delete(); malformed.delete();
        } finally { updater.dispose(); }
    }

    private JSONObject updateFixtures() throws Exception {
        try (InputStream input = getContext().getAssets().open("updates/metadata.json");
             java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > 32768) throw new IOException("Updater fixture metadata too large"); bytes.write(buffer, 0, count); }
            JSONObject fixtures = new JSONObject(bytes.toString("UTF-8"));
            if (fixtures.optInt("schemaVersion") != 1 || !fixtures.optBoolean("fixtureOnly") || !fixtures.optBoolean("neverInstallNewerApk"))
                throw new IOException("Updater fixtures are missing their test-only contract");
            return fixtures;
        }
    }

    private static long versionCode(PackageInfo info) { return android.os.Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }

    private void requireBaseline(JSONObject fixtures) throws Exception {
        JSONObject baseline = fixtures.getJSONObject("current");
        PackageInfo installed = getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(), 0);
        check(installed.packageName.equals(baseline.getString("packageName")) && installed.versionName.equals(baseline.getString("versionName"))
                && versionCode(installed) == baseline.getLong("versionCode"), "Installed application matches the current updater fixture baseline");
        check(fixtures.getJSONObject("next").getLong("versionCode") > versionCode(installed), "The future fixture has a greater versionCode and is never installed");
    }

    private void requireFixture(File file, JSONObject expected) throws Exception {
        PackageInfo info = getTargetContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
        java.security.MessageDigest hash = java.security.MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) { byte[] bytes = new byte[32768]; int count; while ((count = input.read(bytes)) != -1) hash.update(bytes, 0, count); }
        StringBuilder digest = new StringBuilder(); for (byte value : hash.digest()) digest.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        check(info != null && info.packageName.equals(expected.getString("packageName")) && info.versionName.equals(expected.getString("versionName"))
                && versionCode(info) == expected.getLong("versionCode") && file.length() == expected.getLong("size") && digest.toString().equals(expected.getString("sha256")),
                "Bundled updater fixture matches its declared package, version, size and checksum: " + file.getName());
    }

    private void configuration() throws Exception {
        ArrayList<Track> testTracks = fixtures();
        check(!testTracks.isEmpty(), "Real SAF fixture is available for configuration testing");
        Track track = testTracks.get(0);
        String currentId = player.current() == null ? "" : player.current().id;
        String queueBefore = queueIdentity(player.queue());
        store.saveLyrics(track.id, "");
        check(store.lyrics(track.id).isEmpty(), "Previous fixture lyrics were cleared to prevent a false positive");
        MainActivity oldActivity = activity;
        final MainActivity[] replacement = new MainActivity[1];
        Application application = (Application) getTargetContext().getApplicationContext();
        Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity value, Bundle state) {
                if (value instanceof MainActivity && value != oldActivity) replacement[0] = (MainActivity) value;
            }
            @Override public void onActivityStarted(Activity value) { }
            @Override public void onActivityResumed(Activity value) { }
            @Override public void onActivityPaused(Activity value) { }
            @Override public void onActivityStopped(Activity value) { }
            @Override public void onActivitySaveInstanceState(Activity value, Bundle state) { }
            @Override public void onActivityDestroyed(Activity value) { }
        };
        application.registerActivityLifecycleCallbacks(lifecycle);
        try {
            Method importMethod = MainActivity.class.getDeclaredMethod("importLyrics", String.class); importMethod.setAccessible(true);
            runOnMainSync(() -> { try { importMethod.invoke(oldActivity, track.id); } catch (Exception error) { throw new RuntimeException(error); } });
            await(this::pickerHasFocus, 8000, "System picker before recreation");
            check(true, "System SAF picker is open before recreating the production activity");
            runOnMainSync(oldActivity::recreate);
            await(() -> replacement[0] != null, 8000, "Actual MainActivity recreation while picker is open");
            activity = replacement[0];
            await(() -> { player = (PlaybackService) field(activity, "player"); return player != null; }, 5000, "Recreated activity service binding");
            check(activity != oldActivity && pickerHasFocus(), "A new MainActivity instance binds while the real system picker stays open");
            if (!clickText("Ночной маршрут.lrc", 2000)) {
                if (!clickDescription(new String[]{"Show roots", "Open navigation drawer", "Показать корневые папки", "Открыть меню навигации"}, 3000)
                        || !clickText("LolzCloud fixtures", 5000) || !clickText("Ночной маршрут.lrc", 5000))
                    throw new AssertionError("LRC fixture is not selectable after recreation");
            }
            await(() -> LrcParser.parse(store.lyrics(track.id)).size() == 6, 8000, "LRC result delivered to recreated activity");
            await(this::targetHasFocus, 5000, "Return to recreated activity");
            check(true, "Actual SAF result stores the selected LRC for the original fixture track after recreation");
            check(currentId.equals(player.current() == null ? "" : player.current().id)
                    && queueBefore.equals(queueIdentity(player.queue())), "Queue and current track remain unchanged during picker recreation");
        } finally { application.unregisterActivityLifecycleCallbacks(lifecycle); }
    }

    private boolean pickerHasFocus() {
        AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
        return root != null && "com.android.documentsui".contentEquals(root.getPackageName());
    }
    private String queueIdentity(List<Track> tracks) {
        StringBuilder value = new StringBuilder();
        for (Track track : tracks) value.append(track.id).append('\n');
        return value.toString();
    }

    /** Real Package Installer integration; the newer fixture is inspected and always cancelled. */
    private void installer() throws Exception {
        check("1".equals(shell("getprop ro.kernel.qemu").trim()), "Installer phase runs only on an emulator");
        final Context target = getTargetContext();
        final JSONObject fixtures = updateFixtures();
        final JSONObject baseline = fixtures.getJSONObject("current");
        requireBaseline(fixtures);
        validateUpdates();
        int librarySize = store.tracks().size();
        String theme = store.preferences().getString("theme", "forest");
        File directory = new File(target.getCacheDir(), "verified-update");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create update fixture cache");
        final File apk = copyAsset("updates/next.apk", "verified-update/LolzCloud-Android-update.apk");
        requireFixture(apk, fixtures.getJSONObject("next"));
        final Uri updateUri = Uri.parse("content://" + target.getPackageName() + ".updates/LolzCloud-Android-update.apk");
        final UpdateManager updater = (UpdateManager) field(activity, "updater");
        Method validate = UpdateManager.class.getDeclaredMethod("validateApk", File.class); validate.setAccessible(true);
        final Method request = UpdateManager.class.getDeclaredMethod("requestInstallation", File.class); request.setAccessible(true);
        try {
            shell("appops set com.lolzcloud.mobile REQUEST_INSTALL_PACKAGES deny");
            check(!target.getPackageManager().canRequestPackageInstalls(), "Unknown-source installation is initially denied");
            validate.invoke(updater, apk);
            check(true, "The newer same-certificate fixture passes package, version and signature validation");
            try (ParcelFileDescriptor file = target.getContentResolver().openFileDescriptor(updateUri, "r")) {
                check(file != null && file.getStatSize() == apk.length(), "Read-only update provider exposes the exact verified APK");
            }
            boolean wrongPathDenied = false;
            try (ParcelFileDescriptor ignored = target.getContentResolver().openFileDescriptor(
                    Uri.parse("content://" + target.getPackageName() + ".updates/not-an-update.apk"), "r")) { }
            catch (Exception expected) { wrongPathDenied = true; }
            check(wrongPathDenied, "Update provider rejects an unrelated cache path");
            boolean writeDenied = false;
            try (ParcelFileDescriptor ignored = target.getContentResolver().openFileDescriptor(updateUri, "w")) { }
            catch (Exception expected) { writeDenied = true; }
            check(writeDenied, "Update provider rejects write access");

            onMain(() -> {
                try { request.invoke(updater, apk); }
                catch (Exception error) { throw new RuntimeException(error); }
            });
            await(() -> activePackage().equals("com.android.settings"), 10_000, "Unknown-source permission settings");
            check(target.getSharedPreferences("android-update", Context.MODE_PRIVATE).getBoolean("awaiting-source-permission", false),
                    "Opening unknown-source settings persists the pending verified update");
            check(describeUi().contains("LolzCloud"), "System unknown-source settings identifies LolzCloud");
            // The shell app-op belongs only to this emulator's test app; no physical device is touched.
            shell("appops set com.lolzcloud.mobile REQUEST_INSTALL_PACKAGES allow");
            await(() -> target.getPackageManager().canRequestPackageInstalls(), 5000, "Grant emulator install source permission");
            check(true, "Emulator grants the install-source permission");
            shell("input keyevent KEYCODE_BACK");
            // Production MainActivity.onResume also calls this method. Its pending/busy guards prevent a duplicate prompt.
            onMain(updater::resumePendingInstall);
            await(() -> activePackage().contains("packageinstaller") && describeUi().contains("LolzCloud"), 15_000, "Real Android Package Installer update dialog");
            String installerUi = describeUi();
            check(installerUi.contains("Update") || installerUi.contains("UPDATE") || installerUi.contains("Обновить"),
                    "System Package Installer parsed the provider APK and offers a LolzCloud update");
            JSONObject evidence = new JSONObject();
            evidence.put("name", "System installer UI evidence"); evidence.put("passed", true);
            evidence.put("package", activePackage()); evidence.put("ui", installerUi); checks.put(evidence);
            check(!target.getSharedPreferences("android-update", Context.MODE_PRIVATE).getBoolean("awaiting-source-permission", false),
                    "Resuming installation clears the pending permission state");
            if (!clickNode(new String[] { "Cancel", "CANCEL", "Отмена", "ОТМЕНА" }, false, 5000)) shell("input keyevent KEYCODE_BACK");
            await(() -> !activePackage().contains("packageinstaller"), 10_000, "Cancel system update dialog");
            PackageInfo after = target.getPackageManager().getPackageInfo(target.getPackageName(), 0);
            check(after.versionName.equals(baseline.getString("versionName")) && versionCode(after) == baseline.getLong("versionCode"),
                    "Cancelling leaves the current baseline version and versionCode installed");
            check(store.tracks().size() == librarySize && theme.equals(store.preferences().getString("theme", "forest")),
                    "Cancelling update preserves library and theme preferences");
        } finally {
            if (activePackage().contains("packageinstaller")) shell("input keyevent KEYCODE_BACK");
            target.getSharedPreferences("android-update", Context.MODE_PRIVATE).edit().remove("awaiting-source-permission").commit();
            target.revokeUriPermission(updateUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            apk.delete();
            // Revoking this app-op can kill the instrumented target process. The outer
            // emulator-only runner restores deny after it receives this report.
        }
    }

    private String activePackage() {
        AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
        return root == null || root.getPackageName() == null ? "" : root.getPackageName().toString();
    }

    private String shell(String command) throws IOException {
        try (ParcelFileDescriptor descriptor = getUiAutomation().executeShellCommand(command);
                InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }

    private File copyAsset(String asset, String name) throws IOException {
        File file = new File(getTargetContext().getCacheDir(), name);
        try (InputStream in = getContext().getAssets().open(asset); FileOutputStream out = new FileOutputStream(file)) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
        }
        return file;
    }

    private void importWithSystemPicker(int fixture) throws Exception {
        await(this::targetHasFocus, 10_000, "Return to target before importing audio");
        Method importMethod = MainActivity.class.getDeclaredMethod("importAudio"); importMethod.setAccessible(true);
        runOnMainSync(() -> { try { importMethod.invoke(activity); } catch (Exception error) { throw new RuntimeException(error); } });
        SystemClock.sleep(800);
        String filename = FixtureDocumentsProvider.TITLES[fixture] + ".mp3";
        if (!clickText(filename, 1500)) {
            if (!clickDescription(new String[]{"Show roots", "Open navigation drawer", "Показать корневые папки", "Открыть меню навигации"}, 3000))
                throw new AssertionError("System document picker root menu not found: " + describeUi());
            if (!clickText("LolzCloud fixtures", 5000)) throw new AssertionError("Fixture provider not listed in real SAF");
            if (!clickText(filename, 5000)) throw new AssertionError("Fixture document not listed: " + filename);
        }
        String id = FixtureDocumentsProvider.IDS[fixture];
        await(() -> {
            for (Track track : store.tracks()) if (track.uri.endsWith("/document/" + id)) return true;
            return false;
        }, 10_000, "Production SAF import callback " + id);
        await(this::targetHasFocus, 10_000, "Return from audio SAF picker");
        waitForIdleSync();
    }

    private ArrayList<Track> fixtures() {
        ArrayList<Track> tracks = new ArrayList<>();
        for (String id : FixtureDocumentsProvider.IDS) for (Track track : store.tracks())
            if (track.uri.equals("content://" + FixtureDocumentsProvider.AUTHORITY + "/document/" + id)) tracks.add(track);
        return tracks;
    }
    private void importLyricsWithSystemPicker(Track track) throws Exception {
        await(this::targetHasFocus, 10_000, "Return to target before importing lyrics");
        Method importMethod = MainActivity.class.getDeclaredMethod("importLyrics", String.class); importMethod.setAccessible(true);
        runOnMainSync(() -> { try { importMethod.invoke(activity, track.id); } catch (Exception error) { throw new RuntimeException(error); } });
        SystemClock.sleep(800);
        if (!clickText("Ночной маршрут.lrc", 2000)) {
            if (!clickDescription(new String[]{"Show roots", "Open navigation drawer", "Показать корневые папки", "Открыть меню навигации"}, 3000)
                    || !clickText("LolzCloud fixtures", 5000) || !clickText("Ночной маршрут.lrc", 5000))
                throw new AssertionError("LRC fixture was not available in system SAF");
        }
        await(() -> !store.lyrics(track.id).isEmpty(), 5000, "Production LRC import callback");
        await(this::targetHasFocus, 10_000, "Return from LRC SAF picker");
        waitForIdleSync();
    }
    private boolean targetHasFocus() {
        AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
        return root != null && "com.lolzcloud.mobile".contentEquals(root.getPackageName()) && activity.hasWindowFocus();
    }
    private void check(boolean condition, String name) throws Exception {
        JSONObject check = new JSONObject(); check.put("name", name); check.put("passed", condition); checks.put(check);
        if (!condition) throw new AssertionError(name);
    }
    private void await(Condition condition, long timeout, String name) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeout;
        do { if (condition.evaluate()) return; SystemClock.sleep(100); } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Timed out: " + name);
    }
    private void onMain(Runnable action) { runOnMainSync(action); }
    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(target);
    }
    private boolean clickText(String label, long timeout) {
        return clickNode(new String[]{label}, false, timeout);
    }
    private boolean clickDescription(String[] labels, long timeout) { return clickNode(labels, true, timeout); }
    private boolean clickNode(String[] labels, boolean description, long timeout) {
        long deadline = SystemClock.elapsedRealtime() + timeout;
        do {
            AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
            AccessibilityNodeInfo found = findNode(root, labels, description);
            if (found != null) {
                while (found != null) {
                    if (found.isEnabled() && found.isClickable() && found.performAction(AccessibilityNodeInfo.ACTION_CLICK)) { SystemClock.sleep(350); return true; }
                    found = found.getParent();
                }
            }
            SystemClock.sleep(150);
        } while (SystemClock.elapsedRealtime() < deadline);
        return false;
    }
    private AccessibilityNodeInfo findNode(AccessibilityNodeInfo node, String[] labels, boolean description) {
        if (node == null) return null;
        CharSequence value = description ? node.getContentDescription() : node.getText();
        if (value != null) for (String label : labels) if (label.contentEquals(value)) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = findNode(node.getChild(i), labels, description); if (found != null) return found;
        }
        return null;
    }
    private String describeUi() {
        StringBuilder out = new StringBuilder(); describe(getUiAutomation().getRootInActiveWindow(), out, 0); return out.toString();
    }
    private void describe(AccessibilityNodeInfo node, StringBuilder out, int level) {
        if (node == null || level > 10 || out.length() > 16000) return;
        out.append(node.getClassName()).append(" text=").append(node.getText()).append(" desc=").append(node.getContentDescription()).append('\n');
        for (int i = 0; i < node.getChildCount(); i++) describe(node.getChild(i), out, level + 1);
    }
}
