package com.lolzcloud.mobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Shared PC wave identities and the cancellation rules of one native listening session. */
public final class WavePolicy {
    public static final long DAY = 86_400_000L;
    private WavePolicy() { }

    public static String source(String value) {
        if (value == null || !value.matches("https://(?:www\\.)?soundcloud\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/?")) return "";
        String canonical = value.replace("www.soundcloud.com", "soundcloud.com").replaceFirst("/$", "");
        return canonical.startsWith("https://soundcloud.com/sets/") ? "" : canonical;
    }

    public static String normalized(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }

    public static String recording(String title, String artist) {
        String a = normalized(artist).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        // Java's Unicode word boundary differs from the ECMAScript boundary used by PC.
        String t = normalized(title).replaceAll("(?<![A-Za-z0-9_])(?:official|audio|video|lyrics?|visualizer|hd|hq)(?![A-Za-z0-9_])", "")
                .replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        return a.isEmpty() || t.isEmpty() ? "" : "recording:" + a + ":" + t;
    }

    public static List<String> fingerprints(String source, String numericId, String title, String artist) {
        ArrayList<String> result = new ArrayList<>();
        String url = source(source);
        if (!url.isEmpty()) result.add(sha256("url:" + url));
        if (numericId != null && numericId.matches("[1-9][0-9]{0,15}")) {
            long id = Long.parseLong(numericId);
            if (id <= 9_007_199_254_740_991L) result.add(sha256("id:" + id));
        }
        String recording = recording(title, artist);
        if (!recording.isEmpty()) result.add(sha256(recording));
        return result;
    }

    public static String sha256(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte part : bytes) result.append(String.format(Locale.ROOT, "%02x", part & 255));
            return result.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }

    /** A pause retires an in-flight request even if its transport cannot be interrupted. */
    public static final class Gate {
        private long generation;
        private long completed = Long.MIN_VALUE;
        private boolean active, intent, loading;
        public void start() { generation++; active = intent = true; loading = false; completed = Long.MIN_VALUE; }
        public void pause() { generation++; intent = loading = false; }
        public void stop() { pause(); active = false; }
        public void resume() { if (active) intent = true; }
        public void invalidate() { generation++; loading = false; }
        public long request() { if (!active || loading) return -1; loading = true; return generation; }
        public boolean owns(long token) { return active && loading && token == generation; }
        public boolean finish(long token) { if (!owns(token)) return false; loading = false; return true; }
        public boolean complete(long occurrence) {
            if (!active || !intent || occurrence == completed) return false;
            completed = occurrence; return true;
        }
        public void rearm() { completed = Long.MIN_VALUE; }
        public boolean active() { return active; }
        public boolean intent() { return intent; }
        public boolean loading() { return loading; }
        public long generation() { return generation; }
    }
}
