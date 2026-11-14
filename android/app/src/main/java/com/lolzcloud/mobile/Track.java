package com.lolzcloud.mobile;

import org.json.JSONException;
import org.json.JSONObject;

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
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return value;
    }

    public static Track fromJson(JSONObject value) throws JSONException {
        String uri = value.getString("uri");
        String id = value.getString("id");
        if (uri.length() == 0 || id.length() == 0) throw new JSONException("Empty track identity");
        return new Track(id, value.optString("title", "Без названия"),
                value.optString("artist", "Неизвестный исполнитель"), uri,
                value.optLong("duration", 0), value.optLong("addedAt", 0),
                value.optString("sourceUrl", ""), value.optString("coverUrl", ""));
    }

    private static String clean(String value, int limit) {
        if (value == null) return "";
        String result = value.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]", "").trim();
        return result.length() > limit ? result.substring(0, limit) : result;
    }
}
