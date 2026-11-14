package com.lolzcloud.mobile;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Recording identity for public lyrics lookup; versions and playback duration stay meaningful. */
public final class LyricsMetadata {
    private static final Pattern DASH = Pattern.compile("^(.+?)\\s+[-–—]\\s+(.+)$");
    private static final Pattern VERSION = Pattern.compile("(?iu)\\b(remix|slowed|sped|speed|reverb|live|version|cover|instrumental|nightcore|edit|mashup)\\b");

    public static final class Query {
        public final String title, artist;
        public final long duration;
        public Query(String title, String artist, long duration) {
            this.title = clean(title); this.artist = clean(artist); this.duration = Math.max(0, duration);
        }
        public boolean usable() { return !normal(title).isEmpty() && !artists(artist).isEmpty() && title.length() <= 300 && artist.length() <= 300; }
        public String key() { return normal(title) + "\n" + normal(artist) + "\n" + duration; }
    }

    public static List<Query> candidates(String title, String artist, long duration) {
        String name = clean(title), performer = unknown(artist) ? "" : clean(artist);
        Matcher dash = DASH.matcher(name);
        if (dash.matches() && sameArtists(dash.group(1), performer)) {
            performer = dash.group(1); name = dash.group(2);
        }
        Matcher featuring=Pattern.compile("(?iu)^(.+?)\\s+(?:\\+|feat\\.?|ft\\.?)\\s+(.+)$").matcher(name);
        if(featuring.matches()&&!VERSION.matcher(featuring.group(2)).find()){
            name=featuring.group(1);performer=performer.isEmpty()?featuring.group(2):performer+", "+featuring.group(2);
        }
        List<Query> result = new ArrayList<>(); Set<String> seen = new LinkedHashSet<>();
        add(result, seen, new Query(name, performer, duration));
        dash = DASH.matcher(name);
        if (dash.matches() && !VERSION.matcher(name).find()) {
            add(result, seen, new Query(dash.group(2), dash.group(1), duration));
            add(result, seen, new Query(dash.group(1), dash.group(2), duration));
        }
        return result;
    }
    private static void add(List<Query> rows, Set<String> seen, Query value) {
        if (value.usable() && seen.add(value.key())) rows.add(value);
    }
    public static String clean(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
                .replaceAll("[\\p{M}\\p{Cf}]", "")
                .replaceAll("(?iu)(?:@(?:tg|тг|telegram)\\s*[:=]\\s*|(?:https?://)?(?:t\\.me|telegram\\.me)/)[^\\s)\\]]+", "")
                .replaceAll("(?iu)[(\\[]\\s*(?:prod(?:uced)?\\.?\\s*(?:by|[.:])?|прод\\.?|official\\s*(?:audio|video|music\\s*video)|lyrics?|visuali[sz]er|music\\s*video|\\d{3,4}p|hq|hd)\\b[^)\\]]*[)\\]]", "")
                .replaceAll("(?iu)\\.(?:mp3|flac|m4a|ogg|wav|opus|aac)$", "")
                .replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
    }
    public static String normal(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
                .replace('ё', 'е').replaceAll("[\\p{M}\\p{Cf}]", "").replaceAll("[^\\p{L}\\p{N}]", "");
    }
    public static boolean sameTitle(String left, String right) {
        String a = normal(clean(left)); return !a.isEmpty() && a.equals(normal(clean(right)));
    }
    public static boolean sameArtists(String left, String right) {
        Set<String> a = artists(left), b = artists(right);
        return !a.isEmpty() && !b.isEmpty() && (a.containsAll(b) || b.containsAll(a));
    }
    private static Set<String> artists(String value) {
        Set<String> result = new LinkedHashSet<>(); if (unknown(value)) return result;
        for (String part : clean(value).split("(?iu)\\s*(?:,|&|\\+|\\bfeat\\.?|\\bft\\.?|\\s[xх×]\\s|\\band\\b)\\s*")) {
            String name = normal(part); if (!name.isEmpty()) result.add(name);
        }
        return result;
    }
    private static boolean unknown(String value) {
        String name = normal(value); return name.isEmpty() || name.equals(normal("Неизвестный исполнитель")) || name.equals("unknownartist") || name.equals("unknown");
    }
    public static boolean durationMatches(long expected, long candidate) {
        return expected > 0 && candidate > 0 && Math.abs(expected - candidate) <= 2000;
    }
    private LyricsMetadata() { }
}
