import com.lolzcloud.mobile.LinkPolicy;
import java.io.IOException;

public final class LinkPolicyTest {
    private static int checks;
    public static void main(String[] args) throws Exception {
        String id = "0123456789abcdef0123456789abcdef";
        accept("https://lolzcloud.com/room/" + id, "room", "https://lolzcloud.com/room/" + id);
        accept("  HTTPS://LOLZCLOUD.COM:443/remote/" + id.toUpperCase() + "/?from=share#open  ", "remote", "https://lolzcloud.com/remote/" + id);
        for (String address : new String[]{"", "https://lolzcloud.com/room/…", "http://lolzcloud.com/room/" + id,
                "https://lolzcloud.com:8443/room/" + id, "https://lolzcloud.com.evil.example/room/" + id,
                "https://evil.example@lolzcloud.com/room/" + id, "https://lolzcloud.com@evil.example/room/" + id,
                "https://lolzcloud.com/remote/" + id, "https://lolzcloud.com/room/" + id + "/extra",
                "https://lolzcloud.com/room/" + id.substring(1), "https://lolzcloud.com/room/" + id + "0",
                "https://lolzcloud.com/room/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "https://lolzcloud.com/room/%30" + id.substring(1),
                "https://lolzcloud.com/room/" + id + "\nhttps://evil.example", "lolzcloud.com/room/" + id}) reject(address, "room");
        reject("https://lolzcloud.com/room/" + id, "remote");
        reject("https://lolzcloud.com/room/" + id, "unknown");
        System.out.println("PASS: " + checks + " invitation and remote URL cases");
    }
    private static void accept(String address, String kind, String expected) throws Exception {
        if (!expected.equals(LinkPolicy.lolzCloud(address, kind))) throw new AssertionError(address); checks++;
    }
    private static void reject(String address, String kind) throws Exception {
        try { LinkPolicy.lolzCloud(address, kind); throw new AssertionError("Accepted " + address); }
        catch (IOException expected) { checks++; }
    }
}
