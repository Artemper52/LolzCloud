import com.lolzcloud.mobile.LyricsMetadata;
import java.util.List;

public final class LyricsMetadataTest {
    private static int checks;
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    public static void main(String[] args){
        List<LyricsMetadata.Query> rows=LyricsMetadata.candidates("Singer - Song (Official Audio)","Singer",100000);
        check(rows.size()==1&&rows.get(0).title.equals("Song")&&rows.get(0).artist.equals("Singer"),"Uploader title prefix is removed only when it identifies the known artist");
        rows=LyricsMetadata.candidates("Singer - Song.mp3","Неизвестный исполнитель",100000);
        check(rows.size()==2&&rows.get(0).title.equals("Song")&&rows.get(0).artist.equals("Singer"),"Filename with unknown tags yields explicit artist-title candidate");
        check(LyricsMetadata.candidates("Song","Неизвестный исполнитель",100000).isEmpty(),"Missing artist never accepts an arbitrary same-title recording");
        check(LyricsMetadata.candidates("Song - Slowed","Uploader",100000).size()==1,"A version label is never guessed as an artist");
        rows=LyricsMetadata.candidates("Song feat. Guest","Singer",100000);
        check(rows.get(0).title.equals("Song")&&rows.get(0).artist.equals("Singer, Guest"),"Featured performers in an upload title remain part of its identity");
        check(LyricsMetadata.clean("Song @tg: promotion").equals("Song"),"Telegram promotion is not part of a recording name");
        check(LyricsMetadata.clean("Song (prod. Fixture)").equals("Song"),"Production annotations are removed without removing the song name");
        check(LyricsMetadata.sameTitle("𝐒.𝐓.𝐀.𝐋’","S.T.A.L"),"Decorative compatibility letters compare to real metadata");
        check(LyricsMetadata.sameArtists("тёмный принц","ТЕМНЫЙ ПРИНЦ"),"Cyrillic ё/case variations match");
        check(LyricsMetadata.sameArtists("Singer feat. Guest","Singer"),"Catalogue omission of a featured performer can still match");
        check(!LyricsMetadata.sameArtists("Singer, Guest A","Singer, Guest B"),"Different explicit collaborations do not match");
        check(!LyricsMetadata.sameArtists("Singer","Another Singer"),"An uploader or unrelated artist is not substring-matched");
        for(String version:new String[]{"(remix)","(slowed)","(live)","(cover)","(sped up)","(reverb)"})check(!LyricsMetadata.sameTitle("Song "+version,"Song"),"Recording version survives cleanup: "+version);
        check(LyricsMetadata.durationMatches(100000,102000),"Documented two-second duration tolerance is accepted");
        check(!LyricsMetadata.durationMatches(100000,102001),"Timings from a different recording duration are rejected");
        check(!LyricsMetadata.durationMatches(0,100000),"Unknown duration cannot authorize synchronized timestamps");
        check(!new LyricsMetadata.Query("","Singer",1000).usable(),"An empty title cannot start a lookup");
        check(!new LyricsMetadata.Query("Song",new String(new char[301]).replace('\0','a'),1000).usable(),"Unbounded metadata cannot enter a request");
        check(!new LyricsMetadata.Query("Song","Singer",100000).key().equals(new LyricsMetadata.Query("Song","Singer",43000).key()),"Short edits do not reuse the full-recording cache key");
        System.out.println("Lyrics metadata: "+checks+" behavior checks passed");
    }
}
