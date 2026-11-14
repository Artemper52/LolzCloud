package com.lolzcloud.mobile;

import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Declared source text only; no commercial lyric is embedded in the fixtures. */
public final class LyricsProviderTest {
    private static int checks;
    private static final LyricsMetadata.Query SONG=new LyricsMetadata.Query("Fixture Song","Fixture Singer",100000);
    private static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    private static JSONObject record(String title,String artist,double duration,String timed,String plain)throws Exception{
        return new JSONObject().put("id",42).put("trackName",title).put("artistName",artist).put("duration",duration).put("instrumental",false).put("syncedLyrics",timed==null?JSONObject.NULL:timed).put("plainLyrics",plain==null?JSONObject.NULL:plain);
    }
    private static JSONObject same(String timed,String plain)throws Exception{return record("Fixture Song","Fixture Singer",100,timed,plain);}
    private static LyricsProvider.Result match(JSONObject row){return LyricsProvider.match(row,SONG);}
    private static LyricsProvider.Response reply(int status,String body){return new LyricsProvider.Response(status,body,"");}
    private static final class Script implements LyricsProvider.Transport{
        final ArrayDeque<Object> rows=new ArrayDeque<>();final List<String> paths=new ArrayList<>();
        Script(Object... values){rows.addAll(Arrays.asList(values));}
        public LyricsProvider.Response get(String path,long deadline)throws IOException{paths.add(path);if(rows.isEmpty())throw new IOException("Declared fixture exhausted");Object value=rows.remove();if(value instanceof IOException)throw(IOException)value;return(LyricsProvider.Response)value;}
    }
    public static void main(String[] args)throws Exception{
        LyricsProvider.Result result=match(same("[00:02.10]First fixture\n[00:04.20]Second fixture","First fixture\nSecond fixture"));
        check(result.found()&&result.timed&&LrcParser.parse(result.text).get(0).time==2100,"A matched recording keeps real source line timestamps");
        check(!match(record("Other Song","Fixture Singer",100,"[00:02]Wrong",null)).found(),"Different title cannot supply lyrics");
        check(!match(record("Fixture Song","Other Singer",100,"[00:02]Wrong",null)).found(),"Different artist cannot supply lyrics");
        check(!match(record("Fixture Song (remix)","Fixture Singer",100,"[00:02]Wrong",null)).found(),"A remix cannot silently replace the original");
        result=match(record("Fixture Song","Fixture Singer",150,"[00:02]Written fixture",null));
        check(result.found()&&!result.timed&&result.versionMismatch&&result.text.equals("Written fixture"),"Shortened upload can use written words but never another duration's timings");
        result=LyricsProvider.match(same("[00:02]Written fixture",null),new LyricsMetadata.Query("Fixture Song","Fixture Singer",0));
        check(result.found()&&!result.timed,"Unknown playback duration receives only unsynchronized text");
        result=match(same("[02:01]Out-of-recording fixture","Readable fixture"));
        check(!result.timed&&result.text.equals("Readable fixture"),"Out-of-range line times degrade to honest plain text");
        result=match(same(null,"[00:04]Literal plain source"));
        check(!result.timed&&LyricsRepository.lines(result).get(0).time==-1,"Plain provider text cannot become synchronized merely by resembling an LRC tag");
        result=match(same(null,null).put("instrumental",true));check(result.instrumental&&!result.found(),"A matched instrumental is distinct from missing lyrics");
        result=match(record("Fixture Song","Fixture Singer",150,null,null).put("instrumental",true));check(!result.instrumental,"A different version cannot mark this recording instrumental");
        check(!match(same(null,null).put("duration","100")).found(),"Malformed numeric metadata is rejected");
        check(!match(same(null,"Text").put("trackName",JSONObject.NULL)).found(),"Malformed title is rejected");
        check(!match(same(null,new String(new char[LyricsProvider.TEXT_LIMIT+1]).replace('\0','x'))).found(),"Oversized source text is bounded");
        Script exact=new Script(reply(200,same("[00:02]Fixture",null).toString()));
        result=new LyricsProvider(exact).lookup(Arrays.asList(SONG));check(result.timed&&exact.paths.size()==1&&exact.paths.get(0).contains("duration=100.000"),"Exact metadata lookup includes duration in seconds and avoids unnecessary fallback");
        Script fallback=new Script(reply(500,""),reply(200,"["+same("[00:02]Fixture",null)+"]"));
        result=new LyricsProvider(fallback).lookup(Arrays.asList(SONG));check(result.timed&&fallback.paths.get(1).startsWith("/api/search?"),"An exact endpoint failure does not disable a working search endpoint");
        Script plainThenSynced=new Script(reply(200,same(null,"Plain fixture").toString()),reply(200,"["+same("[00:03]Timed fixture",null)+"]"));
        check(new LyricsProvider(plainThenSynced).lookup(Arrays.asList(SONG)).timed,"A plain exact match still allows discovery of genuine synchronized lyrics");
        Script none=new Script(reply(404,""),reply(200,"[]"));result=new LyricsProvider(none).lookup(Arrays.asList(SONG));check(!result.found()&&!result.instrumental,"A successful empty catalogue is a neutral no-result");
        Script bad=new Script(reply(200,"not json"),reply(200,"{}"));boolean failed=false;try{new LyricsProvider(bad).lookup(Arrays.asList(SONG));}catch(IOException expected){failed=true;}check(failed,"Malformed API responses are errors, never a fake empty or success");
        Script limited=new Script(new LyricsProvider.Response(429,"edge rejection need not be JSON","2"));LyricsProvider limitedProvider=new LyricsProvider(limited);failed=false;
        try{limitedProvider.lookup(Arrays.asList(SONG));}catch(LyricsProvider.Failure expected){failed=expected.retryAt>=System.currentTimeMillis()+1000;}check(failed&&limited.paths.size()==1,"HTTP429 respects Retry-After even when the edge body is not JSON");
        try{limitedProvider.lookup(Arrays.asList(SONG));}catch(LyricsProvider.Failure expected){}check(limited.paths.size()==1,"Explicit retry cannot bypass the provider's cooldown");
        Script redirects=new Script(reply(302,""),reply(302,""));failed=false;try{new LyricsProvider(redirects).lookup(Arrays.asList(SONG));}catch(IOException expected){failed=true;}check(failed&&redirects.paths.size()==2,"Redirects are failures and only fixed-origin fallback paths are requested");
        final LyricsProvider[] cancelled={null};cancelled[0]=new LyricsProvider((path,deadline)->{cancelled[0].cancel();return reply(200,"[]");});failed=false;
        try{cancelled[0].lookup(Arrays.asList(SONG));}catch(java.io.InterruptedIOException expected){failed=true;}check(failed,"A cancelled in-flight result cannot become a later track's lyrics");
        check(LyricsProvider.retryMillis("60",0,1000)==60000,"Retry-After seconds are honored");
        check(LyricsProvider.retryMillis("9999999999",0,1000)==604800000,"Very large retry headers cannot overflow to immediate retries");
        check(LyricsProvider.retryMillis("not-a-date",0,60000)==60000,"Malformed retry header uses a bounded conservative delay");
        if(args.length>0&&args[0].equals("--live")){
            LyricsProvider.Result live=new LyricsProvider("development-lyrics-check").lookup(LyricsMetadata.candidates("I Want to Live","Borislav Slavov",233000));
            check(live.found()||live.instrumental,"Real public HTTPS provider returns a matching documented recording");
            System.out.println("Live LRCLIB metadata match: text="+live.found()+", synced="+live.timed+", lines="+LyricsRepository.lines(live).size()+" (source text not printed)");
        }
        System.out.println("Lyrics provider: "+checks+" behavior checks passed");
    }
}
