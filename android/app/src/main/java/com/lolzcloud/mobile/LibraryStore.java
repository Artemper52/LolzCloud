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
    public interface CommitGuard { void verify() throws IOException; }
    private static final Object LOCK = new Object();
    private final Context context;
    private final SharedPreferences prefs;
    private String offlineCacheJson;
    private java.util.Map<String, Track> offlineCache = new java.util.HashMap<>();
    private java.util.Map<String, Track> trackCache = new java.util.HashMap<>();
    private String aliasCacheJson;
    private java.util.Map<String, String> aliasIdCache = new java.util.HashMap<>();

    public LibraryStore(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences("lolzcloud_library_v1", Context.MODE_PRIVATE);
    }

    public List<Track> tracks() { synchronized (LOCK) { return readTracks("tracks"); } }

    public Track find(String id) {
        synchronized (LOCK) { String canonical = canonicalId(id); for (Track track : readTracks("tracks")) if (track.id.equals(canonical)) return track; return null; }
    }

    private String canonicalId(String id) {
        if (id == null || !id.startsWith("soundcloud-url:")) return id;
        synchronized (LOCK) {
            String json = prefs.getString("portable_aliases", "{}");
            if (!json.equals(aliasCacheJson)) {
                java.util.Map<String, String> next = new java.util.HashMap<>();
                try { JSONObject aliases = new JSONObject(json); for (java.util.Iterator<String> keys = aliases.keys(); keys.hasNext();) { String url = keys.next(), canonical = aliases.optString(url, ""); if (OnlineCatalog.isSourceUrl(url) && canonical.matches("soundcloud:(?:[1-9][0-9]{0,15})|soundcloud-url:[a-f0-9]{32}")) next.put(Track.catalogReference("", url, "", "", 0, "").id, canonical); } }
                catch (JSONException invalid) { }
                aliasIdCache = next; aliasCacheJson = json;
            }
            String canonical = aliasIdCache.get(id); return canonical == null ? id : canonical;
        }
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
        if (candidate.isCatalogReference()) { Track known = find(candidate.id); if (known != null) return known; add(candidate); return candidate; }
        if (!candidate.id.matches("soundcloud:[1-9][0-9]{0,15}")) { add(candidate); return candidate; }
        synchronized (LOCK) {
            List<Track> tracks = readTracks("tracks");
            if (candidate.id.equals("soundcloud:" + OnlineCatalog.audioId(candidate.uri))) for (Track old : tracks)
                if (old.isCatalogReference() && (old.id.equals(candidate.id) || old.sourceUrl.equals(candidate.sourceUrl))) {
                    try { return resolvePortableReference(old, candidate); }
                    catch (IOException notSaved) { return old; } // Service resolution retains an actionable error/retry path.
                }
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

    /** Caller owns the active service generation or an explicit native catalog selection. */
    public Track resolvePortableReference(Track reference, Track resolved) throws IOException {
        if (reference == null || !reference.isCatalogReference() || resolved == null
                || !resolved.id.equals("soundcloud:" + OnlineCatalog.audioId(resolved.uri))
                || !OnlineCatalog.isSourceUrl(resolved.sourceUrl)
                || reference.id.startsWith("soundcloud:") && !reference.id.equals(resolved.id)
                || reference.id.startsWith("soundcloud-url:") && !reference.sourceUrl.equals(resolved.sourceUrl))
            throw new IOException("Каталог вернул другую запись");
        synchronized (LOCK) {
            Track existing = find(resolved.id);
            Track canonical = existing != null && (existing.uri.startsWith("file:") || existing.uri.startsWith("content:"))
                    ? new Track(existing.id, resolved.title, resolved.artist, existing.uri, existing.duration,
                    existing.addedAt, resolved.sourceUrl, resolved.coverUrl) : resolved;
            List<Track> tracks = readTracks("tracks");
            boolean retained = false;
            for (int i = tracks.size() - 1; i >= 0; i--) if (tracks.get(i).id.equals(reference.id) || tracks.get(i).id.equals(canonical.id)) { tracks.remove(i); retained = true; }
            if (retained) tracks.add(canonical); // Removing a library row during resolution must not resurrect it.
            Set<String> liked = new HashSet<>(prefs.getStringSet("liked", new HashSet<String>()));
            if (liked.remove(reference.id)) liked.add(canonical.id);
            SharedPreferences.Editor edit = prefs.edit().putString("tracks", trackJson(tracks).toString()).putStringSet("liked", liked);
            for (String key : new String[]{"queue", "history"}) {
                List<Track> saved = readTracks(key);
                for (int i = 0; i < saved.size(); i++) if (saved.get(i).id.equals(reference.id)) saved.set(i, canonical);
                edit.putString(key, trackJson(saved).toString());
            }
            if (!reference.id.equals(canonical.id)) {
                List<Long> times = bookmarks(canonical.id);
                for (long time : bookmarks(reference.id)) { boolean found = false; for (long old : times) if (Math.abs(old - time) < 500) found = true; if (!found) times.add(time); }
                JSONArray data = new JSONArray(); for (long time : times) data.put(time);
                edit.putString("bookmarks_" + canonical.id, data.toString()).remove("bookmarks_" + reference.id);
                if (lyrics(canonical.id).isEmpty() && !lyrics(reference.id).isEmpty()) edit.putString("lyrics_" + canonical.id, lyrics(reference.id));
                edit.remove("lyrics_" + reference.id);
            }
            try {
                JSONObject aliases = new JSONObject(prefs.getString("portable_aliases", "{}"));
                aliases.put(reference.sourceUrl, canonical.id); aliases.put(canonical.sourceUrl, canonical.id);
                edit.putString("portable_aliases", aliases.toString());
            } catch (JSONException invalid) { throw new IOException("Не удалось обновить ссылки профиля", invalid); }
            if (!edit.commit()) throw new IOException("Не удалось сохранить запись. Проверь свободное место");
            return canonical;
        }
    }

    private static JSONArray trackJson(List<Track> tracks) { JSONArray data = new JSONArray(); for (Track track : tracks) data.put(track.toJson()); return data; }

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
            id = canonicalId(id);
            List<Track> tracks = readTracks("tracks");
            for (int i = tracks.size() - 1; i >= 0; i--) if (tracks.get(i).id.equals(id)) tracks.remove(i);
            writeTracks("tracks", tracks);
            Set<String> liked = new HashSet<>(prefs.getStringSet("liked", new HashSet<String>()));
            liked.remove(id);
            prefs.edit().putStringSet("liked", liked).remove("lyrics_" + id).apply();
        }
    }

    public boolean isLiked(String id) {
        synchronized (LOCK) { return prefs.getStringSet("liked", new HashSet<String>()).contains(canonicalId(id)); }
    }

    public boolean toggleLike(String id) {
        synchronized (LOCK) {
            id = canonicalId(id);
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

    public List<Long> bookmarks(String id) {
        synchronized (LOCK) {
            id = canonicalId(id);
            List<Long> result = new ArrayList<>();
            try {
                JSONArray data = new JSONArray(prefs.getString("bookmarks_" + id, "[]"));
                for (int i = 0; i < data.length(); i++) {
                    Object value = data.opt(i);
                    if (!(value instanceof Number)) continue;
                    long position = ((Number) value).longValue();
                    if (position >= 0 && position <= Integer.MAX_VALUE) result.add(position);
                }
            } catch (JSONException invalid) { /* Ignore corrupt local bookmark data. */ }
            return result;
        }
    }

    public boolean addBookmark(String id, long position) throws IOException {
        if (id == null || id.isEmpty() || position < 0 || position > Integer.MAX_VALUE) throw new IOException("Некорректная позиция момента");
        synchronized (LOCK) {
            id = canonicalId(id);
            List<Long> saved = bookmarks(id);
            for (long value : saved) if (Math.abs(value - position) < 500) return false;
            // Existing larger lists remain intact; only new additions are bounded.
            if (saved.size() >= 100) throw new IOException("Для трека уже сохранено 100 моментов. Удали ненужные.");
            saved.add(position); writeBookmarks(id, saved);
            Track track = find(id); String identity = track != null && !track.sourceUrl.isEmpty() ? track.sourceUrl : id;
            prefs.edit().putLong("bookmark_created_" + idFor(identity + "@" + position), System.currentTimeMillis()).apply(); return true;
        }
    }

    public void removeBookmark(String id, long position) {
        synchronized (LOCK) {
            id = canonicalId(id);
            List<Long> saved = bookmarks(id);
            for (int i = saved.size() - 1; i >= 0; i--) if (saved.get(i) == position) saved.remove(i);
            writeBookmarks(id, saved);
        }
    }

    private void writeBookmarks(String id, List<Long> positions) {
        JSONArray data = new JSONArray(); for (long position : positions) data.put(position);
        prefs.edit().putString("bookmarks_" + id, data.toString()).apply();
    }

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
            java.util.Map<String, Track> all = new java.util.HashMap<>();
            for (Track track : readTracks("tracks")) {
                all.put(track.id, track);
                String scheme = Uri.parse(track.uri).getScheme();
                if ("file".equals(scheme) || "content".equals(scheme)) offline.put(track.id, track);
            }
            offlineCache = offline; trackCache = all; offlineCacheJson = libraryJson;
        }
        List<Track> result = new ArrayList<>(snapshot.size());
        for (Track track : snapshot) {
            if (track.isCatalogReference()) { Track resolved = trackCache.get(canonicalId(track.id)); if (resolved != null && !resolved.isCatalogReference()) { result.add(resolved); continue; } }
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

    public String previewProfile(String json) throws IOException {
        ProfileJson.requireObject(json);
        try {
            JSONObject raw = new JSONObject(json);
            if ("lolzcloud-android-profile".equals(raw.optString("format"))) {
                validateLegacy(raw, json); return "Прежний профиль Android\nЛюбимых записей: " + raw.getJSONArray("liked").length()
                        + "\nЛайки объединятся с библиотекой. Очередь и воспроизведение останутся на месте.";
            }
            JSONObject safe = PortableProfile.parse(json);
            return "Общий профиль LolzCloud v1\nЛюбимое: " + safe.getJSONObject("wave").getJSONArray("likes").length()
                    + " · моменты: " + safe.getJSONObject("tools").getJSONArray("bookmarks").length()
                    + " · подборки: " + safe.getJSONObject("music").getJSONArray("collections").length()
                    + "\nЛюбимое и моменты объединятся с твоими. Очередь и пауза не изменятся."
                    + "\nПодборки, вкусы и неподдерживаемые настройки сохранятся для переноса обратно на ПК. Файлы и входы не переносятся.";
        } catch (JSONException failure) { throw new IOException("Файл профиля повреждён", failure); }
    }

    public int portableExcludedCount() {
        synchronized (LOCK) { int count = 0; for (Track track : readTracks("tracks")) { boolean portable = OnlineCatalog.isSourceUrl(track.sourceUrl); if (!portable && isLiked(track.id)) count++; for (long position : bookmarks(track.id)) if (!portable || position > 14400000) count++; } return count; }
    }

    /** Desktop v1 output; only schema-whitelisted portable metadata can leave the device. */
    public String exportProfile() throws IOException {
        synchronized (LOCK) {
            try {
                JSONObject profile = portableSnapshot(), sound = profile.getJSONObject("music").getJSONObject("dsp");
                if (prefs.contains("portable_export_dsp")) sound = PortableProfile.sound(new JSONObject(prefs.getString("portable_export_dsp", "{}")));
                else if (prefs.contains("portable_dsp")) sound = PortableProfile.sound(new JSONObject(prefs.getString("portable_dsp", "{}")));
                else sound.put("rate", prefs.getFloat("speed", 1f));
                return exportProjection(profile, readTracks("tracks"), new HashSet<>(prefs.getStringSet("liked", new HashSet<String>())), null,
                        new JSONObject(prefs.getString("portable_aliases", "{}")), sound);
            } catch (JSONException | IllegalArgumentException invalid) { throw new IOException("Не удалось подготовить общий профиль", invalid); }
        }
    }

    private String exportProjection(JSONObject input, List<Track> records, Set<String> likedIds,
                                    java.util.Map<String, List<Long>> changedMoments, JSONObject aliases, JSONObject sound) throws JSONException, IOException {
                JSONObject profile = new JSONObject(input.toString()), music = profile.getJSONObject("music"), wave = profile.getJSONObject("wave"), tools = profile.getJSONObject("tools");
                JSONArray oldLikes = wave.getJSONArray("likes"), likes = new JSONArray(); Set<String> seen = new HashSet<>();
                // Retain portable ordering, aliases and duplicate metadata while their native like exists.
                for (int i = 0; i < oldLikes.length(); i++) {
                    JSONObject old = oldLikes.getJSONObject(i); boolean keep = !OnlineCatalog.isSourceUrl(old.getString("url"));
                    for (Track track : records) if (likedIds.contains(track.id) && portableMatches(old, track, aliases)) { keep = true; seen.add(track.id); }
                    if (keep) likes.put(new JSONObject(old.toString()));
                }
                for (Track track : records) {
                    if (!likedIds.contains(track.id)) continue;
                    if (!OnlineCatalog.isSourceUrl(track.sourceUrl) || !seen.add(track.id)) continue;
                    JSONObject row = new JSONObject();
                    row.put("id", track.id.startsWith("soundcloud:") ? Long.parseLong(track.id.substring(11)) : JSONObject.NULL)
                            .put("url", track.sourceUrl).put("title", track.title).put("artist", track.artist).put("duration", Math.round(track.duration / 1000d));
                    if (!track.coverUrl.isEmpty()) row.put("cover", track.coverUrl);
                    likes.put(PortableProfile.track(row));
                }
                wave.put("likes", likes);
                JSONArray oldBookmarks = tools.getJSONArray("bookmarks"), bookmarks = new JSONArray();
                java.util.Map<String, List<Long>> positions = new java.util.HashMap<>();
                for (Track track : records) if (OnlineCatalog.isSourceUrl(track.sourceUrl)) positions.put(track.id,
                        changedMoments != null && changedMoments.containsKey(track.id) ? changedMoments.get(track.id) : bookmarks(track.id));
                for (int i = 0; i < oldBookmarks.length(); i++) {
                    JSONObject old = oldBookmarks.getJSONObject(i); boolean keep = !OnlineCatalog.isSourceUrl(old.getString("url"));
                    for (Track track : records) if (positions.containsKey(track.id) && portableMatches(old, track, aliases))
                        for (long position : positions.get(track.id)) if (Math.abs(old.getDouble("position") * 1000 - position) < 500) keep = true;
                    if (keep) bookmarks.put(new JSONObject(old.toString()));
                }
                for (Track track : records) {
                    if (!OnlineCatalog.isSourceUrl(track.sourceUrl)) continue;
                    for (long milliseconds : positions.get(track.id)) {
                        if (milliseconds > 14400000) continue;
                        boolean exists = false;
                        for (int i = 0; i < oldBookmarks.length(); i++) {
                            JSONObject old = oldBookmarks.getJSONObject(i);
                            if (portableMatches(old, track, aliases) && Math.abs(old.getDouble("position") * 1000 - milliseconds) < 500) { exists = true; break; }
                        }
                        if (exists) continue;
                        JSONObject row = new JSONObject().put("id", "android-" + idFor(track.sourceUrl + "@" + milliseconds)).put("note", "").put("createdAt", prefs.getLong("bookmark_created_" + idFor(track.sourceUrl + "@" + milliseconds), 0));
                        row.put("url", track.sourceUrl).put("title", track.title).put("artist", track.artist).put("position", milliseconds / 1000d);
                        bookmarks.put(row);
                    }
                }
                tools.put("bookmarks", bookmarks);
                if (sound != null) music.put("dsp", sound);
                return PortableProfile.normalize(profile).toString();
    }

    public int importProfile(String json) throws IOException { return importProfile(json, true); }

    /** Entire validation/merge precedes one commit. Current service queue is not touched. */
    public int importProfile(String json, boolean applySound) throws IOException { return importProfile(json, applySound, null); }

    public int importProfile(String json, boolean applySound, CommitGuard guard) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > 1024 * 1024) throw new IOException("Файл профиля слишком большой");
        ProfileJson.requireObject(json);
        try {
            JSONObject raw = new JSONObject(json);
            if ("lolzcloud-android-profile".equals(raw.optString("format"))) { validateLegacy(raw, json); return importLegacyProfile(json, applySound, guard); }
        } catch (JSONException failure) { throw new IOException("Файл профиля повреждён", failure); }
        JSONObject profile = PortableProfile.parse(json);
        synchronized (LOCK) {
            try {
                List<Track> tracks = readTracks("tracks"); Set<String> liked = new HashSet<>(prefs.getStringSet("liked", new HashSet<String>()));
                JSONObject aliases = new JSONObject(prefs.getString("portable_aliases", "{}"));
                java.util.Map<String, List<Long>> moments = new java.util.HashMap<>(); Set<String> imported = new HashSet<>();
                JSONArray likes = profile.getJSONObject("wave").getJSONArray("likes");
                for (int i = 0; i < likes.length(); i++) {
                    Track reference = PortableProfile.reference(likes.getJSONObject(i)); if (reference == null) continue;
                    Track target = mergeReference(tracks, reference, aliases); liked.add(target.id); imported.add(target.id);
                }
                JSONArray bookmarks = profile.getJSONObject("tools").getJSONArray("bookmarks");
                for (int i = 0; i < bookmarks.length(); i++) {
                    JSONObject row = bookmarks.getJSONObject(i); if (!OnlineCatalog.isSourceUrl(row.getString("url"))) continue;
                    Track reference = Track.catalogReference("", row.getString("url"), row.getString("title"), row.getString("artist"), 0, "");
                    Track target = mergeReference(tracks, reference, aliases);
                    List<Long> times = moments.get(target.id); if (times == null) { times = new ArrayList<>(bookmarks(target.id)); moments.put(target.id, times); }
                    long position = Math.round(row.getDouble("position") * 1000); boolean duplicate = false;
                    for (long time : times) if (Math.abs(time - position) < 500) duplicate = true;
                    if (!duplicate) times.add(position);
                }
                exportProjection(profile, tracks, liked, moments, aliases, profile.getJSONObject("music").getJSONObject("dsp")); // Limits checked before any commit.
                String backup = exportProfile();
                SharedPreferences.Editor edit = prefs.edit().putString("profile_backup", backup).putLong("profile_backup_at", System.currentTimeMillis())
                        .putString("portable_profile", profile.toString()).putString("portable_aliases", aliases.toString())
                        .putString("portable_export_dsp", profile.getJSONObject("music").getJSONObject("dsp").toString()).putBoolean("portable_dsp_pending", !applySound)
                        .putString("tracks", trackJson(tracks).toString()).putStringSet("liked", liked);
                for (java.util.Map.Entry<String, List<Long>> entry : moments.entrySet()) { JSONArray data = new JSONArray(); for (long time : entry.getValue()) data.put(time); edit.putString("bookmarks_" + entry.getKey(), data.toString()); }
                if (applySound) { JSONObject sound = profile.getJSONObject("music").getJSONObject("dsp"); float rate = (float) sound.getDouble("rate"); edit.putString("portable_dsp", sound.toString()).putBoolean("portable_dsp_apply", true).putFloat("speed", rate).putFloat("pitch", sound.getBoolean("preservesPitch") ? 1f : rate).putInt("bass", 0).putBoolean("reverb", false).putInt("loudness", 0).putBoolean("eq_enabled", sound.getBoolean("enabled")); }
                if (guard != null) guard.verify();
                if (!edit.commit()) throw new IOException("Не удалось сохранить профиль. Проверь свободное место");
                return imported.size();
            } catch (JSONException | IllegalArgumentException failure) { throw new IOException("Файл профиля содержит недопустимые данные", failure); }
        }
    }

    private static Track mergeReference(List<Track> tracks, Track reference, JSONObject aliases) throws JSONException {
        String known = aliases.optString(reference.sourceUrl, "");
        for (Track track : tracks) if (track.id.equals(reference.id)) { aliases.put(reference.sourceUrl, track.id); return track; }
        for (Track track : tracks) if ((!known.isEmpty() && track.id.equals(known) || reference.sourceUrl.equals(track.sourceUrl))
                && !(reference.id.startsWith("soundcloud:") && track.id.startsWith("soundcloud:") && !reference.id.equals(track.id))) { aliases.put(reference.sourceUrl, track.id); return track; }
        tracks.add(reference); aliases.put(reference.sourceUrl, reference.id); return reference;
    }

    private static boolean portableMatches(JSONObject row, Track track, JSONObject aliases) {
        String url = row.optString("url", "");
        return url.equals(track.sourceUrl) || track.id.equals(aliases.optString(url, ""))
                || row.opt("id") instanceof Number && track.id.equals("soundcloud:" + row.optLong("id"));
    }

    private JSONObject portableSnapshot() throws IOException, JSONException {
        if (prefs.contains("portable_profile")) return PortableProfile.parse(prefs.getString("portable_profile", ""));
        return PortableProfile.normalize(new JSONObject().put("format", "lolzcloud-profile").put("version", 1));
    }

    private static void validateLegacy(JSONObject profile, String json) throws IOException, JSONException {
        if (json.getBytes(StandardCharsets.UTF_8).length > 1024 * 1024 || !(profile.opt("version") instanceof Number) || profile.getDouble("version") != 1) throw new IOException("Этот формат профиля не поддерживается");
        JSONArray rows = profile.getJSONArray("liked"); if (rows.length() > 5000) throw new IOException("Слишком много записей");
        for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.getJSONObject(i); String title = row.getString("title"), artist = row.getString("artist"); if (title.trim().isEmpty() || title.length() > 300 || artist.length() > 300) throw new IOException("Некорректное название"); if (row.has("uri") && (!(row.get("uri") instanceof String) || !isDirectHttps(Uri.parse(row.getString("uri"))))) throw new IOException("Недопустимый источник в старом профиле"); }
        double rate = profile.optDouble("speed", 1); if (!Double.isFinite(rate)) throw new IOException("Некорректная скорость");
    }

    private String exportLegacyProfile() {
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
    private int importLegacyProfile(String json, boolean applySound, CommitGuard guard) throws IOException {
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
                JSONObject snapshot = portableSnapshot(), sound = snapshot.getJSONObject("music").getJSONObject("dsp");
                if (prefs.contains("portable_export_dsp")) sound = PortableProfile.sound(new JSONObject(prefs.getString("portable_export_dsp", "{}")));
                else if (prefs.contains("portable_dsp")) sound = PortableProfile.sound(new JSONObject(prefs.getString("portable_dsp", "{}")));
                else sound.put("rate", prefs.getFloat("speed", 1f));
                if (applySound) sound.put("rate", Math.max(.5, Math.min(2, incomingSpeed)));
                exportProjection(snapshot, tracks, liked, null, new JSONObject(prefs.getString("portable_aliases", "{}")), sound);
                String backup = exportProfile();
                SharedPreferences.Editor edit = prefs.edit().putString("profile_backup", backup)
                        .putLong("profile_backup_at", System.currentTimeMillis())
                        .putString("tracks", savedTracks.toString()).putStringSet("liked", liked);
                if (applySound) edit.putFloat("speed", (float) Math.max(.5, Math.min(2.0, incomingSpeed)))
                        .putInt("bass", Math.max(0, Math.min(1000, profile.optInt("bass", 0))))
                        .putInt("repeat", Math.max(0, Math.min(2, profile.optInt("repeat", 0))));
                if (applySound && prefs.contains("portable_dsp")) edit.putString("portable_dsp", PortableProfile.sound(new JSONObject(prefs.getString("portable_dsp", "{}"))).put("rate", Math.max(.5, Math.min(2, incomingSpeed))).toString());
                if (applySound) edit.putString("portable_export_dsp", sound.toString());
                if (guard != null) guard.verify();
                boolean success = edit.commit();
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
