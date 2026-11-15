import com.lolzcloud.mobile.LrcParser;
import java.util.List;

/** Dependency-free behavior checks: javac LrcParser.java + this file, then java LrcParserTest. */
public final class LrcParserTest {
    private static int checks;
    private static void check(boolean value, String message) {
        checks++;
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        List<LrcParser.Line> lines = LrcParser.parse("[offset:-500]\n[00:02.12][01:02.123]Повтор\n[00:01.5]Первый");
        check(lines.size() == 3, "Repeated timestamps must survive");
        check(lines.get(0).time == 1000 && lines.get(0).text.equals("Первый"), "Offset, fraction and sorting");
        check(lines.get(1).time == 1620 && lines.get(2).time == 61623, "Two and three digit fractions");
        check(LrcParser.activeLine(lines, 999) == -1, "No lyric activates before its timestamp");
        check(LrcParser.activeLine(lines, 1620) == 1, "Exact timestamp is active");
        check(LrcParser.activeLine(lines, 999999) == 2, "Final line remains active");
        List<LrcParser.Line> plain = LrcParser.parse("[ar:Artist]\nHello\nWorld");
        check(plain.size() == 2 && plain.get(0).time == -1, "Plain lyrics remain untimed; tags are metadata");
        check(LrcParser.activeLine(plain, 100000) == -1, "Plain lyrics never fake synchronization");
        check(LrcParser.parse(null).isEmpty(), "Null is empty");
        check(LrcParser.parse("[00:00.01]Start").get(0).time == 10, "Centisecond timing");
        check(LrcParser.parse("[offset:-5000]\n[00:01]Start").get(0).time == 0, "Negative offsets clamp to zero");
        check(LrcParser.parse("\uFEFF[offset:500]\n[00:01]<00:01>Start").get(0).words.get(0).time==1500,"A UTF-8 BOM before offset metadata cannot hide the real word/line offset");
        check(LrcParser.parse("[00:01.00]<00:01.00>Real <00:01.50>words").get(0).text.equals("Real words"), "Enhanced LRC word tags do not leak into readable line text");
        LrcParser.Line enhanced=LrcParser.parse("[offset:250]\n[00:01.00]  <00:01.00>Привет <00:01.50>мир<00:02.00>  ").get(0);
        check(enhanced.time==1250&&enhanced.text.equals("Привет мир")&&enhanced.words.size()==2,"Enhanced data retains real words with clean trimmed text");
        check(enhanced.words.get(0).time==1250&&enhanced.words.get(1).time==1750&&enhanced.words.get(1).end==2250,"Offset applies to both word starts and explicit ends exactly once");
        check(enhanced.words.get(0).text.equals("Привет")&&enhanced.words.get(0).startOffset==0&&enhanced.words.get(0).endOffset==6,"Word spans refer to real UTF-16 positions in clean text");
        check(enhanced.words.get(1).startOffset==7&&enhanced.text.substring(enhanced.words.get(1).startOffset,enhanced.words.get(1).endOffset).equals("мир"),"Trim and spaces never move highlights onto another word");
        check(LrcParser.activeWord(enhanced,1249)==-1&&LrcParser.activeWord(enhanced,1250)==0,"A word only starts at its source timestamp");
        check(LrcParser.activeWord(enhanced,1749)==0&&LrcParser.activeWord(enhanced,1750)==1,"Exact next-word boundaries use source milliseconds");
        check(LrcParser.activeWord(enhanced,2250)==-1,"An explicit final end marker stops the final highlight");
        boolean immutable=false;try{enhanced.words.clear();}catch(UnsupportedOperationException expected){immutable=true;}check(immutable,"Parsed word data cannot be mutated after publication");
        LrcParser.Line unclosed=LrcParser.parse("[00:01]<00:01>One <00:02>two").get(0);
        check(unclosed.words.get(1).end==-1&&LrcParser.activeWord(unclosed,2500)==1,"Missing final end remains unknown rather than invented");
        List<LrcParser.Line> repeated=LrcParser.parse("[00:01][00:11]<00:01>One <00:02>two<00:03>");
        check(repeated.size()==2&&repeated.get(1).words.get(0).time==11000&&repeated.get(1).words.get(1).time==12000,"Repeated explicit line anchors preserve relative enhanced timestamps");
        repeated=LrcParser.parse("[offset:-5000]\n[00:01][00:11]<00:01>One <00:02>two<00:03>");
        check(repeated.get(0).time==0&&repeated.get(1).time==6000&&repeated.get(1).words.get(1).time==7000,"Repeated words shift before negative-offset clamping, so later occurrences keep their original intervals");
        check(LrcParser.parse("[00:01]<00:02>One <00:01.5>two").get(0).words.isEmpty(),"Backward word timing falls back to the valid timed line");
        check(LrcParser.parse("[00:02]<00:01>Early word").get(0).words.isEmpty(),"Word timestamps before their line are never presented as synchronized words");
        check(LrcParser.parse("<00:01>Plain <00:02>words").get(0).words.isEmpty(),"Standalone word tags without a line anchor do not invent a timed line");
        check(LrcParser.parse("[00:99]Malformed").get(0).time==-1,"Malformed leading timestamps cannot cause a parser loop");
        check(LrcParser.parse("[00:01]Text [03:00] in lyric").get(0).text.equals("Text [03:00] in lyric"),"A timestamp-looking literal inside the words never erases the preceding lyric");
        LrcParser.Line emoji=LrcParser.parse("[00:01]<00:01>🎵 <00:02>音").get(0);
        check(emoji.words.get(1).startOffset==3&&emoji.words.get(1).text.equals("音"),"Supplementary Unicode uses TextView-compatible UTF-16 offsets");
        System.out.println("LRC parser: " + checks + " behavior checks passed");
    }
    private LrcParserTest() { }
}
