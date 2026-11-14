package com.lolzcloud.mobile;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses genuine imported/provider LRC; untimed text is never fake-synchronized. */
public final class LrcParser {
    private static final Pattern TIME = Pattern.compile("\\[(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?\\]");
    private static final Pattern OFFSET = Pattern.compile("(?im)^\\[offset:([+-]?\\d+)\\]\\s*$");
    private static final Pattern META = Pattern.compile("^\\[[a-zA-Z]+:.*\\]$");
    private static final Pattern WORD_TIME = Pattern.compile("<\\d{1,3}:\\d{2}(?:[.:]\\d{1,3})?>");

    public static final class Line {
        public final long time;
        public final String text;
        public Line(long time, String text) { this.time = time; this.text = text; }
    }

    public static List<Line> parse(String input) {
        List<Line> timed = new ArrayList<>();
        List<Line> plain = new ArrayList<>();
        if (input == null || input.isEmpty()) return timed;
        long offset = 0;
        Matcher offsetMatch = OFFSET.matcher(input);
        if (offsetMatch.find()) {
            try { offset = Long.parseLong(offsetMatch.group(1)); }
            catch (NumberFormatException ignored) { }
        }
        for (String source : input.replace("\uFEFF", "").split("\\r?\\n")) {
            Matcher matcher = TIME.matcher(source);
            List<Long> times = new ArrayList<>();
            int end = 0;
            while (matcher.find()) {
                int minutes = Integer.parseInt(matcher.group(1));
                int seconds = Integer.parseInt(matcher.group(2));
                if (seconds > 59) continue;
                String fraction = matcher.group(3);
                long milliseconds = fraction == null ? 0 : Long.parseLong((fraction + "000").substring(0, 3));
                times.add(Math.max(0, minutes * 60_000L + seconds * 1_000L + milliseconds + offset));
                end = matcher.end();
            }
            String text = WORD_TIME.matcher(source.substring(end)).replaceAll("").trim();
            if (!times.isEmpty()) {
                for (long time : times) timed.add(new Line(time, text));
            } else if (!text.isEmpty() && !META.matcher(text).matches()) plain.add(new Line(-1, text));
        }
        if (timed.isEmpty()) return plain;
        Collections.sort(timed, new Comparator<Line>() {
            @Override public int compare(Line a, Line b) { return Long.compare(a.time, b.time); }
        });
        return timed;
    }

    public static int activeLine(List<Line> lines, long position) {
        int active = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).time < 0) return -1;
            if (lines.get(i).time > position) break;
            active = i;
        }
        return active;
    }

    private LrcParser() { }
}
