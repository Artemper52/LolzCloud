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
        check(LrcParser.parse("[00:01.00]<00:01.00>Real <00:01.50>words").get(0).text.equals("Real words"), "Enhanced LRC word tags do not leak into readable line text");
        System.out.println("LRC parser: " + checks + " behavior checks passed");
    }
    private LrcParserTest() { }
}
