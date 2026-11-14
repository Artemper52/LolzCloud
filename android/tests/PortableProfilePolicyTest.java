import com.lolzcloud.mobile.OnlineCatalog;
import com.lolzcloud.mobile.PortableProfile;
import com.lolzcloud.mobile.PortableAudioCurve;
import com.lolzcloud.mobile.Track;
import com.lolzcloud.mobile.ProfileJson;

/** Real JSON, preference transactions and SAF are deliberately tested on Android separately. */
public final class PortableProfilePolicyTest {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    private static void near(double value, double expected, String label) { check(Math.abs(value - expected) < .000001, label); }
    private static void rejected(Runnable operation, String label) { boolean denied = false; try { operation.run(); } catch (IllegalArgumentException expected) { denied = true; } check(denied, label); }
    public static void main(String[] args) throws Exception {
        ProfileJson.requireObject(" {\"unicode\":\"Текст 🎵 \\u0410\",\"array\":[-1.25e2,true,false,null,{}]} ");
        check(true, "Strict JSON accepts real Unicode, escapes, exponent numbers and nested portable data");
        for (String json : new String[]{"[]", "null", "{}junk", "{}{}", "{a:1}", "{'a':1}", "{\"a\":01}", "{\"a\":NaN}", "{\"a\":Infinity}", "{\"a\":1e999}", "{\"a\":[1,]}", "{\"a\":1,}", "{\"a\":/*x*/1}", "{\"a\":\"\\uGGGG\"}", "{\"a\":\"\\q\"}", "{\"a\":\"line\nfeed\"}", "{\"a\":.5}", "{\"a\":1.}", "{\"a\":+1}", "{"}) { boolean denied = false; try { ProfileJson.requireObject(json); } catch (java.io.IOException expected) { denied = true; } check(denied, "Reject lenient/corrupt JSON before Android parsing"); }
        StringBuilder deep = new StringBuilder("{\"unknown\":"); for (int i=0;i<100;i++) deep.append('['); deep.append('0'); for(int i=0;i<100;i++)deep.append(']');deep.append('}');
        boolean depthDenied=false;try{ProfileJson.requireObject(deep.toString());}catch(java.io.IOException expected){depthDenied=true;}check(depthDenied,"An unknown deeply nested field cannot exhaust Android's recursive JSONTokener");
        String source = "https://soundcloud.com/darkprinceee/gnoy";
        Track numeric = Track.catalogReference("1930572542", source, "Song", "Artist", 89000, "");
        check(numeric.isCatalogReference() && numeric.uri.isEmpty() && numeric.id.equals("soundcloud:1930572542"), "A numeric imported identity is a reference with no playable URI");
        check(OnlineCatalog.audioId(numeric.uri).isEmpty() && OnlineCatalog.preparationUrl(numeric.uri).isEmpty(), "A reference cannot be sent to the MP3 prepare route");
        Track alias = Track.catalogReference("", source, "Other title", "Other artist", 0, "");
        check(alias.id.equals(Track.catalogReference("", source, "Title changed", "", 4, "").id), "Permalink aliases are independent of mutable display metadata");
        check(!alias.id.equals(Track.catalogReference("", "https://soundcloud.com/artist/another", "", "", 0, "").id), "Different canonical recordings cannot share an alias");
        for (String id : new String[]{"0", "01", "-1", "1930572542/x", "1?signature=other", "99999999999999999"}) rejected(() -> Track.catalogReference(id, source, "", "", 0, ""), "Reject malformed numeric reference " + id);
        for (String url : new String[]{"file:///data/private", "content://provider/audio", "https://evil.test/a/b", source + "?secret=x", "https://user@soundcloud.com/a/b", "https://soundcloud.com/a/sets/album"}) rejected(() -> Track.catalogReference("", url, "", "", 0, ""), "Reject non-track reference " + url);
        check(PortableProfile.media("https://www.soundcloud.com/artist/song/?si=tracking", false).equals("https://soundcloud.com/artist/song"), "Portable links remove service tracking rather than exporting it");
        check(PortableProfile.media("https://youtu.be/abcdefghijk", false).equals("https://music.youtube.com/watch?v=abcdefghijk"), "YouTube portable identity has a canonical source without pretending to be native MP3");
        check(PortableProfile.media("https://youtube.com/embed/abcdefghijk", false).equals("https://music.youtube.com/watch?v=abcdefghijk"), "Embed identity canonicalizes without a browser or network action");
        for (String url : new String[]{"file:///private/audio.mp3", "content://files/1", "lolzcloud-local://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "https://user:pass@soundcloud.com/a/b", "https://soundcloud.com:444/a/b", "https://soundcloud.com/a/../b"}) check(PortableProfile.media(url, true).isEmpty(), "Private/malformed portable URL is rejected: " + url);
        double[] curve = {-12, -6, 0, 6, 12};
        for (int i = 0; i < curve.length; i++) near(PortableAudioCurve.at(PortableAudioCurve.FREQUENCIES, curve, PortableAudioCurve.FREQUENCIES[i]), curve[i], "Canonical gain is exact at its own center");
        near(PortableAudioCurve.at(PortableAudioCurve.FREQUENCIES, new double[]{-12, 12, 0, 0, 0}, Math.sqrt(60 * 230)), 0, "The geometric midpoint has the midpoint dB, not a linear-frequency slope");
        near(PortableAudioCurve.at(PortableAudioCurve.FREQUENCIES, curve, 20), -12, "Native bands below 60Hz keep the low shelf");
        near(PortableAudioCurve.at(PortableAudioCurve.FREQUENCIES, curve, 24000), 12, "Native bands above 14kHz keep the high shelf");
        check(PortableAudioCurve.nativeLevel(curve, 3600, (short)-1500, (short)1500) == 600, "dB converts to native millibels exactly once");
        check(PortableAudioCurve.nativeLevel(curve, 14000, (short)-600, (short)600) == 600, "A narrow device range clamps the applied result while desired gains remain intact");
        check(PortableAudioCurve.nativeLevel(curve, 60, (short)0, (short)1000) == 0 && curve[0] == -12, "An asymmetric device cannot overwrite the desired portable curve");
        rejected(() -> PortableAudioCurve.nativeLevel(new double[]{0, 0, Double.NaN, 0, 0}, 60, (short)-1000, (short)1000), "Nonfinite gain cannot reach native DSP");
        rejected(() -> PortableAudioCurve.nativeLevel(new double[]{0, 0, 13, 0, 0}, 60, (short)-1000, (short)1000), "Out-of-contract gain cannot reach native DSP");
        rejected(() -> PortableAudioCurve.nativeLevel(curve, 0, (short)-1000, (short)1000), "Invalid native frequency is not represented as a successfully mapped band");
        rejected(() -> PortableAudioCurve.at(new double[]{60, 60}, new double[]{1, 2}, 100), "Duplicated native centers fail safely");
        System.out.println("PASS: " + checks + " portable policy checks");
    }
}
