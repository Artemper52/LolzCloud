package com.lolzcloud.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;

/** Fixed-origin read-only API. Cookies are never persisted here or sent to provider frames. */
final class SocialApi {
    static final class Unauthorized extends IOException { Unauthorized() { super("Войди через Lolzteam"); } }
    static final class Snapshot {
        final String userId, name;
        final boolean notificationsEnabled;
        final int unread;
        final List<SocialPolicy.Event> events;
        Snapshot(String id, String name, boolean enabled, int unread, List<SocialPolicy.Event> events) {
            this.userId = id; this.name = name; this.notificationsEnabled = enabled; this.unread = unread; this.events = events;
        }
    }

    static Snapshot fetch(String cookie) throws IOException {
        if (cookie == null || cookie.isEmpty() || !cookie.equals(SocialPolicy.sessionCookie(cookie))) throw new Unauthorized();
        try {
            return parse(get("/api/social/me", cookie), get("/api/social/notifications", cookie));
        } catch (JSONException malformed) { throw new IOException("Сервер вернул некорректные данные профиля", malformed); }
    }

    static Snapshot parse(JSONObject me, JSONObject response) throws JSONException {
            JSONObject profile = me.getJSONObject("profile");
            String id = SocialPolicy.userId(profile.get("id"));
            if (id.isEmpty() || !(profile.get("name") instanceof String)) throw new JSONException("Invalid identity");
            boolean enabled = profile.getJSONObject("preferences").getBoolean("notificationsEnabled") && response.getBoolean("enabled");
            if (!id.equals(SocialPolicy.userId(response.get("userId")))) throw new JSONException("Account changed");
            int unread = response.getInt("unread");
            if (unread < 0 || unread > 1_000_000) throw new JSONException("Invalid unread count");
            JSONArray notifications = response.getJSONArray("notifications");
            if (notifications.length() > 500) throw new JSONException("Too many notifications");
            List<SocialPolicy.Event> events = new ArrayList<>();
            for (int i = 0; i < notifications.length(); i++) {
                JSONObject row = notifications.getJSONObject(i);
                String eventId = row.getString("id"), type = row.getString("type");
                if (!SocialPolicy.eventId(eventId)) throw new JSONException("Invalid notification id");
                if (!row.has("readAt") || !row.isNull("readAt") && row.getLong("readAt") < 0) throw new JSONException("Invalid read timestamp");
                JSONObject actor = row.getJSONObject("actor");
                events.add(new SocialPolicy.Event(eventId, type, actor.getString("name"), row.getLong("createdAt"),
                        row.isNull("expiresAt") ? 0 : row.optLong("expiresAt", 0), !row.isNull("readAt"), row.getString("status")));
            }
            return new Snapshot(id, SocialPolicy.displayName(profile.getString("name")), enabled, unread, events);
    }

    private static JSONObject get(String path, String cookie) throws IOException, JSONException {
        // No caller-supplied URL, redirects, shared CookieHandler, or token-bearing logs.
        if (!"/api/social/me".equals(path) && !"/api/social/notifications".equals(path)) throw new IOException("Недопустимый API");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(SocialPolicy.ORIGIN + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(7000); connection.setReadTimeout(8000);
            connection.setRequestMethod("GET"); connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("User-Agent", "LolzCloud-Android");
            int code = connection.getResponseCode();
            if (code == HttpURLConnection.HTTP_UNAUTHORIZED || code == HttpURLConnection.HTTP_FORBIDDEN) throw new Unauthorized();
            if (code == 404 || code == 501) throw new IOException("Обновление профилей на сервере ещё недоступно");
            if (code != 200) throw new IOException("Не удалось обновить профиль (HTTP " + code + ")");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) throw new IOException("Сервер не вернул данные профиля");
            if (connection.getContentLengthLong() > 512 * 1024) throw new IOException("Ответ профиля слишком большой");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count; long deadline = System.nanoTime() + 15_000_000_000L;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Обновление отменено");
                    if (System.nanoTime() > deadline) throw new IOException("Сервис долго отвечает");
                    if (output.size() + count > 512 * 1024) throw new IOException("Ответ профиля слишком большой");
                    output.write(buffer, 0, count);
                }
                return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
    }
    private SocialApi() { }
}
