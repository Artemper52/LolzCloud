package com.lolzcloud.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Small private local library. Removing a row never removes the source document. */
public final class LibraryStore {
    private static final Object LOCK = new Object();
    private final Context context;
    private final SharedPreferences prefs;
    private String offlineCacheJson;
    private java.util.Map<String, Track> offlineCache = new java.util.HashMap<>();

    public LibraryStore(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences("lolzcloud_library_v1", Context.MODE_PRIVATE);
    }

    public List<Track> tracks() { synchronized (LOCK) { return readTracks("tracks"); } }

    public Track find(String id) {
        for (Track track : tracks()) if (track.id.equals(id)) return track;
        return null;
    }

    /** Call off the UI thread. Caller owns persistable URI permission from ACTION_OPEN_DOCUMENT. */
    public Track addUri(Uri uri) throws IOException {
        if (uri == null || !"content".equals(uri.getScheme())) throw new IOException("Выберите аудиофайл через системный проводник");
        String display = "Аудиофайл";
        try (Cursor cursor = context.getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) display = cursor.getString(0);
        } catch (RuntimeException error) { throw new IOException("Нет доступа к выбранному файлу", error); }
        String title = display == null ? "Без названия" : display.replaceFirst("\\.[^.]+$", "");
        String artist = "Неизвестный исполнитель";
        long duration = 0;
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context, uri);
            String metadataTitle = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String metadataArtist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String metadataDuration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (metadataTitle != null && !metadataTitle.trim().isEmpty()) title = metadataTitle;
            if (metadataArtist != null && !metadataArtist.trim().isEmpty()) artist = metadataArtist;
            if (metadataDuration != null) duration = Long.parseLong(metadataDuration);
        } catch (RuntimeException error) {
            throw new IOException("Файл недоступен или его аудиоформат не поддерживается", error);
        } finally { try { retriever.release(); } catch (Exception ignored) { } }
        Track track = new Track(idFor(uri.toString()), title, artist, uri.toString(), duration);
        add(track);
        return track;
    }

    public Track addStream(String address, String title) throws IOException {
        Uri uri = Uri.parse(address == null ? "" : address.trim());
        if (!isDirectHttps(uri)) throw new IOException("Нужна прямая HTTPS-ссылка на аудиофайл. Страницы SoundCloud и YouTube открывайте в источнике");
        String name = title == null || title.trim().isEmpty() ? uri.getLastPathSegment() : title;
        if (name == null || name.isEmpty()) name = "Онлайн-аудио";
        String catalogId = OnlineCatalog.audioId(uri.toString());
        Track track = new Track(catalogId.isEmpty() ? idFor(uri.toString()) : "soundcloud:" + catalogId, name, uri.getHost(), uri.toString(), 0);
        Track existing = find(track.id); if (existing != null) return existing;
        add(track);
        return track;
    }

    public void add(Track track) {
        synchronized (LOCK) {
            List<Track> tracks = readTracks("tracks");
            for (Track item : tracks) if (item.id.equals(track.id)) return;
            tracks.add(track);
            writeTracks("tracks", tracks);
        }
    }

    /** Search pages stay ephemeral; only a selected/liked/queued catalog track is remembered. */
    public Track rememberCatalog(Track candidate) {
        if (candidate == null) return null;
        if (!candidate.id.matches("soundcloud:[1-9][0-9]{0,15}")) { add(candidate); return candidate; }
        synchronized (LOCK) {
            List<Track> tracks = readTracks("tracks");
            for (int i = 0; i < tracks.size(); i++) if (tracks.get(i).id.equals(candidate.id)) {
                Track old = tracks.get(i);
                String scheme = Uri.parse(old.uri).getScheme();
                boolean local = "file".equals(scheme) || "content".equals(scheme);
                Track updated = new Track(old.id, candidate.title, candidate.artist, local ? old.uri : candidate.uri,
                        local && old.duration > 0 ? old.duration : candidate.duration, old.addedAt,
                        candidate.sourceUrl.isEmpty() ? old.sourceUrl : candidate.sourceUrl,
                        candidate.coverUrl.isEmpty() ? old.coverUrl : candidate.coverUrl);
                tracks.set(i, updated); writeTracks("tracks", tracks); return updated;
            }
            tracks.add(candidate); writeTracks("tracks", tracks); return candidate;
        }
    }

    /** A known offline document always wins over the same result returned by a later search. */
    public Track resolveCatalog(Track candidate) {
        if (candidate == null || !candidate.id.startsWith("soundcloud:")) return candidate;
        Track stored = find(candidate.id);
        if (stored != null) {
            String scheme = Uri.parse(stored.uri).getScheme();
            if ("file".equals(scheme) || "content".equals(scheme)) return new Track(stored.id, candidate.title, candidate.artist,
                    stored.uri, stored.duration > 0 ? stored.duration : candidate.duration, stored.addedAt,
                    candidate.sourceUrl.isEmpty() ? stored.sourceUrl : candidate.sourceUrl,
                    candidate.coverUrl.isEmpty() ? stored.coverUrl : candidate.coverUrl);
        }
        return candidate;
    }

    public List<Track> resolveCatalog(List<Track> candidates) {
        java.util.Map<String, Track> local = new java.util.HashMap<>();
        for (Track track : tracks()) { String scheme = Uri.parse(track.uri).getScheme(); if ("file".equals(scheme) || "content".equals(scheme)) local.put(track.id, track); }
        List<Track> resolved = new ArrayList<>();
        for (Track candidate : candidates) {
            Track saved = local.get(candidate.id);
            resolved.add(saved == null || !candidate.id.startsWith("soundcloud:") ? candidate : new Track(saved.id,
                    candidate.title, candidate.artist, saved.uri, saved.duration > 0 ? saved.duration : candidate.duration,
                    saved.addedAt, candidate.sourceUrl.isEmpty() ? saved.sourceUrl : candidate.sourceUrl,
                    candidate.coverUrl.isEmpty() ? saved.coverUrl : candidate.coverUrl));
        }
        return resolved;
    }

    /** Replace one verified stream atomically, retaining identity, likes, lyrics, queue and history. */
    public void replaceWithOffline(Track source, Track offline) throws IOException {
        if (!source.id.equals(offline.id) || !isDirectHttps(Uri.parse(source.uri))) throw new IOException("Источник изменился");
        Uri uri = Uri.parse(offline.uri);
        File directory = new File(context.getFilesDir(), "offline").getCanonicalFile();
        File file = "file".equals(uri.getScheme()) && uri.getPath() != null ? new File(uri.getPath()).getCanonicalFile() : null;
        if (file == null || !directory.equals(file.getParentFile()) || !file.isFile() || file.length() == 0)
            throw new IOException("Проверенный аудиофайл недоступен");
        Track replacement = new Track(offline.id, offline.title, offline.artist, offline.uri, offline.duration,
                offline.addedAt, offline.sourceUrl.isEmpty() ? source.sourceUrl : offline.sourceUrl,
                offline.coverUrl.isEmpty() ? source.coverUrl : offline.coverUrl);
        synchronized (LOCK) {
            List<Track> tracks = readTracks("tracks");
            boolean found = false;
            for (int i = 0; i < tracks.size(); i++) if (tracks.get(i).id.equals(source.id)) {
                if (!tracks.get(i).uri.equals(source.uri)) throw new IOException("Источник уже изменился. Обнови библиотеку");
                tracks.set(i, replacement); found = true; break;
            }
            if (!found) throw new IOException("Трек уже удалён из библиотеки");
            List<Track> queue = replaceTrack(readTracks("queue"), source, replacement);
            List<Track> history = replaceTrack(readTracks("history"), source, replacement);
            if (!prefs.edit().putString("tracks", tracksJson(tracks)).putString("queue", tracksJson(queue))
                    .putString("history", tracksJson(history)).commit()) throw new IOException("Не удалось сохранить библиотеку. Проверь свободное место");
        }
    }

    private static List<Track> replaceTrack(List<Track> tracks, Track source, Track replacement) {
        for (int i = 0; i < tracks.size(); i++) if (tracks.get(i).id.equals(source.id) && tracks.get(i).uri.equals(source.uri)) tracks.set(i, replacement);
        return tracks;
    }

    private static String tracksJson(List<Track> tracks) {
        JSONArray rows = new JSONArray();
        for (Track track : tracks) rows.put(track.toJson());
        return rows.toString();
    }

    /** Failed/interrupted SharedPreferences.commit may already have published its memory map. */
    boolean referencesUri(String uri) {
        synchronized (LOCK) {
            for (String key : new String[]{"tracks", "queue", "history"})
                for (Track track : readTracks(key)) if (track.uri.equals(uri)) return true;
            return false;
        }
    }

    public void remove(String id) {
        synchronized (LOCK) {
            List<Track> tracks = readTracks("tracks");
            for (int i = tracks.size() - 1; i >= 0; i--) if (tracks.get(i).id.equals(id)) tracks.remove(i);
            writeTracks("tracks", tracks);
            Set<String> liked = new HashSet<>(prefs.getStringSet("liked", new HashSet<String>()));
            liked.remove(id);
            prefs.edit().putStringSet("liked", liked).remove("lyrics_" + id).apply();
        }
    }

    public boolean isLiked(String id) {
        return prefs.getStringSet("liked", new HashSet<String>()).contains(id);
    }

    public boolean toggleLike(String id) {
        synchronized (LOCK) {
            Set<String> liked = new HashSet<>(prefs.getStringSet("liked", new HashSet<String>()));
            boolean nowLiked = !liked.remove(id);
            if (nowLiked) liked.add(id);
            prefs.edit().putStringSet("liked", liked).apply();
            return nowLiked;
        }
    }

    public List<Track> liked() {
        List<Track> result = new ArrayList<>();
        for (Track track : tracks()) if (isLiked(track.id)) result.add(track);
        return result;
    }

    public List<Track> history() { synchronized (LOCK) { return preferOffline(readTracks("history")); } }

    public void recordPlayed(Track track) {
        synchronized (LOCK) {
            if (prefs.getBoolean("private_mode", false)) return;
            List<Track> history = readTracks("history");
            for (int i = history.size() - 1; i >= 0; i--) if (history.get(i).id.equals(track.id)) history.remove(i);
            history.add(0, preferOffline(java.util.Collections.singletonList(track)).get(0));
            if (history.size() > 200) history = new ArrayList<>(history.subList(0, 200));
            writeTracks("history", history);
        }
    }

    public String lyrics(String id) { return prefs.getString("lyrics_" + id, ""); }
    public void saveLyrics(String id, String text) {
        if (text == null || text.length() > 256_000) throw new IllegalArgumentException("Текст слишком большой");
        prefs.edit().putString("lyrics_" + id, text).apply();
    }

    public boolean privateMode() { return prefs.getBoolean("private_mode", false); }
    public void setPrivateMode(boolean enabled) { prefs.edit().putBoolean("private_mode", enabled).apply(); }

    public void saveQueue(List<Track> queue, int index, long position) {
        synchronized (LOCK) {
            JSONArray array = new JSONArray();
            for (Track track : preferOffline(queue)) array.put(track.toJson());
            prefs.edit().putString("queue", array.toString()).putInt("queue_index", index)
                    .putLong("queue_position", Math.max(0, position)).apply();
        }
    }

    public List<Track> savedQueue() { synchronized (LOCK) { return preferOffline(readTracks("queue")); } }

    /** A delayed service snapshot must not undo an atomic completed offline replacement. LOCK held. */
    private List<Track> preferOffline(List<Track> snapshot) {
        String libraryJson = prefs.getString("tracks", "[]");
        if (!libraryJson.equals(offlineCacheJson)) {
            java.util.Map<String, Track> offline = new java.util.HashMap<>();
            for (Track track : readTracks("tracks")) {
                String scheme = Uri.parse(track.uri).getScheme();
                if ("file".equals(scheme) || "content".equals(scheme)) offline.put(track.id, track);
            }
            offlineCache = offline; offlineCacheJson = libraryJson;
        }
        List<Track> result = new ArrayList<>(snapshot.size());
        for (Track track : snapshot) {
            Track local = offlineCache.get(track.id);
            result.add(local != null && isDirectHttps(Uri.parse(track.uri)) ? local : track);
        }
        return result;
    }
    public int savedIndex() { return prefs.getInt("queue_index", 0); }
    public long savedPosition() { return prefs.getLong("queue_position", 0); }
    public SharedPreferences preferences() { return prefs; }

    public static boolean isDirectHttps(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        for (String blocked : new String[]{"soundcloud.com", "on.soundcloud.com", "youtube.com", "youtu.be", "music.youtube.com"}) {
            if (host.equals(blocked) || host.endsWith("." + blocked)) return false;
        }
        return true;
    }

    public static boolean isPlayable(Context context, String value) {
        Uri uri = Uri.parse(value == null ? "" : value);
        if ("content".equals(uri.getScheme())) return true;
        if ("https".equals(uri.getScheme())) return isDirectHttps(uri);
        if (!"file".equals(uri.getScheme()) || uri.getPath() == null) return false;
        try {
            String path = new File(uri.getPath()).getCanonicalPath();
            for (File base : new File[]{context.getFilesDir(), context.getCacheDir(), context.getExternalFilesDir(null)}) {
                if (base != null && path.startsWith(base.getCanonicalPath() + File.separator)) return true;
            }
        } catch (IOException ignored) { }
        return false;
    }

    public byte[] artwork(Track track) {
        if (track == null || !"content".equals(Uri.parse(track.uri).getScheme())) return null;
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context, Uri.parse(track.uri));
            byte[] art = retriever.getEmbeddedPicture();
            return art != null && art.length <= 4 * 1024 * 1024 ? art : null;
        } catch (RuntimeException ignored) { return null; }
        finally { try { retriever.release(); } catch (Exception ignored) { } }
    }

    public String exportProfile() {
        synchronized (LOCK) {
            JSONObject data = new JSONObject();
            try {
                data.put("format", "lolzcloud-android-profile");
                data.put("version", 1);
                JSONArray liked = new JSONArray();
                for (Track track : liked()) {
                    JSONObject item = new JSONObject();
                    item.put("title", track.title); item.put("artist", track.artist);
                    // Local URI grants and private history are deliberately not portable.
                    if (isDirectHttps(Uri.parse(track.uri))) item.put("uri", track.uri);
                    liked.put(item);
                }
                data.put("liked", liked);
                data.put("speed", prefs.getFloat("speed", 1f));
                data.put("bass", prefs.getInt("bass", 0));
                data.put("repeat", prefs.getInt("repeat", 0));
                return data.toString(2);
            } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        }
    }

    /** Validates fully before one preference commit. URI permissions, history and privacy stay local. */
    public int importProfile(String json) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > 1024 * 1024)
            throw new IOException("Файл профиля должен быть не больше 1 МБ");
        synchronized (LOCK) {
            try {
                JSONObject profile = new JSONObject(json);
                if (!"lolzcloud-android-profile".equals(profile.optString("format"))
                        || profile.optInt("version", -1) != 1)
                    throw new IOException("Этот формат профиля не поддерживается");
                JSONArray incoming = profile.getJSONArray("liked");
                if (incoming.length() > 5000) throw new IOException("В профиле слишком много записей");
                List<Track> tracks = readTracks("tracks");
                Set<String> liked = new HashSet<>(prefs.getStringSet("liked", new HashSet<String>()));
                Set<String> restored = new HashSet<>();
                for (int i = 0; i < incoming.length(); i++) {
                    JSONObject item = incoming.getJSONObject(i);
                    String title = item.getString("title").trim();
                    String artist = item.getString("artist").trim();
                    if (title.isEmpty() || title.length() > 300 || artist.length() > 300)
                        throw new IOException("В профиле есть некорректные названия треков");
                    String address = null;
                    if (item.has("uri")) {
                        if (!(item.get("uri") instanceof String)) throw new IOException("Некорректный источник в профиле");
                        address = item.getString("uri");
                        if (address.length() > 8192 || !isDirectHttps(Uri.parse(address)))
                            throw new IOException("Профиль содержит недопустимый источник. Разрешены только прямые HTTPS-ссылки");
                    }
                    Track matched = null;
                    String catalogId = address == null ? "" : OnlineCatalog.audioId(address);
                    for (Track track : tracks) {
                        if ((!catalogId.isEmpty() && track.id.equals("soundcloud:" + catalogId)) || (address != null && track.uri.equals(address))
                                || (track.title.equalsIgnoreCase(title) && track.artist.equalsIgnoreCase(artist))) {
                            matched = track;
                            break;
                        }
                    }
                    if (matched == null && address != null) {
                        matched = new Track(catalogId.isEmpty() ? idFor(address) : "soundcloud:" + catalogId, title, artist, address, 0);
                        tracks.add(matched);
                    }
                    if (matched != null) { liked.add(matched.id); restored.add(matched.id); }
                }
                double incomingSpeed = profile.optDouble("speed", 1.0);
                if (Double.isNaN(incomingSpeed) || Double.isInfinite(incomingSpeed))
                    throw new IOException("Некорректная скорость в профиле");
                JSONArray savedTracks = new JSONArray();
                for (Track track : tracks) savedTracks.put(track.toJson());
                String backup = exportProfile();
                boolean success = prefs.edit().putString("profile_backup", backup)
                        .putLong("profile_backup_at", System.currentTimeMillis())
                        .putString("tracks", savedTracks.toString()).putStringSet("liked", liked)
                        .putFloat("speed", (float) Math.max(.5, Math.min(2.0, incomingSpeed)))
                        .putInt("bass", Math.max(0, Math.min(1000, profile.optInt("bass", 0))))
                        .putInt("repeat", Math.max(0, Math.min(2, profile.optInt("repeat", 0))))
                        .commit();
                if (!success) throw new IOException("Не удалось сохранить профиль. Проверьте свободное место");
                return restored.size();
            } catch (JSONException | IllegalArgumentException invalid) {
                throw new IOException("Файл профиля повреждён или имеет неверный формат", invalid);
            }
        }
    }

    private List<Track> readTracks(String key) {
        List<Track> tracks = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs.getString(key, "[]"));
            for (int i = 0; i < array.length(); i++) {
                try { tracks.add(Track.fromJson(array.getJSONObject(i))); }
                catch (JSONException ignored) { /* Keep valid rows if a single entry is damaged. */ }
            }
        } catch (JSONException ignored) { }
        return tracks;
    }

    private void writeTracks(String key, List<Track> tracks) {
        JSONArray array = new JSONArray();
        for (Track track : tracks) array.put(track.toJson());
        prefs.edit().putString(key, array.toString()).apply();
    }

    private static String idFor(String uri) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(uri.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < 16; i++) out.append(String.format(Locale.ROOT, "%02x", digest[i] & 255));
            return out.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
}
