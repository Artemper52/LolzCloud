package com.lolzcloud.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/** Automatic results live separately from the user's imported LRC/TXT in LibraryStore. */
public final class LyricsRepository {
    private final SharedPreferences matches;
    private final File directory;
    private final LyricsProvider provider;
    public LyricsRepository(Context context,LyricsProvider provider){
        this(provider,context.getApplicationContext().getSharedPreferences("lolzcloud_lyrics_matches_v1",Context.MODE_PRIVATE),new File(context.getCacheDir(),"lyrics-v1"));
    }
    LyricsRepository(LyricsProvider provider,SharedPreferences matches,File directory){this.provider=provider;this.matches=matches;this.directory=directory;}
    public LyricsMetadata.Query identity(String id,String title,String artist,long duration){
        String value=matches.getString(hash(id),"");
        try{JSONObject row=new JSONObject(value);LyricsMetadata.Query corrected=new LyricsMetadata.Query(row.getString("title"),row.getString("artist"),duration);if(corrected.usable())return corrected;}catch(Exception ignored){}
        return new LyricsMetadata.Query(title,artist,duration);
    }
    public void setIdentity(String id,String title,String artist){
        LyricsMetadata.Query query=new LyricsMetadata.Query(title,artist,0);if(!query.usable())throw new IllegalArgumentException("Укажи название песни и исполнителя");
        try{matches.edit().putString(hash(id),new JSONObject().put("title",query.title).put("artist",query.artist).toString()).apply();}catch(Exception error){throw new IllegalArgumentException("Не удалось сохранить название",error);}
    }
    public void resetIdentity(String id){matches.edit().remove(hash(id)).apply();}
    public String key(String id,LyricsMetadata.Query query){return hash(id+"\n"+query.key());}
    public void cancel(){provider.cancel();}
    public long retryAt(){return provider.retryAt();}
    public LyricsProvider.Result load(String id,LyricsMetadata.Query query,boolean force)throws IOException{
        File file=new File(directory,key(id,query)+".json");
        if(!force){LyricsProvider.Result cached=read(file,query);if(cached!=null)return cached;}
        LyricsProvider.Result result=provider.lookup(LyricsMetadata.candidates(query.title,query.artist,query.duration));
        if(Thread.currentThread().isInterrupted())throw new java.io.InterruptedIOException("Поиск отменён");
        // Only successful lyrics/instrumental records persist; a miss or network error can be retried.
        if(result.found()||result.instrumental)write(file,result);
        return result;
    }
    private LyricsProvider.Result read(File file,LyricsMetadata.Query query){
        if(!file.isFile()||file.length()>512000||file.lastModified()<System.currentTimeMillis()-7L*86400000)return null;
        try(FileInputStream input=new FileInputStream(file);java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>512000)return null;bytes.write(buffer,0,count);}
            JSONObject row=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            String text=row.getString("text");if(text.length()>LyricsProvider.TEXT_LIMIT)return null;
            boolean timed=row.getBoolean("timed");long duration=row.getLong("duration");
            if(timed&&!LyricsMetadata.durationMatches(query.duration,duration))return null;
            return new LyricsProvider.Result(text,row.getString("title"),row.getString("artist"),timed,row.getBoolean("instrumental"),row.getBoolean("mismatch"),row.getLong("id"),duration);
        }catch(Exception error){return null;}
    }
    private void write(File file,LyricsProvider.Result result){
        try{
            if(!directory.isDirectory()&&!directory.mkdirs())return;
            JSONObject row=new JSONObject().put("text",result.text).put("title",result.title).put("artist",result.artist).put("timed",result.timed).put("instrumental",result.instrumental).put("mismatch",result.versionMismatch).put("id",result.recordId).put("duration",result.duration);
            File temporary=new File(directory,file.getName()+".tmp");
            try(FileOutputStream output=new FileOutputStream(temporary)){output.write(row.toString().getBytes(StandardCharsets.UTF_8));}
            if(!temporary.renameTo(file)){temporary.delete();return;}
            File[] cached=directory.listFiles((dir,name)->name.matches("[a-f0-9]{64}\\.json"));
            if(cached!=null&&cached.length>24){Arrays.sort(cached,Comparator.comparingLong(File::lastModified));for(int i=0;i<cached.length-24;i++)cached[i].delete();}
        }catch(Exception ignored){/* Cache failure never hides a valid online result. */}
    }
    public static List<LrcParser.Line> lines(LyricsProvider.Result result){
        if(result==null)return new ArrayList<>();if(result.timed)return LrcParser.parse(result.text);
        List<LrcParser.Line> lines=new ArrayList<>();for(String line:result.text.replace("\uFEFF","").split("\\r?\\n"))if(!line.trim().isEmpty())lines.add(new LrcParser.Line(-1,line.trim()));return lines;
    }
    private static String hash(String value){
        try{byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte row:digest)result.append(String.format(java.util.Locale.ROOT,"%02x",row&255));return result.toString();}catch(Exception impossible){throw new IllegalStateException(impossible);}
    }
}
