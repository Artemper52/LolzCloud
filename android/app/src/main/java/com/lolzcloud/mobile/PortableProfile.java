package com.lolzcloud.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.UUID;

/** Desktop v1 whitelist. Unsupported settings remain data, never native capabilities. */
public final class PortableProfile {
    public static final int MAX_BYTES = 750000;
    private PortableProfile() { }

    public static JSONObject parse(String json) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("Профиль должен быть не больше 750 КБ");
        ProfileJson.requireObject(json);
        try { return normalize(new JSONObject(json)); }
        catch (JSONException | IllegalArgumentException failure) { throw new IOException("Файл профиля повреждён или содержит недопустимые данные", failure); }
    }

    public static JSONObject normalize(JSONObject value) throws JSONException, IOException {
        if (!"lolzcloud-profile".equals(value.optString("format")) || !(value.opt("version") instanceof Number)
                || value.getDouble("version") != 1) throw new IOException("Этот формат профиля не поддерживается");
        if (value.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("Профиль слишком большой");
        JSONObject music = object(value, "music"), wave = object(value, "wave"), tools = object(value, "tools");
        JSONObject preferences = object(music, "preferences"), p = new JSONObject();
        p.put("autoFollow", bool(preferences, "autoFollow", true)).put("reduceMotion", bool(preferences, "reduceMotion", false));
        p.put("density", choice(preferences, "density", "comfortable", "comfortable", "compact"));
        p.put("startupView", choice(preferences, "startupView", "browser", "browser", "wave", "library", "audio", "room"));
        p.put("windowStyle", choice(preferences, "windowStyle", "mac", "mac", "windows", "studio"));
        p.put("lyricsFontScale", number(preferences, "lyricsFontScale", 1, .7, 2)).put("uiScale", number(preferences, "uiScale", 1, .85, 1.5));
        JSONArray collections = array(music, "collections", 100), safeCollections = new JSONArray();
        for (int i = 0; i < collections.length(); i++) {
            JSONObject row = collections.getJSONObject(i); String url = media(row.getString("url"), true);
            if (url.isEmpty()) throw new IOException("В подборке есть недопустимая ссылка");
            String id = text(row, "id", 80); if (!id.matches("[\\w-]{1,80}")) id = UUID.randomUUID().toString();
            safeCollections.put(new JSONObject().put("id", id).put("title", text(row, "title", 100)).put("url", url)
                    .put("addedAt", number(row, "addedAt", System.currentTimeMillis(), 0, 9007199254740991d)));
        }
        JSONObject custom = object(music, "customEffects"), safeCustom = new JSONObject(); int customCount = 0;
        for (Iterator<String> keys = custom.keys(); keys.hasNext();) {
            String name = keys.next(); if (++customCount > 100) throw new IOException("Слишком много звуковых профилей");
            if (name.isEmpty() || name.equals("__proto__") || name.equals("constructor") || name.equals("prototype")) continue;
            safeCustom.put(clean(name, 32), sound(custom.getJSONObject(name)));
        }
        JSONObject safeMusic = new JSONObject().put("preferences", p).put("collections", safeCollections)
                .put("dsp", sound(object(music, "dsp"))).put("customEffects", safeCustom);
        JSONArray likes = array(wave, "likes", 2000), safeLikes = new JSONArray();
        java.util.Map<String, String> identities = new java.util.HashMap<>();
        for (int i = 0; i < likes.length(); i++) {
            JSONObject row = track(likes.getJSONObject(i)); String url = row.getString("url"), id = row.isNull("id") ? "" : String.valueOf(row.getLong("id"));
            String prior = identities.get(url); if (prior != null && !prior.isEmpty() && !id.isEmpty() && !prior.equals(id)) throw new IOException("Одна ссылка указывает на разные ID записей");
            if (prior == null || prior.isEmpty()) identities.put(url, id);
            safeLikes.put(row);
        }
        JSONObject feedback = object(wave, "feedback"), safeFeedback = new JSONObject(); int feedbackCount = 0;
        for (Iterator<String> keys = feedback.keys(); keys.hasNext();) {
            String key = keys.next(); if (++feedbackCount > 2000) throw new IOException("Слишком много записей вкуса");
            JSONObject row = feedback.getJSONObject(key), t = track(row.getJSONObject("track"));
            if (!t.getString("url").equals(key)) throw new IOException("Запись вкуса относится к другому треку");
            safeFeedback.put(key, new JSONObject().put("track", t).put("skips", number(row, "skips", 0, 0, 20))
                    .put("loves", number(row, "loves", 0, 0, 10)).put("banned", bool(row, "banned", false))
                    .put("lastSkippedAt", Math.min(System.currentTimeMillis(), number(row, "lastSkippedAt", 0, 0, 9007199254740991d))));
        }
        JSONObject wp = object(wave, "preferences"), safeWP = new JSONObject();
        safeWP.put("mood", choice(wp, "mood", "any", "any", "calm", "energetic", "happy", "sad"));
        safeWP.put("activity", choice(wp, "activity", "any", "any", "focus", "relax", "workout", "sleep"));
        safeWP.put("character", choice(wp, "character", "mixed", "mixed", "familiar", "discover"));
        safeWP.put("language", choice(wp, "language", "any", "any", "ru", "en", "instrumental"));
        safeWP.put("genre", text(wp, "genre", 80)).put("autoContext", bool(wp, "autoContext", true));
        if (wp.has("adventurous")) safeWP.put("adventurous", number(wp, "adventurous", .5, 0, 1));
        JSONArray blocked = array(wave, "blockedArtists", 100), safeBlocked = new JSONArray();
        for (int i = 0; i < blocked.length(); i++) { String name = clean(blocked.getString(i), 100); if (!name.isEmpty()) safeBlocked.put(name); }
        JSONObject played = object(wave, "played24h"), safePlayed = new JSONObject(); long now = System.currentTimeMillis();
        for (Iterator<String> keys = played.keys(); keys.hasNext();) { String key = keys.next(); double at = number(played, key, 0, 0, 9007199254740991d); if (key.matches("[a-f0-9]{64}") && at > now - 86400000L && at <= now + 86400000L) safePlayed.put(key, at); }
        JSONObject safeWave = new JSONObject().put("likes", safeLikes).put("feedback", safeFeedback)
                .put("adventurous", number(wave, "adventurous", 0, 0, 1)).put("preferences", safeWP)
                .put("blockedArtists", safeBlocked).put("played24h", safePlayed);
        JSONArray bookmarks = array(tools, "bookmarks", 2000), safeBookmarks = new JSONArray();
        for (int i = 0; i < bookmarks.length(); i++) {
            JSONObject row = bookmarks.getJSONObject(i); String url = media(row.getString("url"), false);
            if (url.isEmpty()) throw new IOException("Закладка содержит недопустимую ссылку");
            String id = text(row, "id", 80); if (!id.matches("[\\w-]{1,80}")) id = UUID.randomUUID().toString();
            safeBookmarks.put(new JSONObject().put("id", id).put("url", url).put("title", text(row, "title", 180))
                    .put("artist", text(row, "artist", 100)).put("position", Math.round(number(row, "position", 0, 0, 14400) * 100) / 100d)
                    .put("note", text(row, "note", 240)).put("createdAt", number(row, "createdAt", now, 0, 9007199254740991d)));
        }
        JSONArray groups = array(tools, "groups", 500), safeGroups = new JSONArray();
        for (int i = 0; i < groups.length(); i++) {
            JSONArray group = groups.getJSONArray(i); if (group.length() > 50) throw new IOException("Слишком большая группа записей");
            JSONArray next = new JSONArray(); java.util.Set<String> seen = new java.util.HashSet<>();
            for (int j = 0; j < group.length(); j++) { String url = media(group.getString(j), true); if (!url.startsWith("https://soundcloud.com/")) throw new IOException("Недопустимая группа записей"); if (seen.add(url)) next.put(url); }
            if (next.length() > 1) safeGroups.put(next);
        }
        JSONObject safeTools = new JSONObject().put("bookmarks", safeBookmarks).put("groups", safeGroups)
                .put("normalization", bool(tools, "normalization", false)).put("gains", new JSONObject());
        JSONObject result = new JSONObject().put("format", "lolzcloud-profile").put("version", 1).put("exportedAt", now)
                .put("music", safeMusic).put("wave", safeWave).put("tools", safeTools);
        if (result.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("После нормализации профиль слишком большой");
        return result;
    }

    public static JSONObject sound(JSONObject row) throws JSONException, IOException {
        JSONArray gains = row.has("gains") ? row.getJSONArray("gains") : new JSONArray("[0,0,0,0,0]");
        if (gains.length() != 5) throw new IOException("В эквалайзере должно быть пять полос");
        JSONArray next = new JSONArray(); for (int i = 0; i < 5; i++) { Object raw = gains.get(i); if (!(raw instanceof Number) || !Double.isFinite(((Number) raw).doubleValue()) || ((Number) raw).doubleValue() < -12 || ((Number) raw).doubleValue() > 12) throw new IOException("Полосы должны быть от −12 до +12 дБ"); next.put(raw); }
        return new JSONObject().put("enabled", bool(row, "enabled", false)).put("preset", row.has("preset") ? text(row, "preset", 32) : "Original")
                .put("gains", next).put("rate", number(row, "rate", 1, .5, 2)).put("pitch", number(row,"pitch",1,.5,2))
                .put("preservesPitch", bool(row, "preservesPitch", false)).put("transportEnabled",bool(row,"transportEnabled",false))
                .put("reverb", number(row, "reverb", 0, 0, .8)).put("echo", number(row, "echo", 0, 0, .8)).put("preampDb", number(row, "preampDb", 0, -12, 0));
    }

    public static JSONObject track(JSONObject row) throws JSONException, IOException {
        String url = media(row.has("url") ? row.getString("url") : row.getString("permalink_url"), true);
        if (!url.startsWith("https://soundcloud.com/") || url.contains("/sets/")) throw new IOException("Недопустимый трек в профиле");
        Object id = row.opt("id"); Object safeId = JSONObject.NULL;
        if (id != null && id != JSONObject.NULL) { if (!(id instanceof Number) || !Double.isFinite(((Number) id).doubleValue()) || ((Number) id).doubleValue() < 1 || ((Number) id).doubleValue() > 9007199254740991d || ((Number) id).doubleValue() != ((Number) id).longValue()) throw new IOException("Некорректный ID трека"); safeId = ((Number) id).longValue(); }
        String cover = text(row, "cover", 2048); if (!cover.isEmpty() && !safeHttps(cover)) throw new IOException("Недопустимая обложка");
        String artistUrl = text(row, "artistUrl", 2048); if (!artistUrl.matches("https://(?:www\\.)?soundcloud\\.com/[\\w-]+/?")) artistUrl = "";
        return new JSONObject().put("id", safeId).put("url", url).put("title", text(row, "title", 180)).put("artist", text(row, "artist", 100))
                .put("cover", cover.replace("large.jpg", "t500x500.jpg")).put("duration", Math.round(number(row, "duration", 0, 0, 86400)))
                .put("genre", text(row, "genre", 80)).put("tags", text(row, "tags", 300)).put("description", text(row, "description", 600))
                .put("releaseYear", number(row, "releaseYear", 0, 0, 9999)).put("bpm", number(row, "bpm", 0, 0, 300)).put("artistUrl", artistUrl);
    }

    public static Track reference(JSONObject row) throws JSONException, IOException {
        String source = row.getString("url"); if (!OnlineCatalog.isSourceUrl(source)) return null;
        String id = row.isNull("id") || !row.has("id") ? "" : String.valueOf(row.getLong("id"));
        return Track.catalogReference(id, source, row.optString("title", ""), row.optString("artist", ""), Math.round(row.optDouble("duration", 0) * 1000), row.optString("cover", ""));
    }

    public static String media(String value, boolean collection) {
        if (value == null || value.length() > 2048 || value.indexOf('\\') >= 0) return "";
        try {
            URI uri = new URI(value); String host = uri.getHost(), p = uri.getPath();
            if (!"https".equals(uri.getScheme()) || host == null || uri.getRawUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443) return "";
            if ((host.equals("soundcloud.com") || host.equals("www.soundcloud.com")) && p != null && p.matches(collection ? "/[\\w-]+(?:/[\\w-]+)+/?" : "/[\\w-]+/[\\w-]+/?")) return "https://soundcloud.com" + p.replaceFirst("/$", "");
            String id = "";
            if (host.equals("youtu.be") && p != null) id = p.substring(1);
            else if (host.equals("music.youtube.com") || host.equals("www.youtube.com") || host.equals("youtube.com") || host.equals("www.youtube-nocookie.com")) {
                if ("/watch".equals(p) && uri.getRawQuery() != null) { for (String entry : uri.getRawQuery().split("&")) if (entry.startsWith("v=")) id = entry.substring(2); }
                else if (p != null && p.matches("/(?:embed|shorts)/[\\w-]{11}/?")) id = p.replaceFirst("^/(?:embed|shorts)/", "").replaceFirst("/$", "");
            }
            return id.matches("[\\w-]{11}") ? "https://music.youtube.com/watch?v=" + id : "";
        } catch (Exception invalid) { return ""; }
    }

    private static boolean safeHttps(String value) { try { URI uri = new URI(value); return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443) && value.indexOf('\\') < 0; } catch (Exception invalid) { return false; } }
    private static JSONObject object(JSONObject value, String key) throws JSONException { if (!value.has(key) || value.isNull(key)) return new JSONObject(); return value.getJSONObject(key); }
    private static JSONArray array(JSONObject value, String key, int max) throws JSONException, IOException { JSONArray result = value.has(key) ? value.getJSONArray(key) : new JSONArray(); if (result.length() > max) throw new IOException("Слишком много записей: " + key); return result; }
    private static boolean bool(JSONObject row, String key, boolean fallback) throws JSONException, IOException { if (!row.has(key)) return fallback; if (!(row.get(key) instanceof Boolean)) throw new IOException("Некорректный переключатель: " + key); return row.getBoolean(key); }
    private static double number(JSONObject row, String key, double fallback, double min, double max) throws JSONException, IOException { if (!row.has(key)) return fallback; Object raw = row.get(key); if (!(raw instanceof Number)) throw new IOException("Некорректное число: " + key); double value = ((Number) raw).doubleValue(); if (!Double.isFinite(value) || value < min || value > max) throw new IOException("Число вне диапазона: " + key); return value; }
    private static String choice(JSONObject row, String key, String fallback, String... choices) throws JSONException, IOException { if (!row.has(key)) return fallback; String value = row.getString(key); for (String choice : choices) if (choice.equals(value)) return value; throw new IOException("Неизвестная настройка: " + key); }
    private static String text(JSONObject row, String key, int max) throws JSONException, IOException { if (!row.has(key)) return ""; if (!(row.get(key) instanceof String)) throw new IOException("Некорректный текст: " + key); return clean(row.getString(key), max); }
    private static String clean(String value, int max) { String clean = value.replaceAll("[\\p{Cc}\\p{Cf}]", " ").replaceAll("\\s+", " ").trim(); return clean.length() > max ? clean.substring(0, max) : clean; }
}
