package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import com.lolzcloud.mobile.LibraryStore;
import com.lolzcloud.mobile.MainActivity;
import com.lolzcloud.mobile.PlaybackService;
import com.lolzcloud.mobile.Track;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Real MediaPlayer/SharedPreferences/activity lifecycle with generated silent WAVs. */
public final class AudioComfortInstrumentation extends Instrumentation {
    private final JSONArray checks = new JSONArray(), screenshots = new JSONArray();
    private final JSONObject capabilities = new JSONObject();
    private MainActivity activity;
    private PlaybackService player;
    private LibraryStore store;
    private File directory, reportDirectory;
    private Bundle arguments;
    private interface Task { void run() throws Exception; }
    private interface Condition { boolean ready() throws Exception; }
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments = args; start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject(); Map<String, Object> original = null; boolean preferencesRestored = false; int result = Activity.RESULT_OK;
        try {
            if (!"1".equals(shell("getprop ro.kernel.qemu").trim())) throw new AssertionError("Only the task emulator is allowed");
            reportDirectory = new File(getTargetContext().getExternalFilesDir(null), "audio-comfort-review"); reportDirectory.mkdirs();
            store = new LibraryStore(getTargetContext()); original = snapshot(store.preferences());
            store.preferences().edit().clear().putBoolean("notification_permission_asked", true).commit();
            launch();
            onMain(() -> {
                store.preferences().edit().putInt("eq_0", 700).putInt("eq_19", -400).putBoolean("eq_enabled", true).putInt("loudness", 700).commit();
                player.setSleepMinutes(15); player.setVolume(.37f); player.setPitch(1.2f);
                check(player.resetEffects(), "Reset without an audio session confirms the saved neutral state");
            });
            check(!store.preferences().contains("eq_0") && !store.preferences().contains("eq_19") && !store.preferences().getBoolean("eq_enabled", true), "Reset clears every persisted device band, not only the current zero-band engine");
            check(store.preferences().getInt("loudness", -1) == 0 && player.pitch() == 1 && player.speed() == 1, "Reset includes loudness, speed and pitch");
            check(Math.abs(player.volume() - .37f) < .001 && player.sleepRemainingMillis() > 14 * 60000 && player.queue().isEmpty(), "Reset preserves volume, sleep and the queue");

            directory = new File(getTargetContext().getCacheDir(), "audio-comfort-" + System.nanoTime()); directory.mkdirs();
            List<Track> tracks = new ArrayList<>();
            for (String name : new String[]{"A", "B", "C"}) { File file = new File(directory, name + ".wav"); wave(file); Track track = new Track("comfort-" + name, "Moment " + name, "Generated audio QA", android.net.Uri.fromFile(file).toString(), 30000); store.add(track); tracks.add(track); }
            onMain(() -> { player.setRepeat(0); player.setShuffle(false); player.setQueue(tracks, 0, false); });
            await(() -> player.isPrepared(), 7000, "Initial paused WAV did not prepare");
            // isPrepared is set before the main-thread callback creates AudioEffects.
            // Read native capabilities only after that entire callback has returned.
            onMain(() -> { });
            check(!player.isPlaying(), "Real WAV prepares without autoplay");
            Equalizer eq = (Equalizer) field(player, "equalizer");
            capabilities.put("eqAvailable", player.eqAvailable()).put("eqBandCount", player.eqBandCount()).put("bassAvailable", player.bassAvailable()).put("bassStrengthSupported", player.bassStrengthSupported()).put("reverbAvailable", player.reverbAvailable());
            if (player.eqAvailable()) {
                check(!eq.getEnabled(), "A newly prepared session respects the persisted EQ bypass after reset");
                short[] range = player.eqRange(); short gain = (short) Math.max(range[0], Math.min(range[1], 600));
                onMain(() -> check(player.setEqBand(0, gain), "Native EQ accepts a bounded live-band command"));
                capabilities.put("eqFirstHz", player.eqCenterHz(0)).put("eqAppliedMillibels", player.eqBandLevel(0));
                check(player.eqBandLevel(0) == eq.getBandLevel((short) 0), "Public EQ level is the native device readback");
            } else check(!player.eqAvailable(), "Unavailable native EQ is reported as unavailable");
            if (player.bassAvailable()) {
                onMain(() -> check(player.setBass(333), "Available native bass accepts a request"));
                BassBoost bass = (BassBoost) field(player, "bassBoost");
                check(player.bass() == (bass.getEnabled() ? bass.getRoundedStrength() : 0), "Bass UI state reads actual rounded hardware gain rather than stored request 333");
                capabilities.put("bassActualStrength", player.bass()).put("bassNativeStrengthSupported", bass.getStrengthSupported());
            } else check(!player.bassAvailable(), "Unavailable native bass has no editable fake strength");
            onMain(() -> player.resetEffects());
            if (eq != null && eq.hasControl()) check(!eq.getEnabled(), "Live reset actually bypasses the native EQ");
            check(!player.isPlaying(), "Applying and resetting effects preserves real MediaPlayer pause");
            navigate("sound"); capture("audio-effects.png");

            onMain(() -> player.openBookmark(tracks.get(0), 6000));
            await(() -> Math.abs(player.position() - 6000) < 450, 4000, "Current bookmark did not seek");
            check(!player.isPlaying() && ids(player.queue()).equals(Arrays.asList("comfort-A", "comfort-B", "comfort-C")), "Current-track moment preserves pause and the complete queue");
            onMain(() -> player.openBookmark(tracks.get(1), 9000));
            await(() -> player.isPrepared() && player.current().id.equals("comfort-B") && Math.abs(player.position() - 9000) < 450, 5000, "Queued bookmark did not select and seek");
            check(player.currentIndex() == 1 && !player.isPlaying() && player.queue().size() == 3, "A queued moment selects its existing occurrence without replacing entries or starting audio");
            onMain(() -> player.setQueue(Arrays.asList(tracks.get(0), tracks.get(2)), 0, false)); await(() -> player.isPrepared(), 5000, "Append setup failed");
            final boolean[] appended = new boolean[1]; onMain(() -> appended[0] = player.openBookmark(tracks.get(1), 7000));
            await(() -> player.isPrepared() && player.current().id.equals("comfort-B") && Math.abs(player.position() - 7000) < 450, 5000, "Missing queued track did not append and seek");
            check(appended[0] && ids(player.queue()).equals(Arrays.asList("comfort-A", "comfort-C", "comfort-B")) && !player.isPlaying(), "An absent track appends at the end and preserves the remaining queue and pause");

            onMain(() -> player.setQueue(tracks, 0, false)); await(() -> player.isPrepared(), 5000, "Rapid-next setup failed");
            store.addBookmark("comfort-B", 12000); navigate("bookmarks"); capture("bookmarks.png");
            onMain(() -> { View row = find(activity.getWindow().getDecorView(), "Moment B."); if (row == null) throw new AssertionError("Production bookmark row missing"); row.performClick(); player.next(); });
            await(() -> player.isPrepared() && player.current().id.equals("comfort-C") && player.isPlaying(), 5000, "Next after real bookmark click failed");
            SystemClock.sleep(350);
            check(player.position() < 1800 && player.queue().size() == 3, "A real bookmark click followed immediately by Next cannot apply the old 12s seek to the next prepared WAV");
            long before = player.position(); SystemClock.sleep(500); check(player.position() > before + 250, "Generated WAV playback advances the real MediaPlayer clock");
            onMain(() -> { player.pause(); player.setSleepMinutes(15); });
            long deadline = store.preferences().getLong("sleep_deadline", 0); PlaybackService prior = player;
            stopActivity(); launch();
            check(player != prior && player.sleepRemainingMillis() > 14 * 60000 && store.preferences().getLong("sleep_deadline", 0) == deadline, "A genuinely recreated Service restores the bounded saved sleep deadline");
            check(!player.isPlaying() && !player.isLoading(), "Service restoration never autoplays the saved queue");
            stopActivity(); store.preferences().edit().putLong("sleep_deadline", System.currentTimeMillis() - 1).commit(); launch();
            check(player.sleepRemainingMillis() == 0 && store.preferences().getLong("sleep_deadline", -1) == 0 && !player.isPlaying(), "Expired saved sleep clears on Service recreation without autoplay");
            stopActivity(); store.preferences().edit().putLong("sleep_deadline", System.currentTimeMillis() + 12000).commit(); launch();
            onMain(() -> player.setQueue(tracks, 0, true)); await(() -> player.isPlaying(), 5000, "Short timer WAV did not start");
            await(() -> !player.isPlaying() && player.sleepRemainingMillis() == 0, 14000, "Saved timer did not pause real MediaPlayer on expiry");
            check(store.preferences().getLong("sleep_deadline", -1) == 0 && player.current().id.equals("comfort-A"), "Actual expiry pauses the current recording and clears its durable deadline");

            check(!store.addBookmark("comfort-B", 12200), "Near-duplicate bookmark storage does not add another row");
            JSONArray legacy = new JSONArray(); for (int i = 0; i < 101; i++) legacy.put(i * 1000L);
            store.preferences().edit().putString("bookmarks_legacy", legacy.toString()).commit();
            check(store.bookmarks("legacy").size() == 101, "Older larger bookmark arrays remain readable without destructive migration");
            boolean bounded = false; try { store.addBookmark("legacy", 200000); } catch (java.io.IOException expected) { bounded = true; }
            check(bounded && store.bookmarks("legacy").size() == 101, "New bookmark additions are bounded while preserving legacy records");
            store.removeBookmark("legacy", 1000); check(store.bookmarks("legacy").size() == 100 && !store.bookmarks("legacy").contains(1000L), "A saved moment can be removed without clearing its track or other moments");
            report.put("status", "passed");
        } catch (Throwable failure) { result = Activity.RESULT_CANCELED; try { report.put("status", "failed").put("error", failure.toString()); } catch (Exception ignored) { } }
        finally {
            try { stopActivity(); } catch (Exception failure) { result = Activity.RESULT_CANCELED; try { report.put("status", "failed").put("stopError", failure.toString()); } catch (Exception ignored) { } }
            if (original != null) try { restore(store.preferences(), original); preferencesRestored = true; } catch (Exception failure) { result = Activity.RESULT_CANCELED; try { report.put("status", "failed").put("cleanupError", failure.toString()); } catch (Exception ignored) { } }
            if (directory != null) try { if (directory.getCanonicalFile().getParentFile().equals(getTargetContext().getCacheDir().getCanonicalFile()) && directory.getName().startsWith("audio-comfort-")) { File[] files = directory.listFiles(); if (files != null) for (File file : files) file.delete(); directory.delete(); } } catch (Exception ignored) { }
        }
        try {
            PackageInfo installed = getTargetContext().getPackageManager().getPackageInfo("com.lolzcloud.mobile", 0);
            report.put("runId", arguments == null ? "" : arguments.getString("runId", "")).put("checks", checks).put("screenshots", screenshots).put("deviceCapabilities", capabilities).put("version", installed.versionName).put("versionCode", installed.versionCode).put("apkSha256", sha(new File(installed.applicationInfo.sourceDir))).put("androidApi", android.os.Build.VERSION.SDK_INT);
            report.put("scope", "Actual native MediaPlayer/AudioEffect readback/SharedPreferences/MainActivity and genuine Service recreation using generated 30s silent WAV files. Pure host driver tests cover fixed/rounded/failed hardware variants separately. No physical acoustic response, WebView-room timer, process-kill test or personal account is claimed.");
            report.put("preferencesRestored", preferencesRestored).put("personalAccountsUsed", false);
            if (reportDirectory == null) reportDirectory = new File(getTargetContext().getExternalFilesDir(null), "audio-comfort-review"); reportDirectory.mkdirs();
            try (FileOutputStream out = new FileOutputStream(new File(reportDirectory, "android-audio-comfort-test.json"))) { out.write(report.toString(2).getBytes(StandardCharsets.UTF_8)); }
            Bundle out = new Bundle(); out.putString("stream", report.toString(2) + "\n"); finish(result, out);
        } catch (Exception failure) { Bundle out = new Bundle(); out.putString("stream", failure.toString()); finish(Activity.RESULT_CANCELED, out); }
    }
    private void launch() throws Exception {
        activity = (MainActivity) startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        await(() -> { Object value = field(activity, "player"); if (value == null) return false; player = (PlaybackService) value; return true; }, 6000, "Activity did not bind the production service");
    }
    private void stopActivity() throws Exception {
        MainActivity previous = activity; PlaybackService previousPlayer = player;
        if (previous == null) return;
        onMain(() -> { if (previousPlayer != null) previousPlayer.stopPlayback(); previous.finish(); });
        await(() -> previous.isDestroyed() && (previousPlayer == null || (Boolean) field(previousPlayer, "destroyed")), 6000, "Service did not finish before state restoration"); waitForIdleSync(); activity = null; player = null;
    }
    private void navigate(String page) throws Exception { onMain(() -> { Method method = MainActivity.class.getDeclaredMethod("navigate", String.class); method.setAccessible(true); method.invoke(activity, page); }); waitForIdleSync(); }
    private void capture(String name) throws Exception { SystemClock.sleep(350); Bitmap image = getUiAutomation().takeScreenshot(); if (image != null) { try (FileOutputStream out = new FileOutputStream(new File(reportDirectory, name))) { image.compress(Bitmap.CompressFormat.PNG, 100, out); } image.recycle(); screenshots.put(name); } }
    private void onMain(Task task) throws Exception { final Throwable[] failure = new Throwable[1]; runOnMainSync(() -> { try { task.run(); } catch (Throwable error) { failure[0] = error; } }); if (failure[0] instanceof Error) throw (Error) failure[0]; if (failure[0] != null) throw (Exception) failure[0]; }
    private static Object field(Object target, String name) throws Exception { Field field = target.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(target); }
    private void await(Condition condition, long timeout, String error) throws Exception { long deadline = SystemClock.elapsedRealtime() + timeout; while (!condition.ready()) { if (SystemClock.elapsedRealtime() > deadline) throw new AssertionError(error); SystemClock.sleep(35); } }
    private void check(boolean value, String label) { if (!value) throw new AssertionError(label); checks.put(label); }
    private static List<String> ids(List<Track> tracks) { List<String> result = new ArrayList<>(); for (Track track : tracks) result.add(track.id); return result; }
    private static View find(View view, String prefix) { CharSequence description = view.getContentDescription(); if (description != null && description.toString().startsWith(prefix)) return view; if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) { View result = find(((ViewGroup) view).getChildAt(i), prefix); if (result != null) return result; } return null; }
    private static Map<String, Object> snapshot(SharedPreferences prefs) { Map<String, Object> result = new HashMap<>(); for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) { Object value = entry.getValue(); if (value instanceof Set) value = new HashSet<>((Set<?>) value); result.put(entry.getKey(), value); } return result; }
    @SuppressWarnings("unchecked") private static void restore(SharedPreferences prefs, Map<String, Object> original) { SharedPreferences.Editor edit = prefs.edit().clear(); for (Map.Entry<String, Object> entry : original.entrySet()) { String key = entry.getKey(); Object value = entry.getValue(); if (value instanceof String) edit.putString(key, (String) value); else if (value instanceof Boolean) edit.putBoolean(key, (Boolean) value); else if (value instanceof Integer) edit.putInt(key, (Integer) value); else if (value instanceof Long) edit.putLong(key, (Long) value); else if (value instanceof Float) edit.putFloat(key, (Float) value); else if (value instanceof Set) edit.putStringSet(key, (Set<String>) value); else throw new IllegalArgumentException("Unknown preference type"); } if (!edit.commit()) throw new IllegalStateException("Could not restore original preferences"); }
    private static void wave(File file) throws Exception { int bytes = 16000 * 30 * 2; try (BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(file))) { out.write("RIFF".getBytes(StandardCharsets.US_ASCII)); little(out, bytes + 36, 4); out.write("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)); little(out, 16, 4); little(out, 1, 2); little(out, 1, 2); little(out, 16000, 4); little(out, 32000, 4); little(out, 2, 2); little(out, 16, 2); out.write("data".getBytes(StandardCharsets.US_ASCII)); little(out, bytes, 4); byte[] silence = new byte[8192]; while (bytes > 0) { int count = Math.min(bytes, silence.length); out.write(silence, 0, count); bytes -= count; } } }
    private static void little(java.io.OutputStream out, int value, int bytes) throws Exception { for (int i = 0; i < bytes; i++) out.write(value >>> (i * 8) & 255); }
    private static String sha(File file) throws Exception { MessageDigest digest = MessageDigest.getInstance("SHA-256"); try (InputStream in = new FileInputStream(file)) { byte[] bytes = new byte[8192]; int count; while ((count = in.read(bytes)) >= 0) digest.update(bytes, 0, count); } StringBuilder result = new StringBuilder(); for (byte value : digest.digest()) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255)); return result.toString(); }
    private String shell(String command) throws Exception { try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command)); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) { byte[] bytes = new byte[1024]; int count; while ((count = in.read(bytes)) >= 0) out.write(bytes, 0, count); return out.toString("UTF-8"); } }
}
