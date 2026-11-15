package com.lolzcloud.mobile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/** Read-only anonymous LRCLIB client. Explicit tempo variants may adapt a verified original. */
public final class LyricsProvider {
    public static final String SOURCE = "LRCLIB";
    static final int JSON_LIMIT = 2 * 1024 * 1024, TEXT_LIMIT = 120000;
    private static final Limit SHARED_LIMIT = new Limit();
    private final AtomicInteger generation = new AtomicInteger();
    private final Transport transport;
    private final Limit limit;
    private final String userAgent;
    private volatile HttpsURLConnection active;

    interface Transport { Response get(String path, long deadline) throws IOException; }
    interface Cache { JSONArray read(LyricsMetadata.Query query);void write(LyricsMetadata.Query query,JSONArray rows); }
    static final class Response {
        final int status; final String body, retry;
        Response(int status, String body, String retry) { this.status=status; this.body=body; this.retry=retry; }
    }
    static final class Limit { volatile long until; }
    public static final class Failure extends IOException {
        public final long retryAt;
        Failure(String message, long retryAt) { super(message); this.retryAt=retryAt; }
    }
    public static final class Result {
        public final String text, title, artist;
        public final boolean timed, instrumental, versionMismatch;
        public final long recordId, duration;
        public final boolean adapted;public final double adaptationRate;public final long referenceDuration;public final String referenceEvidence;
        Result(String text, String title, String artist, boolean timed, boolean instrumental, boolean mismatch, long id, long duration) {
            this(text,title,artist,timed,instrumental,mismatch,id,duration,false,1,duration);
        }
        Result(String text,String title,String artist,boolean timed,boolean instrumental,boolean mismatch,long id,long duration,boolean adapted,double rate,long referenceDuration){this(text,title,artist,timed,instrumental,mismatch,id,duration,adapted,rate,referenceDuration,adapted?"duration-match":"");}
        Result(String text,String title,String artist,boolean timed,boolean instrumental,boolean mismatch,long id,long duration,boolean adapted,double rate,long referenceDuration,String evidence){this.text=text;this.title=title;this.artist=artist;this.timed=timed;this.instrumental=instrumental;this.versionMismatch=mismatch;this.recordId=id;this.duration=duration;this.adapted=adapted;this.adaptationRate=rate;this.referenceDuration=referenceDuration;this.referenceEvidence=evidence;}
        public boolean found() { return !text.trim().isEmpty(); }
        static Result empty() { return new Result("","","",false,false,false,0,0); }
    }
    public LyricsProvider(String version) { limit=SHARED_LIMIT; transport=this::https; userAgent="LolzCloud-Android/"+(version!=null&&version.matches("[A-Za-z0-9. -]{1,32}")?version:"development")+" (https://lolzcloud.com)"; }
    LyricsProvider(Transport transport) { this.transport=transport; this.limit=new Limit(); this.userAgent="LolzCloud-Android/test (https://lolzcloud.com)"; }
    public void cancel() { generation.incrementAndGet(); HttpsURLConnection value=active; if(value!=null)value.disconnect(); }
    public long retryAt() { return limit.until; }

    public Result lookup(List<LyricsMetadata.Query> candidates) throws IOException {
        return lookup(candidates,null,false);
    }
    Result lookup(List<LyricsMetadata.Query> candidates,Cache cache,boolean force)throws IOException{
        final int ticket=generation.incrementAndGet(); final long deadline=System.nanoTime()+30_000_000_000L;
        if(System.currentTimeMillis()<limit.until)throw new Failure("Источник текста попросил подождать. Повтори после паузы.",limit.until);
        Result best=Result.empty(); IOException last=null; boolean searched=false; int requests=0;
        Map<String,JSONArray> canonical=new HashMap<>();
        for(LyricsMetadata.Query query:candidates){
            if(!query.usable()||requests>=6)continue;
            if(query.variant.marked){
                check(ticket,deadline);JSONArray cached=canonical.get(query.canonicalKey());if(cached==null&&!force&&cache!=null)cached=cache.read(query);
                if(cached!=null&&cached.length()>30)cached=null;
                if(cached!=null){canonical.put(query.canonicalKey(),cached);searched=true;best=better(best,selectVariant(cached,query));if(best.timed)return best;continue;}
            }
            for(boolean search:new boolean[]{false,true}){
                if(query.variant.marked&&!search)continue; // Wrong modified duration makes the get endpoint unnecessarily expensive.
                check(ticket,deadline); if(requests++>0)pause(ticket,deadline);
                try{
                    String path="/api/"+(search?"search":"get")+"?track_name="+encode(query.variant.marked?query.variant.title:query.title)+"&artist_name="+encode(query.artist);
                    if(!search&&query.duration>=1000&&query.duration<=3600000)path+="&duration="+String.format(Locale.ROOT,"%.3f",query.duration/1000.0);
                    Response response=transport.get(path,deadline); check(ticket,deadline);
                    if(response.status==429||response.status==503){
                        long wait=retryMillis(response.retry,System.currentTimeMillis(),response.status==429?60000:5000);
                        long until=System.currentTimeMillis()+wait+(long)(Math.random()*Math.min(wait/4,10000));limit.until=Math.max(limit.until,until);
                        throw new Failure(response.status==429?"Источник текста попросил подождать. Попробуй позже.":"Источник текста сейчас занят. Попробуй позже.",limit.until);
                    }
                    if(response.status==404){if(search)searched=true;continue;}
                    if(response.status!=200)throw new IOException("Источник текста временно недоступен (HTTP "+response.status+")");
                    if(response.body==null||response.body.getBytes(StandardCharsets.UTF_8).length>JSON_LIMIT)throw new IOException("Источник вернул слишком большой ответ");
                    if(search){
                        JSONArray rows=new JSONArray(response.body);if(rows.length()>30)throw new IOException("Источник вернул слишком много результатов");searched=true;
                        if(query.variant.marked){canonical.put(query.canonicalKey(),rows);if(cache!=null&&rows.length()>0)cache.write(query,rows);best=better(best,selectVariant(rows,query));}
                        else for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null)best=better(best,match(row,query));}
                    }else best=better(best,match(new JSONObject(response.body),query));
                    if(best.timed||best.instrumental)return best;
                }catch(Failure error){throw error;}
                catch(InterruptedIOException error){throw error;}
                catch(JSONException error){last=new IOException("Источник текста вернул некорректный ответ",error);}
                catch(IOException error){check(ticket,deadline);last=error;}
            }
        }
        if(best.found())return best;if(!searched&&last!=null)throw last;return best;
    }
    private static Result better(Result before,Result next){
        int a=quality(before),b=quality(next);return b>a?next:before;
    }
    private static int quality(Result value){return value.timed?(value.adapted?4:5):value.instrumental?3:value.found()?(value.versionMismatch?1:2):0;}
    private static final class Reference{final Result value;final long duration,id;final int lines;Reference(Result value,long duration,long id){this.value=value;this.duration=duration;this.id=id;lines=value.timed?LrcParser.parse(value.text).size():0;}}
    private static final class Cluster{final long first;final List<Reference> rows=new ArrayList<>();final java.util.Set<Long> ids=new java.util.HashSet<>();Cluster(long first){this.first=first;}}
    static Result selectVariant(JSONArray rows,LyricsMetadata.Query query){
        Result exact=Result.empty(),plain=Result.empty();List<Reference> originals=new ArrayList<>();
        for(int i=0;i<rows.length();i++)try{
            JSONObject row=rows.optJSONObject(i);if(row==null)continue;Result direct=match(row,query);LyricsMetadata.Variant rowVariant=LyricsMetadata.variant(row.optString("trackName"));if(!direct.timed&&query.variant.marked&&rowVariant.marked&&!query.variant.ambiguous&&!rowVariant.ambiguous&&query.variant.direction==rowVariant.direction&&LyricsMetadata.sameTitle(rowVariant.title,query.variant.title))direct=better(direct,match(row,new LyricsMetadata.Query(row.optString("trackName"),query.artist,query.duration)));exact=better(exact,direct);
            if(!LyricsMetadata.sameTitle(row.optString("trackName"),query.variant.title)||!LyricsMetadata.sameArtists(row.optString("artistName"),query.artist))continue;
            plain=better(plain,match(row,new LyricsMetadata.Query(query.variant.title,query.artist,query.duration)));
            Object seconds=row.opt("duration");if(!(seconds instanceof Number)||!Double.isFinite(((Number)seconds).doubleValue()))continue;long reference=Math.round(((Number)seconds).doubleValue()*1000);
            if(!query.variant.permits(query.duration,reference))continue;
            Result original=match(row,new LyricsMetadata.Query(query.variant.title,query.artist,reference));Object rawId=row.opt("id");double number=rawId instanceof Number?((Number)rawId).doubleValue():0;long id=Double.isFinite(number)&&number>0&&number<=9007199254740991d&&Math.floor(number)==number?(long)number:0;originals.add(new Reference(original,reference,id));
        }catch(IllegalArgumentException ignored){}
        if(exact.timed||exact.instrumental)return exact;
        if(!originals.isEmpty()){
            originals.sort((a,b)->Long.compare(a.duration,b.duration));List<Cluster> clusters=new ArrayList<>();Map<Long,Cluster> owners=new HashMap<>();java.util.Set<Long> conflicts=new java.util.HashSet<>();
            for(Reference original:originals){Cluster group=clusters.isEmpty()?null:clusters.get(clusters.size()-1);if(group==null||original.duration-group.first>2500){group=new Cluster(original.duration);clusters.add(group);}group.rows.add(original);if(original.id>0){Cluster prior=owners.get(original.id);if(prior!=null&&prior!=group){prior.ids.remove(original.id);conflicts.add(original.id);}if(!conflicts.contains(original.id)){owners.put(original.id,group);group.ids.add(original.id);}}}
            Cluster selected=clusters.size()==1?clusters.get(0):null;String evidence="duration-match";
            if(selected==null){List<Cluster> ranked=new ArrayList<>(clusters);ranked.sort((a,b)->Integer.compare(b.ids.size(),a.ids.size()));int votes=ranked.get(0).ids.size(),runner=ranked.size()>1?ranked.get(1).ids.size():0,total=0;for(Cluster group:ranked)total+=group.ids.size();if(votes>=3&&votes>=3*runner&&votes*10>=4*total){selected=ranked.get(0);evidence="catalog-consensus";}}
            if(selected!=null){selected.rows.sort((a,b)->a.lines!=b.lines?Integer.compare(b.lines,a.lines):Long.compare(b.id,a.id));for(Reference original:selected.rows)if(original.value.timed){Result chosen=original.value;double rate=(double)original.duration/query.duration;String adapted=retime(chosen.text,rate);if(!adapted.isEmpty())return new Result(adapted,chosen.title,chosen.artist,true,false,false,chosen.recordId,query.duration,true,rate,original.duration,evidence);}}
        }
        Result written=better(exact,plain);if(written.timed){ // A canonical duration match is safe, but is not proof of the marked recording.
            StringBuilder text=new StringBuilder();for(LrcParser.Line line:LrcParser.parse(written.text)){if(text.length()>0)text.append('\n');text.append(line.text);}return new Result(text.toString(),written.title,written.artist,false,false,true,written.recordId,written.duration);
        }return written;
    }
    /** Divide original source timestamps once; native playback speed is deliberately absent. */
    static String retime(String text,double rate){
        if(!Double.isFinite(rate)||rate<.5||rate>2)return "";long offset=0;Matcher shift=Pattern.compile("(?im)^\\[offset:([+-]?\\d+)\\]\\s*$").matcher(text);if(shift.find())try{offset=Long.parseLong(shift.group(1));}catch(NumberFormatException invalid){return "";}
        String input=shift.replaceAll("");Matcher time=Pattern.compile("(\\[|<)(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?(\\]|>)").matcher(input);StringBuffer output=new StringBuffer();
        while(time.find()){if(time.group(1).equals("[")!=time.group(5).equals("]")||Integer.parseInt(time.group(3))>59)return "";String fraction=time.group(4);long ms=Integer.parseInt(time.group(2))*60000L+Integer.parseInt(time.group(3))*1000L+(fraction==null?0:Long.parseLong((fraction+"000").substring(0,3)));if(offset>Long.MAX_VALUE-ms)return "";long scaled=Math.max(0,Math.round((ms+offset)/rate));String stamp=String.format(Locale.ROOT,"%s%02d:%02d.%03d%s",time.group(1),scaled/60000,scaled/1000%60,scaled%1000,time.group(5));time.appendReplacement(output,Matcher.quoteReplacement(stamp));}time.appendTail(output);return output.length()<=TEXT_LIMIT?output.toString():"";
    }
    static Result match(JSONObject row,LyricsMetadata.Query query){
        try{
            Object rawTitle=row.get("trackName"),rawArtist=row.get("artistName"),rawDuration=row.get("duration");
            if(!(rawTitle instanceof String)||!(rawArtist instanceof String)||!(rawDuration instanceof Number))return Result.empty();
            String title=(String)rawTitle,artist=(String)rawArtist;double seconds=((Number)rawDuration).doubleValue();
            if(title.length()>300||artist.length()>300||!Double.isFinite(seconds)||seconds<=0||seconds>86400||!LyricsMetadata.sameTitle(title,query.title)||!LyricsMetadata.sameArtists(artist,query.artist))return Result.empty();
            long duration=Math.round(seconds*1000),id=row.optLong("id",0);boolean same=LyricsMetadata.durationMatches(query.duration,duration);
            boolean instrumental=Boolean.TRUE.equals(row.opt("instrumental"))&&same;
            String synced=boundedText(row.opt("syncedLyrics")),plain=boundedText(row.opt("plainLyrics"));
            List<LrcParser.Line> lines=LrcParser.parse(synced);boolean timed=same&&!lines.isEmpty();boolean words=false;
            for(LrcParser.Line line:lines){if(line.time<0||line.time>duration+2000)timed=false;if(!line.text.trim().isEmpty())words=true;}
            timed=timed&&words&&lines.size()<=3000;
            if(timed)return new Result(synced,title,artist,true,false,false,id,query.duration,false,1,duration);
            if(plain.trim().isEmpty()){
                StringBuilder written=new StringBuilder();for(LrcParser.Line line:lines)if(line.time>=0&&!line.text.trim().isEmpty()){if(written.length()>0)written.append('\n');written.append(line.text);}
                plain=written.toString();
            }
            return new Result(plain,title,artist,false,instrumental&&plain.trim().isEmpty(),!same&&query.duration>0,id,query.duration,false,1,duration);
        }catch(JSONException|IllegalArgumentException error){return Result.empty();}
    }
    private static String boundedText(Object value){return value instanceof String&&((String)value).length()<=TEXT_LIMIT?((String)value).replace("\u0000",""):"";}
    private static String encode(String value)throws IOException{return URLEncoder.encode(value,"UTF-8");}
    private void check(int ticket,long deadline)throws InterruptedIOException{
        if(Thread.currentThread().isInterrupted()||ticket!=generation.get())throw new InterruptedIOException("Поиск отменён");
        if(System.nanoTime()>deadline)throw new InterruptedIOException("Источник текста долго отвечает. Повтори поиск");
    }
    private void pause(int ticket,long deadline)throws IOException{
        try{Thread.sleep(300);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new InterruptedIOException("Поиск отменён");}check(ticket,deadline);
    }
    static long retryMillis(String value,long now,long fallback){
        if(value!=null){
            try{long seconds=Long.parseLong(value.trim());if(seconds>=0)return Math.max(1000,Math.min(604800,seconds)*1000);}catch(NumberFormatException ignored){}
            try{SimpleDateFormat date=new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz",Locale.US);date.setTimeZone(TimeZone.getTimeZone("GMT"));Date parsed=date.parse(value);if(parsed!=null&&parsed.getTime()>now)return Math.min(7L*86400000,parsed.getTime()-now);}catch(Exception ignored){}
        }return fallback;
    }
    private Response https(String path,long deadline)throws IOException{
        if(!path.startsWith("/api/get?")&&!path.startsWith("/api/search?"))throw new IOException("Некорректный запрос текста");
        HttpsURLConnection connection=(HttpsURLConnection)new URL("https://lrclib.net"+path).openConnection();active=connection;
        try{
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(6000);connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("User-Agent",userAgent);
            int status=connection.getResponseCode();String retry=connection.getHeaderField("Retry-After");
            if(status!=200)return new Response(status,"",retry);
            String type=connection.getContentType();if(type==null||!type.toLowerCase(Locale.ROOT).startsWith("application/json"))throw new IOException("Источник текста вернул неожиданный формат");
            if(connection.getContentLengthLong()>JSON_LIMIT)throw new IOException("Источник вернул слишком большой ответ");
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(Thread.currentThread().isInterrupted()||System.nanoTime()>deadline)throw new InterruptedIOException("Поиск текста прерван");if(output.size()+count>JSON_LIMIT)throw new IOException("Источник вернул слишком большой ответ");output.write(buffer,0,count);}
                return new Response(status,new String(output.toByteArray(),StandardCharsets.UTF_8),retry);
            }
        }catch(java.net.UnknownHostException error){throw new IOException("Нет связи с источником текста. Проверь интернет и повтори поиск",error);}
        catch(java.net.SocketTimeoutException error){throw new IOException("Источник текста долго отвечает. Повтори поиск",error);}
        catch(javax.net.ssl.SSLException error){throw new IOException("Не удалось проверить защищённое соединение с источником текста",error);}
        finally{if(active==connection)active=null;connection.disconnect();}
    }
}
