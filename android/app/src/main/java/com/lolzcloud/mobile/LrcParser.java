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
    private static final Pattern WORD_TIME = Pattern.compile("<(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?>");

    /** Absolute source time, never multiplied by the player's speed. Offsets refer to Line.text. */
    public static final class Word {
        public final long time, end;
        public final String text;
        public final int startOffset, endOffset;
        private Word(long time, long end, String text, int start, int finish) {
            this.time=time; this.end=end; this.text=text; startOffset=start; endOffset=finish;
        }
    }

    public static final class Line {
        public final long time;
        public final String text;
        public final List<Word> words;
        public Line(long time, String text) { this(time,text,Collections.<Word>emptyList()); }
        private Line(long time,String text,List<Word> words) {
            this.time=time; this.text=text;
            this.words=Collections.unmodifiableList(new ArrayList<>(words));
        }
    }

    public static List<Line> parse(String input) {
        List<Line> timed = new ArrayList<>();
        List<Line> plain = new ArrayList<>();
        if (input == null || input.isEmpty()) return timed;
        input=input.replace("\uFEFF","");
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
            while (matcher.find(end) && source.substring(end,matcher.start()).trim().isEmpty()) {
                int minutes = Integer.parseInt(matcher.group(1));
                int seconds = Integer.parseInt(matcher.group(2));
                if (seconds > 59) break;
                String fraction = matcher.group(3);
                long milliseconds = fraction == null ? 0 : Long.parseLong((fraction + "000").substring(0, 3));
                times.add(minutes * 60_000L + seconds * 1_000L + milliseconds);
                end = matcher.end();
            }
            String body=source.substring(end);long first=times.isEmpty()?-1:times.get(0);
            Line parsed=parseWords(first,body,offset,0);
            String text=parsed.text;
            if (!times.isEmpty()) {
                for (long time : times) {
                    timed.add(time==first?parsed:parseWords(time,body,offset,time-first));
                }
            } else if (!text.isEmpty() && !META.matcher(text).matches()) plain.add(new Line(-1, text));
        }
        if (timed.isEmpty()) return plain;
        Collections.sort(timed, new Comparator<Line>() {
            @Override public int compare(Line a, Line b) { return Long.compare(a.time, b.time); }
        });
        return timed;
    }

    private static long adjust(long time,long offset) {
        if(offset>0&&time>Long.MAX_VALUE-offset)return Long.MAX_VALUE;
        if(offset<0&&time<-offset)return 0;
        return Math.max(0,time+offset);
    }

    private static final class Segment {
        final long time,end; final int start,finish;
        Segment(long time,long end,int start,int finish){this.time=time;this.end=end;this.start=start;this.finish=finish;}
    }
    private static Line parseWords(long lineTime,String source,long offset,long repeatShift) {
        StringBuilder clean=new StringBuilder();List<Segment> segments=new ArrayList<>();
        Matcher tags=WORD_TIME.matcher(source);int cursor=0;long pending=-1,previousRaw=-1;boolean valid=true;
        while(tags.find()) {
            int seconds=Integer.parseInt(tags.group(2));if(seconds>59)continue;
            String fraction=tags.group(3);long raw=Integer.parseInt(tags.group(1))*60000L+seconds*1000L+(fraction==null?0:Long.parseLong((fraction+"000").substring(0,3)))+repeatShift,time=adjust(raw,offset);
            if(raw<previousRaw||lineTime>=0&&raw<lineTime)valid=false;previousRaw=raw;
            int start=clean.length();clean.append(source,cursor,tags.start());
            if(pending>=0){if(time<pending)valid=false;segments.add(new Segment(pending,time,start,clean.length()));}
            pending=time;cursor=tags.end();
        }
        int start=clean.length();clean.append(source,cursor,source.length());
        if(pending>=0)segments.add(new Segment(pending,-1,start,clean.length()));
        int trimStart=0,trimEnd=clean.length();while(trimStart<trimEnd&&Character.isWhitespace(clean.charAt(trimStart)))trimStart++;while(trimEnd>trimStart&&Character.isWhitespace(clean.charAt(trimEnd-1)))trimEnd--;
        String text=clean.substring(trimStart,trimEnd);List<Word> words=new ArrayList<>();
        long adjustedLine=lineTime<0?-1:adjust(lineTime,offset);
        if(lineTime>=0&&valid)for(Segment segment:segments){
            int a=Math.max(trimStart,segment.start),b=Math.min(trimEnd,segment.finish);
            while(a<b&&Character.isWhitespace(clean.charAt(a)))a++;while(b>a&&Character.isWhitespace(clean.charAt(b-1)))b--;
            if(a<b)words.add(new Word(segment.time,segment.end,text.substring(a-trimStart,b-trimStart),a-trimStart,b-trimStart));
        }
        return new Line(adjustedLine,text,words);
    }

    public static int activeWord(Line line,long position) {
        if(line==null||position<line.time)return -1;
        int active=-1;for(int i=0;i<line.words.size();i++){Word word=line.words.get(i);if(word.time>position)break;active=i;}
        if(active>=0){Word word=line.words.get(active);if(word.end>=0&&position>=word.end)return -1;}
        return active;
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
