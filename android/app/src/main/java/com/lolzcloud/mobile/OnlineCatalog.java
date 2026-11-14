package com.lolzcloud.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/** Public native catalog. Neither SoundCloud account cookies nor WebViews are used. */
public final class OnlineCatalog {
    public static final String ORIGIN = "https://lolzcloud.com";
    private static final int JSON_LIMIT = 512 * 1024;
    private static final Pattern ID = Pattern.compile("[1-9][0-9]{0,15}");
    private static final Pattern AUDIO = Pattern.compile("^/music/audio/([1-9][0-9]{0,15})/([a-f0-9]{24})\\.mp3$");
    private static final ScheduledExecutorService AUDIO_TIMEOUTS = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "LolzCloud-audio-timeout"); thread.setDaemon(true); return thread;
    });
    private volatile HttpsURLConnection active;

    public static final class Page {
        public final List<Track> tracks;
        public final String nextOffset;
        Page(List<Track> tracks, String nextOffset) {
            this.tracks = Collections.unmodifiableList(new ArrayList<>(tracks)); this.nextOffset = nextOffset;
        }
    }

    public void cancel() { HttpsURLConnection connection = active; if (connection != null) try { connection.disconnect(); } catch (RuntimeException ignored) { } }

    public Page search(String query, String offset) throws IOException {
        String q = normalizeQuery(query);
        if (q.length() < 2 || q.length() > 140 || q.matches("(?s).*[\\p{Cntrl}].*"))
            throw new IOException("Введи название трека, исполнителя или ссылку SoundCloud: от 2 до 140 символов");
        String cursor = offset == null || offset.isEmpty() ? "0" : offset;
        if (!isOffset(cursor)) throw new IOException("Некорректная страница поиска");
        if (Thread.currentThread().isInterrupted()) throw new IOException("Поиск отменён");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(ORIGIN + "/music/search?q="
                + URLEncoder.encode(q, "UTF-8") + "&offset=" + cursor).openConnection();
        active = connection;
        try {
            prepare(connection, 22000); connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("Каталог вернул переадресацию. Попробуй позже");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("application/json"))
                throw new IOException("Каталог временно недоступен (HTTP " + status + ")");
            InputStream input = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String json = new String(read(input, JSON_LIMIT), StandardCharsets.UTF_8);
            if (status != 200) {
                String explanation = "Не удалось выполнить поиск (HTTP " + status + ")";
                try { String serverError = new JSONObject(json).optString("error", ""); if (!serverError.trim().isEmpty()) explanation = clean(serverError, 300); }
                catch (JSONException ignored) { }
                throw new IOException(explanation);
            }
            Page page = parse(json);
            if (!page.nextOffset.isEmpty() && Integer.parseInt(page.nextOffset) <= Integer.parseInt(cursor))
                throw new IOException("Каталог вернул повторяющуюся страницу. Повтори поиск");
            return page;
        } catch (java.net.UnknownHostException error) { throw new IOException("Нет связи с каталогом. Проверь интернет и повтори поиск", error); }
        catch (java.net.SocketTimeoutException error) { throw new IOException("Каталог долго отвечает. Попробуй ещё раз", error); }
        catch (javax.net.ssl.SSLException error) { throw new IOException("Не удалось проверить защищённое соединение с каталогом", error); }
        finally { if (active == connection) active = null; connection.disconnect(); }
    }

    public static Page parse(String json) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > JSON_LIMIT) throw new IOException("Ответ каталога слишком большой");
        try {
            JSONObject value = new JSONObject(json); JSONArray rows = value.getJSONArray("tracks");
            if (rows.length() > 20) throw new IOException("Каталог вернул слишком много треков");
            Object rawOffset = value.opt("nextOffset"); String offset = rawOffset == null || rawOffset == JSONObject.NULL ? "" : rawOffset instanceof String ? (String) rawOffset : null;
            if (offset == null || !offset.isEmpty() && !isOffset(offset)) throw new IOException("Некорректная страница каталога");
            List<Track> tracks = new ArrayList<>(); Set<String> seen = new HashSet<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i); Object rawId = row.get("id"), rawTitle = row.get("title"), rawArtist = row.get("artist"), rawDuration = row.get("duration");
                if (!(rawId instanceof String) || !ID.matcher((String) rawId).matches() || !(rawTitle instanceof String)
                        || !(rawArtist instanceof String) || !(rawDuration instanceof Number)) throw new IOException("Некорректные сведения о треке");
                String id = (String) rawId, title = (String) rawTitle, artist = (String) rawArtist;
                double seconds = ((Number) rawDuration).doubleValue();
                String source = row.getString("url"), audio = row.getString("audioUrl"), cover = row.optString("cover", "");
                if (title.length() > 300 || artist.length() > 300 || title.trim().isEmpty() || !Double.isFinite(seconds) || seconds < 0 || seconds > 1200
                        || !isSourceUrl(source) || !id.equals(audioId(audio)) || !cover.isEmpty() && !isCoverUrl(cover))
                    throw new IOException("Каталог вернул недопустимый источник трека");
                if (seen.add(id)) tracks.add(new Track("soundcloud:" + id, title, artist, audio, Math.round(seconds * 1000), System.currentTimeMillis(), source, cover));
            }
            return new Page(tracks, offset);
        } catch (JSONException | IllegalArgumentException error) { throw new IOException("Каталог вернул некорректный ответ", error); }
    }

    public static boolean isOffset(String value) {
        return value != null && value.matches("(?:0|[1-9][0-9]{0,2})") && Integer.parseInt(value) <= 300 && Integer.parseInt(value) % 20 == 0;
    }

    public static String normalizeQuery(String value) {
        String text = value == null ? "" : value.trim();
        try {
            URI uri = new URI(text); String host = uri.getHost();
            if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                    && host != null && (host.equalsIgnoreCase("soundcloud.com") || host.equalsIgnoreCase("www.soundcloud.com") || host.equalsIgnoreCase("m.soundcloud.com"))) {
                String path = uri.getPath(); if (path != null && path.endsWith("/")) path = path.substring(0, path.length()-1);
                String canonical = new URI("https", "soundcloud.com", path, null, null).toASCIIString();
                if (isSourceUrl(canonical)) return canonical;
            }
        } catch (Exception ignored) { }
        return text;
    }

    private static URI https(String value) {
        if (value == null || value.length() > 2048 || value.indexOf('\\') >= 0) return null;
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getPort() != -1 && uri.getPort() != 443 || uri.getRawFragment() != null) return null;
            return uri;
        } catch (Exception invalid) { return null; }
    }

    public static boolean isSoundCloudAddress(String value) {
        if(value==null||value.length()>2048||value.indexOf('\\')>=0)return false;
        try {
            URI uri=new URI(value);
            if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getRawUserInfo()!=null||uri.getPort()!=-1&&uri.getPort()!=443)return false;
            String host=uri.getHost().toLowerCase(Locale.ROOT);
            return host.equals("soundcloud.com") || host.equals("www.soundcloud.com") || host.equals("m.soundcloud.com") || host.equals("on.soundcloud.com");
        }catch(Exception invalid){return false;}
    }

    public static boolean isSourceUrl(String value) {
        URI uri = https(value);
        if (uri == null || !"soundcloud.com".equals(uri.getHost()) || uri.getRawQuery() != null) return false;
        String path = uri.getPath();
        if (path == null || path.matches("(?s).*[\\p{Cntrl}\\\\].*")) return false;
        String[] parts = path.split("/", -1);
        if (parts.length != 3 || parts[1].isEmpty() || parts[2].isEmpty() || parts[1].equals(".") || parts[1].equals("..") || parts[2].equals(".") || parts[2].equals("..")) return false;
        for (String reserved : new String[]{"search", "discover", "stream", "upload", "users", "playlists", "stations"}) if (parts[1].equalsIgnoreCase(reserved)) return false;
        return !parts[2].equalsIgnoreCase("sets") && !parts[2].equalsIgnoreCase("tracks");
    }

    public static String audioId(String value) {
        URI uri = https(value);
        if (uri == null || !"lolzcloud.com".equals(uri.getHost()) || uri.getRawQuery() != null) return "";
        Matcher match = AUDIO.matcher(uri.getRawPath() == null ? "" : uri.getRawPath()); return match.matches() ? match.group(1) : "";
    }

    /** Only our signed audio route may cause server-side preparation; no source URL is fetched here. */
    public static String preparationUrl(String address) {
        if (audioId(address).isEmpty()) return "";
        URI uri = https(address); Matcher match = AUDIO.matcher(uri.getRawPath());
        return match.matches() ? ORIGIN + "/music/prepare/" + match.group(1) + "/" + match.group(2) : "";
    }

    /** Call off the UI thread. A cold conversion is polled without holding a MediaPlayer connection open. */
    public void prepareAudio(final String address) throws IOException {
        final String endpoint = preparationUrl(address);
        if (endpoint.isEmpty()) throw new IOException("Недопустимый источник аудио");
        final String expectedAudio = ORIGIN + https(address).getRawPath();
        AudioPreparation.await(timeout -> audioPreparationRequest(endpoint, expectedAudio, timeout), AudioPreparation.SYSTEM);
    }

    private AudioPreparation.Reply audioPreparationRequest(String endpoint, String expectedAudio, int timeoutMillis) throws IOException {
        if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("Подготовка трека отменена");
        final HttpsURLConnection connection = (HttpsURLConnection) new URL(endpoint).openConnection();
        active = connection; final AtomicBoolean timedOut = new AtomicBoolean();
        ScheduledFuture<?> timeout = AUDIO_TIMEOUTS.schedule(() -> { timedOut.set(true); connection.disconnect(); }, timeoutMillis, TimeUnit.MILLISECONDS);
        try {
            prepare(connection, Math.min(5000, timeoutMillis));
            connection.setConnectTimeout(Math.min(5000, timeoutMillis));
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new AudioFailure("Сервис аудио вернул переадресацию. Нажми «Повторить»");
            if (status == 404 || status == 403) throw new AudioFailure("Эта запись больше недоступна. Попробуй найти другой вариант трека");
            if (status == 429) throw new AudioFailure("Слишком много запросов. Подожди минуту и нажми «Повторить»");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("application/json") || connection.getContentLengthLong() > 16 * 1024)
                throw new AudioFailure("Не удалось подготовить аудио (HTTP " + status + "). Нажми «Повторить»");
            String json = new String(read(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(), 16 * 1024), StandardCharsets.UTF_8);
            if (timedOut.get()) throw new java.net.SocketTimeoutException("Audio preparation request deadline");
            return parsePreparation(status, json, expectedAudio);
        } catch (AudioFailure failure) { throw failure; }
        catch (IOException failure) {
            if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("Подготовка трека отменена");
            if (timedOut.get() || failure instanceof java.net.SocketTimeoutException)
                throw new IOException("Сервис аудио долго отвечает. Нажми «Повторить»", failure);
            if (failure instanceof javax.net.ssl.SSLException)
                throw new IOException("Не удалось проверить защищённое соединение с аудиосервисом", failure);
            throw new IOException("Нет связи с аудиосервисом. Проверь интернет и нажми «Повторить»", failure);
        } finally {
            timeout.cancel(false); if (active == connection) active = null; connection.disconnect();
        }
    }

    static AudioPreparation.Reply parsePreparation(int status, String json, String expectedAudio) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > 16 * 1024) throw new AudioFailure("Некорректный ответ аудиосервиса");
        try {
            JSONObject body = new JSONObject(json);
            if (status == 200 && "ready".equals(body.optString("state")) && expectedAudio.equals(body.optString("audioUrl")) && !audioId(expectedAudio).isEmpty())
                return new AudioPreparation.Reply(true, 0);
            if (status == 202 && "preparing".equals(body.optString("state"))) {
                Object retry = body.opt("retryAfterMs");
                if (!(retry instanceof Number) || !Double.isFinite(((Number) retry).doubleValue())) throw new AudioFailure("Некорректный ответ аудиосервиса");
                return new AudioPreparation.Reply(false, ((Number) retry).longValue());
            }
            if (status >= 400) {
                String message = clean(body.optString("error", ""), 300);
                throw new AudioFailure(message.isEmpty() ? "Не удалось подготовить запись. Нажми «Повторить» или выбери другой трек" : message);
            }
            throw new AudioFailure("Аудиосервис вернул неверную запись. Нажми «Повторить»");
        } catch (JSONException failure) { throw new AudioFailure("Некорректный ответ аудиосервиса"); }
    }

    private static final class AudioFailure extends IOException {
        AudioFailure(String message) { super(message); }
    }

    public static boolean isCoverUrl(String value) {
        URI uri = https(value); if (uri == null || uri.getRawQuery() != null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT), path = uri.getPath();
        return (host.equals("lolzcloud.com") || host.endsWith(".sndcdn.com")) && path != null && path.startsWith("/")
                && !path.contains("/../") && !path.contains("/./") && !path.matches("(?s).*[\\p{Cntrl}\\\\].*");
    }

    public static byte[] artwork(String address) throws IOException {
        if (!isCoverUrl(address)) throw new IOException("Недопустимая обложка");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(address).openConnection();
        try {
            prepare(connection, 7000); connection.setRequestProperty("Accept", "image/*");
            if (connection.getResponseCode() != 200) throw new IOException("Обложка недоступна");
            String type = connection.getContentType(); if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("image/") || type.toLowerCase(Locale.ROOT).contains("svg")) throw new IOException("Некорректный формат обложки");
            if (connection.getContentLengthLong() > 2 * 1024 * 1024) throw new IOException("Обложка слишком большая");
            return read(connection.getInputStream(), 2 * 1024 * 1024);
        } finally { connection.disconnect(); }
    }

    private static void prepare(HttpsURLConnection connection, int timeout) {
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(8000); connection.setReadTimeout(timeout);
        connection.setRequestProperty("User-Agent", "LolzCloud-Android"); connection.setUseCaches(false);
    }

    private static byte[] read(InputStream input, int limit) throws IOException {
        if (input == null) throw new IOException("Каталог не ответил");
        long deadline = System.nanoTime() + 30_000_000_000L;
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Запрос отменён");
                if (out.size() + count > limit || System.nanoTime() > deadline) throw new IOException("Ответ сервиса слишком большой или медленный");
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        }
    }
    private static String clean(String value, int limit) { String text = value.replaceAll("[\\p{Cntrl}]", " ").trim(); return text.length() > limit ? text.substring(0, limit) : text; }
}
