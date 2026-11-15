import com.lolzcloud.mobile.OfflineFiles;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.UUID;

/** Real filesystem byte deletion, with no Android runtime or user files. */
public final class OfflineFilesTest {
    private static int checks;
    private static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        File root=Files.createTempDirectory(new File(args[0]).toPath(),"LolzCloud-owned-audio-").toFile(),files=new File(root,"files"),offline=new File(files,"offline");
        check(offline.mkdirs(),"Isolated private download directory exists");
        byte[] bytes=new byte[65537];Arrays.fill(bytes,(byte)0x5a);File own=new File(offline,UUID.randomUUID()+".audio");Files.write(own.toPath(),bytes);
        check(OfflineFiles.owned(files,own.toURI().toString()).equals(own.getCanonicalFile()),"A genuine StreamDownloads filename belongs to this exact app files directory");
        check(OfflineFiles.owned(new File(files,"."),own.toURI().toString()).equals(own.getCanonicalFile()),"A trusted context-root spelling may differ from its canonical parent without widening ownership");
        check(OfflineFiles.delete(files,own.toURI().toString())==bytes.length&&!own.exists(),"Removing an owned copy really removes all65537file bytes");
        check(OfflineFiles.delete(files,own.toURI().toString())==0,"Retrying a completed deletion is idempotent");
        File external=new File(root,UUID.randomUUID()+".audio");Files.write(external.toPath(),bytes);
        check(OfflineFiles.owned(files,external.toURI().toString())==null&&external.length()==bytes.length,"An external source with the same extension is never owned");
        File unrelated=new File(files,UUID.randomUUID()+".audio");Files.write(unrelated.toPath(),bytes);
        check(OfflineFiles.owned(files,unrelated.toURI().toString())==null,"Other private app files outside offline are not downloads");
        File userNamed=new File(offline,"my-recording.audio");Files.write(userNamed.toPath(),bytes);
        check(OfflineFiles.owned(files,userNamed.toURI().toString())==null,"The directory alone does not authorize deleting arbitrary filenames");
        check(OfflineFiles.owned(files,"content://documents/audio/1")==null,"SAF documents never enter the deletion path");
        check(OfflineFiles.owned(files,"https://example.test/audio.mp3")==null,"HTTPS sources are never filesystem deletion targets");
        check(OfflineFiles.owned(files,external.toURI()+"?x=1")==null&&OfflineFiles.owned(files,external.toURI()+"#x")==null,"Ambiguous file URLs are rejected");
        String escape=new File(offline,"../"+unrelated.getName()).toURI().toString();check(OfflineFiles.owned(files,escape)==null,"Traversal cannot select another private source");
        boolean refused=false;try{OfflineFiles.delete(files,external.toURI().toString());}catch(java.io.IOException expected){refused=true;}check(refused&&Arrays.equals(Files.readAllBytes(external.toPath()),bytes),"A rejected deletion preserves every external byte");
        Files.delete(userNamed.toPath());Files.delete(unrelated.toPath());Files.delete(external.toPath());Files.delete(offline.toPath());Files.delete(files.toPath());Files.delete(root.toPath());
        System.out.println("Owned offline files: "+checks+" behavior checks passed");
    }
    private OfflineFilesTest(){}
}
