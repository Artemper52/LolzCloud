import com.lolzcloud.mobile.OnlineCatalog;
import com.lolzcloud.mobile.Track;

/** Pure JVM URL policy checks; real JSON, UI and audio are tested on Android. */
public final class OnlineCatalogPolicyTest {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    public static void main(String[] args) {
        String audio="https://lolzcloud.com/music/audio/1930572542/bcd527cc110efa95cb49a325.mp3";
        check(OnlineCatalog.audioId(audio).equals("1930572542"),"Stable ID comes from the exact own audio route");
        check(OnlineCatalog.preparationUrl(audio).equals("https://lolzcloud.com/music/prepare/1930572542/bcd527cc110efa95cb49a325"),"Preparation reuses only the issued ID/signature on the fixed own route");
        for(String bad:new String[]{"https://evil.test/song.mp3",audio+"?token=x",audio+"#part","file:///private/song",audio.replace(".mp3","/../song.mp3")})check(OnlineCatalog.preparationUrl(bad).isEmpty(),"Untrusted audio cannot start a preparation job");
        for(String bad:new String[]{"http://lolzcloud.com/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://evil.test/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://lolzcloud.com.evil.test/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://lolzcloud.com@evil.test/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://user@lolzcloud.com/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://lolzcloud.com:444/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://lolzcloud.com/music/audio/0/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://lolzcloud.com/music/audio/01/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://lolzcloud.com/music/audio/1/aaa.mp3",audio+"?token=x",audio+"#fragment",audio+"/extra","file:///data/music.mp3","content://provider/song","javascript:alert(1)"})check(OnlineCatalog.audioId(bad).isEmpty(),"Reject foreign/malformed audio: "+bad);
        check(OnlineCatalog.isSourceUrl("https://soundcloud.com/darkprinceee/gnoy"),"Canonical SoundCloud track accepted");
        for(String bad:new String[]{"https://soundcloud.com","https://soundcloud.com/artist","https://soundcloud.com/artist/sets/playlist","https://soundcloud.com/search/sounds?q=gno","https://soundcloud.com/users/1","https://soundcloud.com/artist/../evil","https://soundcloud.com/artist/%2ftrack","https://soundcloud.com/artist/song?token=x","https://soundcloud.com.evil.test/a/b","https://on.soundcloud.com/short","https://user@soundcloud.com/a/b"})check(!OnlineCatalog.isSourceUrl(bad),"Reject service page or malformed canonical source: "+bad);
        for(String good:new String[]{"https://soundcloud.com","https://soundcloud.com/a/b","https://www.soundcloud.com/a/b","https://m.soundcloud.com/a/b","https://on.soundcloud.com/short","https://soundcloud.com/a/b#t=0:30","HTTPS://SOUNDCLOUD.COM/a/b#t=0:30"})check(OnlineCatalog.isSoundCloudAddress(good),"SoundCloud entry routes to native UI: "+good);
        for(String bad:new String[]{"https://soundcloud.com.evil.test/a/b","https://evil.test/?url=soundcloud.com","http://soundcloud.com/a/b","https://user@soundcloud.com/a/b"})check(!OnlineCatalog.isSoundCloudAddress(bad),"Foreign navigation is not a SoundCloud entry");
        check(OnlineCatalog.isCoverUrl("https://i1.sndcdn.com/artworks-example-t500x500.jpg"),"sndcdn cover accepted");
        check(OnlineCatalog.isCoverUrl("https://lolzcloud.com/music/cover/example.jpg"),"Own-host cover accepted");
        for(String bad:new String[]{"http://i1.sndcdn.com/art.jpg","https://i1.sndcdn.com.evil.test/art.jpg","https://evil.test/art.jpg","https://user@i1.sndcdn.com/art.jpg","https://i1.sndcdn.com:444/art.jpg","https://i1.sndcdn.com/a/../art.jpg","https://i1.sndcdn.com/a/%2e%2e/art.jpg","https://i1.sndcdn.com/a.jpg?url=https://evil.test","data:image/png;base64,AAAA","file:///cover.jpg"})check(!OnlineCatalog.isCoverUrl(bad),"Reject unsafe cover: "+bad);
        for(String good:new String[]{"0","20","300"})check(OnlineCatalog.isOffset(good),"Bounded numeric page accepted");
        for(String bad:new String[]{"-1","01","1","21","320","100000","9999999","https://evil.test","20&x=1","","1.5"})check(!OnlineCatalog.isOffset(bad),"Reject invalid cursor");
        check(OnlineCatalog.normalizeQuery("https://www.soundcloud.com/darkprinceee/gnoy/?si=tracking#play").equals("https://soundcloud.com/darkprinceee/gnoy"),"Full source entry strips tracking and normalizes only a canonical SoundCloud track");
        check(OnlineCatalog.normalizeQuery("  gno  ").equals("gno")&&OnlineCatalog.normalizeQuery("https://evil.test/a/b?q=x").equals("https://evil.test/a/b?q=x"),"Text query is trimmed without rewriting another origin");
        Track legacy=new Track("local-id","Local","Artist","content://provider/song",40000,1234);
        check(legacy.sourceUrl.isEmpty()&&legacy.coverUrl.isEmpty()&&legacy.addedAt==1234,"Legacy constructor remains compatible");
        Track catalog=new Track("soundcloud:1930572542","Song","Artist",audio,89000,1234,"https://soundcloud.com/darkprinceee/gnoy","https://i1.sndcdn.com/art.jpg");
        Track offline=catalog.withUri("file:///private/offline/audio",88581);
        check(offline.id.equals(catalog.id)&&offline.sourceUrl.equals(catalog.sourceUrl)&&offline.coverUrl.equals(catalog.coverUrl)&&offline.duration==88581,"Offline copy retains stable identity and attribution");
        Track hostile=new Track("id","Song","Artist",audio,1,1,"https://evil.test/source","https://evil.test/art.jpg");
        check(hostile.sourceUrl.isEmpty()&&hostile.coverUrl.isEmpty(),"Optional untrusted metadata is discarded");
        System.out.println("PASS: "+checks+" native catalog policy checks");
    }
}
