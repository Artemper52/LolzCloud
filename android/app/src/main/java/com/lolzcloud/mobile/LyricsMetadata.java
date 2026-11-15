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
    private static final String EDGE="(?<![\\p{L}\\p{N}])",END="(?![\\p{L}\\p{N}])";
    private static final String FAST="(?:sped[\\s_-]*up|speed[\\s_-]*up|night[\\s_-]*core|спид[\\s_-]*ап|найт[\\s_-]*кор|ускоренн(?:ая|ый|ое|о)?|ускорено|ускорени[ея])";
    private static final String SLOW="(?:slow(?:ed)?(?:[\\s_-]*down)?|sloued|слоу(?:д|ед)|замедленн(?:ая|ый|ое|о)?|замедлено|замедлени[ея])";
    private static final String SPACE="(?:reverb(?:ed)?|реверб(?:ераци[яи])?|echo|эхо|8d(?:\\s*audio)?)";
    private static final Pattern QUALIFIER=Pattern.compile("(?iu)"+EDGE+"(?:"+FAST+"|"+SLOW+"|"+SPACE+")"+END);
    private static final Pattern FAST_MARKER=Pattern.compile("(?iu)"+EDGE+FAST+END),SLOW_MARKER=Pattern.compile("(?iu)"+EDGE+SLOW+END);
    private static final Pattern RATIO=Pattern.compile("(?iu)"+EDGE+"(?:[xх×]\\s*(\\d+(?:[.,]\\d{1,3})?)|(\\d+(?:[.,]\\d{1,3})?)\\s*[xх×])"+END);
    private static final Pattern SNIPPET=Pattern.compile("(?iu)"+EDGE+"(?:snippet|preview|fragment|clip|loop|teaser|short(?:s)?|отрывок|фрагмент|обрезан(?:ный|ная|ное)?|тизер|сниппет|превью)"+END);

    public static final class Variant {
        public final String title;public final boolean marked,ambiguous,snippet;public final int direction;public final double explicitRate;
        private Variant(String title,boolean marked,boolean ambiguous,boolean snippet,int direction,double rate){this.title=title;this.marked=marked;this.ambiguous=ambiguous;this.snippet=snippet;this.direction=direction;this.explicitRate=rate;}
        public boolean permits(long source,long reference){double rate=(double)reference/source;return marked&&(direction!=0||explicitRate!=0)&&!ambiguous&&!snippet&&source>=20000&&reference>=20000&&rate>=.5&&rate<=2&&(direction==0||direction>0&&rate>=1.025||direction<0&&rate<=.975)&&(explicitRate==0||Math.abs(rate-explicitRate)<=Math.max(.025,explicitRate*.03));}
    }
    private static final class Segment{final String text;final boolean touched;Segment(String text,boolean touched){this.text=text;this.touched=touched;}}
    private static final class VariantScan{
        boolean fast,slow,ambiguous,touched;double rate;
        Segment strip(String input){boolean changed=false;Matcher ratio=RATIO.matcher(input);while(ratio.find()){changed=true;try{double value=Double.parseDouble((ratio.group(1)==null?ratio.group(2):ratio.group(1)).replace(',','.'));if(value<.5||value>2||rate!=0&&Math.abs(rate-value)>.001)ambiguous=true;else rate=value;}catch(NumberFormatException invalid){ambiguous=true;}}
            String text=ratio.replaceAll(" ");Matcher marker=QUALIFIER.matcher(text);while(marker.find()){changed=true;fast|=FAST_MARKER.matcher(marker.group()).matches();slow|=SLOW_MARKER.matcher(marker.group()).matches();}text=marker.replaceAll(" ");if(changed)text=text.replaceAll("(?iu)(?<![\\p{L}\\p{N}])(?:and|version|версия)(?![\\p{L}\\p{N}])"," ").replaceAll("[+|:/_-]+"," ").replaceAll("\\s+"," ").trim();touched|=changed;return new Segment(text,changed);
        }
    }
    public static Variant variant(String title){
        String input=clean(title);VariantScan scan=new VariantScan();Matcher block=Pattern.compile("\\(([^()]*)\\)|\\[([^\\[\\]]*)\\]").matcher(input);StringBuffer output=new StringBuffer();while(block.find()){Segment part=scan.strip(block.group(1)==null?block.group(2):block.group(1));block.appendReplacement(output,Matcher.quoteReplacement(part.touched?(part.text.isEmpty()?" ":"("+part.text+")"):block.group()));}block.appendTail(output);String core=output.toString();
        Pattern ratioTail=Pattern.compile("(?iu)(?:\\s|^)(?:[xх×]\\s*\\d+(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d{1,3})?\\s*[xх×])\\s*$"),markerTail=Pattern.compile("(?iu)(?:^|\\s|[-–—|+_:])(?:(?:"+FAST+"|"+SLOW+"|"+SPACE+")(?:\\s*(?:and|\\+|&|[-_])?\\s*)?)+$");
        for(int i=0;i<4;i++){boolean changed=false;Matcher ratio=ratioTail.matcher(core);if(ratio.find()){scan.strip(ratio.group());core=core.substring(0,ratio.start());changed=true;}Matcher marker=markerTail.matcher(core);if(marker.find()){scan.strip(marker.group());core=core.substring(0,marker.start());changed=true;}if(!changed)break;}
        if(scan.touched)core=SNIPPET.matcher(core).replaceAll(" ");core=core.replaceAll("\\s+"," ").replaceAll("^[\\s\\-–—|+&/]+|[\\s\\-–—|+&/]+$", "").trim();boolean snippet=SNIPPET.matcher(input).find();
        if(normal(core).isEmpty())return new Variant(input,false,false,snippet,0,0);if(scan.rate>1.025)scan.fast=true;else if(scan.rate>0&&scan.rate<.975)scan.slow=true;return new Variant(core,scan.touched,scan.ambiguous||scan.fast&&scan.slow,snippet,scan.fast?1:scan.slow?-1:0,scan.rate);
    }
    private static boolean onlyQualifier(String value){VariantScan scan=new VariantScan();Segment part=scan.strip(value);return part.touched&&normal(part.text).isEmpty();}

    public static final class Query {
        public final String title, artist,rawTitle;
        public final long duration;
        public final long identityRevision;
        public final Variant variant;
        public Query(String title, String artist, long duration) {
            this(title,artist,duration,title);
        }
        public Query(String title,String artist,long duration,String rawTitle){this(title,artist,duration,rawTitle,0);}
        private Query(String title,String artist,long duration,String rawTitle,long revision){this.title=clean(title);this.artist=clean(artist);this.duration=Math.max(0,duration);this.rawTitle=clean(rawTitle);identityRevision=revision;Variant source=variant(this.rawTitle),named=variant(this.title);this.variant=new Variant(named.title,source.marked||named.marked,source.ambiguous||named.ambiguous,source.snippet||named.snippet,source.marked?source.direction:named.direction,source.explicitRate!=0?source.explicitRate:named.explicitRate);}
        public Query revision(long revision){return new Query(title,artist,duration,rawTitle,revision);}
        public boolean usable() { return !normal(title).isEmpty() && (!variant.marked||!normal(variant.title).isEmpty()) && !artists(artist).isEmpty() && title.length() <= 300 && artist.length() <= 300; }
        public String key() { return "tempo-v1\n"+normal(title) + "\n" + normal(artist) + "\n" + duration+"\n"+normal(rawTitle)+"\n"+identityRevision; }
        public String canonicalKey(){return normal(variant.title)+"\n"+normal(artist);}
    }

    public static List<Query> candidates(String title, String artist, long duration) {
        return candidates(title,artist,duration,title);
    }
    public static List<Query> candidates(String title,String artist,long duration,String rawTitle){
        String name = clean(title), performer = unknown(artist) ? "" : clean(artist);
        Matcher dash = DASH.matcher(name);
        if (dash.matches() && sameArtists(dash.group(1), performer)) {
            performer = dash.group(1); name = dash.group(2);
        }
        Matcher featuring=Pattern.compile("(?iu)^(.+?)\\s+(?:\\+|feat\\.?|ft\\.?)\\s+(.+)$").matcher(name);
        if(featuring.matches()&&!VERSION.matcher(featuring.group(2)).find()&&!variant(featuring.group(2)).marked&&!onlyQualifier(featuring.group(2))){
            name=featuring.group(1);performer=performer.isEmpty()?featuring.group(2):performer+", "+featuring.group(2);
        }
        List<Query> result = new ArrayList<>(); Set<String> seen = new LinkedHashSet<>();
        dash=DASH.matcher(name);
        if(dash.matches()&&variant(rawTitle).marked&&!VERSION.matcher(dash.group(1)).find()&&!onlyQualifier(dash.group(2)))add(result,seen,new Query(dash.group(2),dash.group(1),duration,rawTitle));
        add(result, seen, new Query(name, performer, duration,rawTitle));
        dash = DASH.matcher(name);
        if (dash.matches() && !VERSION.matcher(name).find()) {
            add(result, seen, new Query(dash.group(2), dash.group(1), duration,rawTitle));
            add(result, seen, new Query(dash.group(1), dash.group(2), duration,rawTitle));
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
