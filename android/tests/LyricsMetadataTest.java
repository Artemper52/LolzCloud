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
        for(String marker:new String[]{"speedup","sped up","speed up","nightcore","спид ап","ускоренная"}){LyricsMetadata.Variant variant=LyricsMetadata.variant("Song ("+marker+")");check(variant.marked&&variant.direction==1&&LyricsMetadata.sameTitle(variant.title,"Song"),"Explicit speed qualifier is separated from identity: "+marker);}
        for(String marker:new String[]{"slowed","slowed down","замедленная","слоуд"}){LyricsMetadata.Variant variant=LyricsMetadata.variant("Song ["+marker+"]");check(variant.marked&&variant.direction==-1&&LyricsMetadata.sameTitle(variant.title,"Song"),"Explicit slowed qualifier is separated from identity: "+marker);}
        check(LyricsMetadata.sameTitle(LyricsMetadata.variant("Song (slowed + reverb)").title,"Song"),"Combined tempo/space qualifiers leave no empty bracket or joiner identity");
        for(String version:new String[]{"remix","live","cover","mashup"})check(LyricsMetadata.normal(LyricsMetadata.variant("Song ("+version+") (speedup)").title).equals("song"+version),"Canonical tempo identity retains distinct recording: "+version);
        rows=LyricsMetadata.candidates("Singer - Song (speedup)","Reupload account",80000);check(rows.get(0).artist.equals("Singer")&&rows.get(0).variant.title.equals("Song")&&rows.get(0).rawTitle.contains("speedup"),"Marked reupload title yields its explicit artist while retaining raw tempo metadata");
        check(!LyricsMetadata.variant("Song (speedup slowed)").permits(80000,100000),"Conflicting direction markers never authorize retiming");
        check(!LyricsMetadata.variant("Song (speedup) snippet").permits(80000,100000),"A preview/snippet marker blocks inferred full-recording synchronization");
        check(!LyricsMetadata.variant("Song (speedup)").permits(19000,30000),"Short source snippets do not authorize duration-derived timing");
        check(!LyricsMetadata.variant("Song (slowed)").permits(80000,100000),"Duration ratio must agree with explicit slowed direction");
        check(LyricsMetadata.variant("Song (speedup x1.25)").permits(80000,100000)&&!LyricsMetadata.variant("Song (speedup x1.25)").permits(80000,120000),"An explicit ratio narrows compatible original duration clusters");
        check(!new LyricsMetadata.Query("Song","Singer",100000).revision(1).key().equals(new LyricsMetadata.Query("Song","Singer",100000).revision(2).key()),"Explicit manual identity revisions invalidate only their own result context");
        rows=LyricsMetadata.candidates("Song + speedup","Singer",80000);check(rows.get(0).artist.equals("Singer")&&rows.get(0).variant.title.equals("Song"),"A speedup qualifier after a plus sign is not misidentified as a featured artist");
        for(String literal:new String[]{"Slow Dance","Nightcore Dreams","Speed Up The World"})check(!LyricsMetadata.variant(literal).marked&&LyricsMetadata.variant(literal).title.equals(literal),"Literal words in a song name are not stripped as tempo qualifiers: "+literal);
        check(LyricsMetadata.variant("Slow J - Song (speedup)").direction==1&&!LyricsMetadata.variant("Slow J - Song (speedup)").ambiguous,"An artist name containingSlow is not a conflicting tempo qualifier");
        check(LyricsMetadata.variant("Song x1.25").permits(80000,100000),"Explicit ratio suffix alone can identify a controlled tempo variant");
        check(!LyricsMetadata.variant("Song (reverb)").permits(80000,100000),"Reverb alone never proves that a duration difference came from tempo");
        System.out.println("Lyrics metadata: "+checks+" behavior checks passed");
    }
}
