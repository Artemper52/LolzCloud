package com.lolzcloud.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

/** Public recommendation endpoint. No login cookies, private file paths or third-party tokens. */
public final class WaveApi implements WaveSession.Provider {
    public static final int MAX_BODY = 1_000_000, MAX_RESPONSE = 256 * 1024;
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "LolzCloud-wave-deadline"); thread.setDaemon(true); return thread;
    });
    private volatile HttpsURLConnection active;

    public static final class Row {
        public final Track track;
        public final JSONObject metadata;
        public final String reason;
        public Row(Track track, JSONObject metadata, String reason) { this.track = track; this.metadata = metadata; this.reason = reason; }
    }
    public static final class Batch {
        public final List<Row> tracks;
        public final int nextCursor;
        public final String context, request, note;
        public Batch(List<Row> tracks, int nextCursor, String context, String request, String note) {
            this.tracks = Collections.unmodifiableList(new ArrayList<>(tracks)); this.nextCursor = nextCursor;
            this.context = context; this.request = request; this.note = note;
        }
    }

    @Override public void cancel() { HttpsURLConnection connection = active; if (connection != null) connection.disconnect(); }

    @Override public Batch recommend(JSONObject request) throws IOException {
        byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > MAX_BODY) throw new IOException("Для волны слишком много данных. Уменьши историю или число лайков.");
        if (Thread.currentThread().isInterrupted()) throw new IOException("Подбор отменён");
        final HttpsURLConnection connection = (HttpsURLConnection) new URL(OnlineCatalog.ORIGIN + "/music/wave").openConnection();
        active = connection;
        final java.util.concurrent.atomic.AtomicBoolean expired = new java.util.concurrent.atomic.AtomicBoolean();
        ScheduledFuture<?> deadline = DEADLINES.schedule(() -> { expired.set(true); connection.disconnect(); }, 22, TimeUnit.SECONDS);
        try {
            connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setConnectTimeout(7_000); connection.setReadTimeout(18_000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("Волна вернула переадресацию. Повтори позже.");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("application/json")) throw new IOException("Волна временно недоступна (HTTP " + status + ").");
            String json = read(status == 200 ? connection.getInputStream() : connection.getErrorStream());
            if (Thread.currentThread().isInterrupted()) throw new IOException("Подбор отменён");
            if (status != 200) {
                String message = status == 429 ? "Слишком много запросов к волне. Подожди минуту и повтори." : "Не удалось подобрать музыку. Проверь интернет и повтори.";
                try { String detail = new JSONObject(json).optString("error", ""); if (!detail.trim().isEmpty()) message = clean(detail, 300); } catch (JSONException ignored) { }
                throw new IOException(message);
            }
            return parse(json);
        } catch (IOException failure) {
            if (expired.get() || failure instanceof java.net.SocketTimeoutException) throw new IOException("Волна долго отвечает. Нажми «Повторить».", failure);
            if (failure instanceof java.net.UnknownHostException) throw new IOException("Нет связи с волной. Проверь интернет и повтори.", failure);
            if (failure instanceof javax.net.ssl.SSLException) throw new IOException("Защищённое соединение с волной прервалось. Нажми «Повторить».",failure);
            throw failure;
        } finally { deadline.cancel(false); if (active == connection) active = null; connection.disconnect(); }
    }

    public static Batch parse(String json) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE) throw new IOException("Ответ волны слишком большой");
        try {
            JSONObject root = new JSONObject(json);
            Object version=root.get("version"),rawCursor=root.get("nextCursor");
            if (!(version instanceof Number)||((Number)version).doubleValue()!=1) throw new IOException("Обнови приложение для этой версии волны.");
            if(!(rawCursor instanceof Number))throw new IOException("Некорректная страница волны");
            JSONArray rows = root.getJSONArray("tracks");
            double cursor = root.getDouble("nextCursor");
            if (cursor < 0 || cursor > 1_000_000 || cursor != Math.rint(cursor) || rows.length() > 20) throw new IOException("Некорректная очередь волны");
            OnlineCatalog.Page catalog = OnlineCatalog.parse(new JSONObject().put("tracks", rows).put("nextOffset", "").toString());
            if (catalog.tracks.size() != rows.length()) throw new IOException("Волна вернула повторяющиеся записи");
            List<Row> result = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                Track track = catalog.tracks.get(i);
                JSONObject metadata = metadata(rows.getJSONObject(i));
                if (metadata == null) throw new IOException("Некорректные сведения волны");
                result.add(new Row(track, metadata, clean(rows.getJSONObject(i).optString("reason", ""), 180)));
            }
            JSONObject request = root.optJSONObject("request");
            return new Batch(result, (int) cursor, clean(root.optString("context", ""), 120),
                    request == null ? "" : clean(request.optString("text", ""), 240), request == null ? "" : clean(request.optString("note", ""), 300));
        } catch (JSONException | IllegalArgumentException failure) { throw new IOException("Волна вернула некорректный ответ", failure); }
    }

    /** The request schema is narrower than a portable profile: only full SC tracks up to 20 minutes. */
    public static JSONObject metadata(JSONObject input) {
        try {
            String url = WavePolicy.source(input.optString("url", ""));
            String title = clean(input.optString("title", ""), 180);
            double duration = input.optDouble("duration", 0);
            if (url.isEmpty() || title.isEmpty() || !Double.isFinite(duration) || duration < 0 || duration > 1200) return null;
            JSONObject result = new JSONObject().put("url", url).put("title", title).put("artist", clean(input.optString("artist", ""), 100)).put("duration", duration);
            String id = input.isNull("id") ? "" : input.optString("id", "");
            result.put("id", id.matches("[1-9][0-9]{0,15}") && Long.parseLong(id) <= 9_007_199_254_740_991L ? Long.parseLong(id) : JSONObject.NULL);
            String cover = input.optString("cover", "");
            result.put("cover", OnlineCatalog.isCoverUrl(cover) ? cover : "");
            for (String key : new String[]{"genre", "tags", "description"}) result.put(key, clean(input.optString(key, ""), key.equals("genre") ? 80 : key.equals("tags") ? 300 : 600));
            int year = input.optInt("releaseYear", 0), maximum = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR) + 1;
            double bpm = input.optDouble("bpm", 0);
            result.put("releaseYear", year >= 1800 && year <= maximum ? year : 0).put("bpm", Double.isFinite(bpm) && bpm >= 30 && bpm <= 300 ? bpm : 0);
            String artistUrl = input.optString("artistUrl", "");
            return result.put("artistUrl", artistUrl.matches("https://(?:www\\.)?soundcloud\\.com/[A-Za-z0-9_-]+/?") ? artistUrl : "");
        } catch (JSONException | NumberFormatException invalid) { return null; }
    }

    public static JSONObject metadata(Track track) {
        if (track == null) return null;
        try { return metadata(new JSONObject().put("id", track.id.startsWith("soundcloud:") ? track.id.substring(11) : JSONObject.NULL)
                .put("url", track.sourceUrl).put("title", track.title).put("artist", track.artist).put("duration", track.duration / 1000d).put("cover", track.coverUrl)); }
        catch (JSONException impossible) { return null; }
    }

    public static List<String> fingerprints(JSONObject track) {
        return WavePolicy.fingerprints(track.optString("url", ""), track.isNull("id") ? "" : track.optString("id", ""), track.optString("title", ""), track.optString("artist", ""));
    }

    private static String clean(String value, int limit) { String text = value.replaceAll("[\\p{Cc}\\p{Cf}]", " ").trim(); return text.length() > limit ? text.substring(0, limit) : text; }
    private static String read(InputStream input) throws IOException {
        if (input == null) return "{}";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[8192]; int count;
            while ((count = stream.read(bytes)) != -1) { if (output.size() + count > MAX_RESPONSE) throw new IOException("Ответ волны слишком большой"); output.write(bytes, 0, count); }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
