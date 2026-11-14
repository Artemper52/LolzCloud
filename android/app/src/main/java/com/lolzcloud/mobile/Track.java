package com.lolzcloud.mobile;

import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** A playable file or direct HTTPS audio source; service-page URLs are not audio. */
public final class Track {
    public final String id;
    public final String title;
    public final String artist;
    public final String uri;
    public final long duration;
    public final long addedAt;
    public final String sourceUrl;
    public final String coverUrl;

    public Track(String id, String title, String artist, String uri, long duration) {
        this(id, title, artist, uri, duration, System.currentTimeMillis());
    }

    public Track(String id, String title, String artist, String uri, long duration, long addedAt) {
        this(id, title, artist, uri, duration, addedAt, "", "");
    }

    public Track(String id, String title, String artist, String uri, long duration, long addedAt,
                 String sourceUrl, String coverUrl) {
        this.id = clean(id, 160);
        String displayTitle = clean(title, 300);
        String displayArtist = clean(artist, 300);
        this.title = displayTitle.isEmpty() ? "Без названия" : displayTitle;
        this.artist = displayArtist.isEmpty() ? "Неизвестный исполнитель" : displayArtist;
        this.uri = uri == null ? "" : uri;
        this.duration = Math.max(0, duration);
        this.addedAt = addedAt;
        this.sourceUrl = OnlineCatalog.isSourceUrl(sourceUrl) ? sourceUrl : "";
        this.coverUrl = OnlineCatalog.isCoverUrl(coverUrl) ? coverUrl : "";
    }

    public Track withUri(String address, long length) {
        return new Track(id, title, artist, address, length, addedAt, sourceUrl, coverUrl);
    }

    /** Portable identity only. A permalink is never a MediaPlayer data source. */
    public static Track catalogReference(String numericId, String source, String title, String artist,
                                         long duration, String cover) {
        if (!OnlineCatalog.isSourceUrl(source)) throw new IllegalArgumentException("Invalid SoundCloud reference");
        String id;
        if (numericId != null && !numericId.isEmpty()) {
            if (!numericId.matches("[1-9][0-9]{0,15}")) throw new IllegalArgumentException("Invalid SoundCloud ID");
            id = "soundcloud:" + numericId;
        } else id = referenceId(source);
        return new Track(id, title, artist, "", duration, System.currentTimeMillis(), source, cover);
    }

    public boolean isCatalogReference() {
        return uri.isEmpty() && OnlineCatalog.isSourceUrl(sourceUrl)
                && (id.matches("soundcloud:[1-9][0-9]{0,15}") || id.equals(referenceId(sourceUrl)));
    }

    private static String referenceId(String source) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            StringBuilder hash = new StringBuilder("soundcloud-url:");
            for (int i = 0; i < 16; i++) hash.append(String.format(java.util.Locale.ROOT, "%02x", digest[i] & 255));
            return hash.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }

    public JSONObject toJson() {
        JSONObject value = new JSONObject();
        try {
            value.put("id", id);
            value.put("title", title);
            value.put("artist", artist);
            value.put("uri", uri);
            value.put("duration", duration);
            value.put("addedAt", addedAt);
            if (!sourceUrl.isEmpty()) value.put("sourceUrl", sourceUrl);
            if (!coverUrl.isEmpty()) value.put("coverUrl", coverUrl);
            if (isCatalogReference()) value.put("catalogReference", true);
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return value;
    }

    public static Track fromJson(JSONObject value) throws JSONException {
        String uri = value.getString("uri");
        String id = value.getString("id");
        if (id.length() == 0) throw new JSONException("Empty track identity");
        Track track = new Track(id, value.optString("title", "Без названия"),
                value.optString("artist", "Неизвестный исполнитель"), uri,
                value.optLong("duration", 0), value.optLong("addedAt", 0),
                value.optString("sourceUrl", ""), value.optString("coverUrl", ""));
        if (value.optBoolean("catalogReference", false)) {
            if (!track.isCatalogReference()) throw new JSONException("Invalid catalog reference");
        } else if (uri.isEmpty()) throw new JSONException("Empty audio source");
        return track;
    }

    private static String clean(String value, int limit) {
        if (value == null) return "";
        String result = value.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]", "").trim();
        return result.length() > limit ? result.substring(0, limit) : result;
    }
}
