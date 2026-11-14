import com.lolzcloud.mobile.LyricsMetadata;
import com.lolzcloud.mobile.LyricsProvider;
import com.lolzcloud.mobile.LyricsRepository;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

/** Explicit real-song metadata probe: never emits the source lyric text. */
public final class LyricsRepresentativeProbe {
    public static void main(String[] args)throws Exception{
        JSONArray cases=new JSONArray();boolean allFound=true;
        for(String[] song:new String[][]{{"гной","тёмный принц","89000"},{"цветы","тёмный принц","98000"}}){
            LyricsProvider.Result result=new LyricsProvider("0.1.4").lookup(LyricsMetadata.candidates(song[0],song[1],Long.parseLong(song[2])));
            cases.put(new JSONObject().put("title",song[0]).put("artist",song[1]).put("durationMs",Long.parseLong(song[2])).put("found",result.found()).put("timed",result.timed).put("lines",LyricsRepository.lines(result).size()).put("versionMismatch",result.versionMismatch).put("recordId",result.recordId).put("matchedTitle",result.title).put("matchedArtist",result.artist));
            allFound&=result.found();System.out.println(song[0]+": found="+result.found()+", timed="+result.timed+", lines="+LyricsRepository.lines(result).size()+", versionMismatch="+result.versionMismatch);
        }
        JSONObject report=new JSONObject().put("status",allFound?"passed":"no_matching_record").put("generatedAt",java.time.Instant.now().toString()).put("source","https://lrclib.net").put("realPublicHttps",true).put("sourceTextPrinted",false).put("scope","Two requested Cyrillic recordings through the actual native provider/matching policy on the host JVM; no device or account login.").put("cases",cases);
        if(args.length!=1)throw new IllegalArgumentException("One JSON output path required");Files.write(Paths.get(args[0]),(report.toString(2)+"\n").getBytes(StandardCharsets.UTF_8));
    }
}
