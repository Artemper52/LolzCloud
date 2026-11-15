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
        result=LyricsProvider.match(same("[00:02]Fixture",null),new LyricsMetadata.Query("Fixture Song","Fixture Singer",100072));check(result.timed&&result.duration==100072&&result.referenceDuration==100000,"Cache source duration keeps real decoder jitter separate from LRCLIB reference duration");
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
        LyricsMetadata.Query speed=new LyricsMetadata.Query("Fixture Song (speedup)","Fixture Singer",80000);
        JSONObject original=same("[00:10.000]<00:10.500>Original fixture\n[01:20.000]Last fixture",null);
        Script marked=new Script(reply(200,"["+original+"]"));result=new LyricsProvider(marked).lookup(Arrays.asList(speed));
        check(result.timed&&result.adapted&&Math.abs(result.adaptationRate-1.25)<.000001&&result.referenceDuration==100000&&result.duration==80000,"A verified marked speedup adapts by original/source duration instead of native playback speed");
        check(LrcParser.parse(result.text).get(0).time==8000&&result.text.contains("<00:08.400>"),"Line and enhanced word timestamps are divided by the source ratio exactly once");
        check(marked.paths.size()==1&&marked.paths.get(0).startsWith("/api/search?")&&!marked.paths.get(0).contains("speedup")&&!marked.paths.get(0).contains("duration="),"Marked versions use one cleaned canonical search and avoid an expensive wrong-duration get");
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original).put(record("Fixture Song (speedup)","Fixture Singer",80,"[00:03]Exact version fixture",null)),speed);
        check(result.timed&&!result.adapted&&LrcParser.parse(result.text).get(0).time==3000,"Exact modified recording and matching duration win over inferred original timing");
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original),new LyricsMetadata.Query("Fixture Song (slowed)","Fixture Singer",125000));check(result.adapted&&Math.abs(result.adaptationRate-.8)<.000001&&LrcParser.parse(result.text).get(0).time==12500,"Slowed source uses the reciprocal duration ratio consistently");
        org.json.JSONArray ambiguous=new org.json.JSONArray().put(original).put(record("Fixture Song","Fixture Singer",120,"[00:10]Alternative original fixture",null));result=LyricsProvider.selectVariant(ambiguous,speed);check(result.found()&&!result.timed&&!result.adapted,"Multiple plausible original duration clusters produce readable words without arbitrary timing");
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original).put(record("Fixture Song","Fixture Singer",120,null,"Alternative written fixture")),speed);check(result.found()&&!result.timed,"A conflicting canonical duration cluster still blocks guessed timing when it contains only plain text");
        result=LyricsProvider.selectVariant(ambiguous,new LyricsMetadata.Query("Fixture Song (speedup x1.25)","Fixture Singer",80000));check(result.adapted&&result.referenceDuration==100000,"Consistent explicit ratio selects the original duration cluster");
        org.json.JSONArray consensus=new org.json.JSONArray();for(int i=1;i<=5;i++)consensus.put(record("Fixture Song","Fixture Singer",111,"[00:10]Consensus fixture\n[01:39.52]Last fixture",null).put("id",i));int[] pollution={98,125,67,175,180,102,146,73};for(int i=0;i<pollution.length;i++)consensus.put(record("Fixture Song","Fixture Singer",pollution[i],"[00:10]Catalogue fixture\n[01:39.52]Last fixture",null).put("id",i+6));
        LyricsMetadata.Query curated=new LyricsMetadata.Query("Fixture Song (speedup)","Fixture Singer",93000);result=LyricsProvider.selectVariant(consensus,curated);check(result.adapted&&result.referenceDuration==111000&&Math.abs(result.adaptationRate-111d/93)<.000001&&result.referenceEvidence.equals("catalog-consensus"),"Five unique111s records dominate polluted canonical durations for a93s source under strict3x/40percent consensus");
        result=LyricsProvider.selectVariant(consensus,new LyricsMetadata.Query("Fixture Song (sped up)","Fixture Singer",86000));check(result.adapted&&Math.abs(result.adaptationRate-111d/86)<.000001,"The same corroborated111s consensus adapts an86s upload without another source request");
        result=LyricsProvider.selectVariant(consensus,new LyricsMetadata.Query("Fixture Song (slowed)","Fixture Singer",139000));check(result.adapted&&Math.abs(result.adaptationRate-111d/139)<.000001,"The same111s consensus adapts the139s slowed variant in the opposite direction");
        org.json.JSONArray duplicates=new org.json.JSONArray();for(int i=0;i<5;i++)duplicates.put(record("Fixture Song","Fixture Singer",100,"[00:10]Duplicate fixture",null).put("id",1));duplicates.put(record("Fixture Song","Fixture Singer",120,"[00:10]Other fixture",null).put("id",2));result=LyricsProvider.selectVariant(duplicates,speed);check(result.found()&&!result.timed,"Duplicate rows of one catalogue ID cannot manufacture strong duration consensus");
        org.json.JSONArray weak=new org.json.JSONArray();for(int i=1;i<=3;i++)weak.put(record("Fixture Song","Fixture Singer",100,"[00:10]Weak fixture",null).put("id",i));for(int i=4;i<=5;i++)weak.put(record("Fixture Song","Fixture Singer",120,"[00:10]Runner fixture",null).put("id",i));check(!LyricsProvider.selectVariant(weak,speed).timed,"Three versus two unique records is insufficient consensus");
        org.json.JSONArray scattered=new org.json.JSONArray();for(int i=1;i<=3;i++)scattered.put(record("Fixture Song","Fixture Singer",100,"[00:10]Minority fixture",null).put("id",i));for(int i=0;i<7;i++)scattered.put(record("Fixture Song","Fixture Singer",108+i*8,"[00:10]Scattered fixture",null).put("id",20+i));check(!LyricsProvider.selectVariant(scattered,speed).timed,"A3xlead below40percent of all plausible IDs cannot authorize inferred timing");
        org.json.JSONArray plainDominant=new org.json.JSONArray();for(int i=1;i<=5;i++)plainDominant.put(record("Fixture Song","Fixture Singer",100,null,"Dominant plain fixture").put("id",i));plainDominant.put(record("Fixture Song","Fixture Singer",120,"[00:10]Minority timed fixture",null).put("id",6));check(!LyricsProvider.selectVariant(plainDominant,speed).timed,"A dominant plain-only duration does not borrow a minority recording's synchronized lines");
        org.json.JSONArray invalidVotes=new org.json.JSONArray();for(int i=0;i<5;i++)invalidVotes.put(record("Fixture Song","Fixture Singer",100,"[00:10]Invalid vote fixture",null).put("id",String.valueOf(i+1)));invalidVotes.put(record("Fixture Song","Fixture Singer",120,"[00:10]Valid vote fixture",null).put("id",9));check(!LyricsProvider.selectVariant(invalidVotes,speed).timed,"String numeric IDs are not trusted consensus votes");
        consensus.put(record("Fixture Song (sped up)","Fixture Singer",93,"[00:03]Exact marked fixture",null).put("id",99));result=LyricsProvider.selectVariant(consensus,curated);check(result.timed&&!result.adapted&&LrcParser.parse(result.text).get(0).time==3000,"An exact marked synonym record still outranks strong canonical duration consensus");
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original).put(record("Fixture Song","Fixture Singer",102.49,null,"Jittered written fixture").put("id",500)),speed);check(result.adapted,"Canonical duration clustering uses2.5s jitter while exact-record matching stays strict");
        for(String label:new String[]{"(slowed)","(speedup slowed)","(speedup) preview","(speedup x1.5)"}){result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original),new LyricsMetadata.Query("Fixture Song "+label,"Fixture Singer",80000));check(result.found()&&!result.timed,"Unsafe direction/snippet/ratio degrades to plain text: "+label);}
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original),new LyricsMetadata.Query("Fixture Song (speedup)","Foreign Singer",80000));check(!result.found(),"Explicit tempo marker does not relax verified artist identity");
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original),new LyricsMetadata.Query("Fixture Song (remix) (speedup)","Fixture Singer",80000));check(!result.found(),"Removing tempo qualifiers never substitutes original lyrics for a named remix");
        result=LyricsProvider.selectVariant(new org.json.JSONArray().put(original),new LyricsMetadata.Query("Fixture Song (speedup)","Fixture Singer",15000));check(result.found()&&!result.timed,"Sub20s snippets cannot acquire estimated synchronized timing");
        String shifted=LyricsProvider.retime("[offset:1000]\n[00:10.000]<00:10.500>Offset fixture",1.25);check(LrcParser.parse(shifted).get(0).time==8800&&shifted.contains("<00:09.200>")&&!shifted.contains("offset:"),"A source LRC offset is included before division and removed to prevent double application");
        check(LyricsProvider.retime("[00:10>Bad tag",1.25).isEmpty(),"Mismatched source time brackets cannot become adapted timings");
        final int[] cachedRequests={0};LyricsProvider.Cache cache=new LyricsProvider.Cache(){org.json.JSONArray rows;public org.json.JSONArray read(LyricsMetadata.Query q){return rows;}public void write(LyricsMetadata.Query q,org.json.JSONArray value){rows=value;}};LyricsProvider cachedProvider=new LyricsProvider((path,deadline)->{cachedRequests[0]++;return reply(200,"["+original+"]");});
        cachedProvider.lookup(Arrays.asList(speed),cache,false);result=cachedProvider.lookup(Arrays.asList(new LyricsMetadata.Query("Fixture Song (slowed)","Fixture Singer",125000)),cache,false);check(cachedRequests[0]==1&&result.adapted&&result.adaptationRate==.8,"A canonical record cache adapts another source duration without another HTTP request");
        if(args.length>0&&args[0].equals("--live")){
            LyricsProvider.Result live=new LyricsProvider("development-lyrics-check").lookup(LyricsMetadata.candidates("I Want to Live","Borislav Slavov",233000));
            check(live.found()||live.instrumental,"Real public HTTPS provider returns a matching documented recording");
            System.out.println("Live LRCLIB metadata match: text="+live.found()+", synced="+live.timed+", lines="+LyricsRepository.lines(live).size()+" (source text not printed)");
        }
        System.out.println("Lyrics provider: "+checks+" behavior checks passed");
    }
}
