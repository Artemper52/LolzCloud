package com.lolzcloud.mobile;

import android.app.*;
import android.os.*;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;

/** Test APK package peer. Injects an explicit isolated cloud transport, never a real account. */
public final class CloudProfileTestSupport {
    private final Instrumentation instrumentation;private final Activity activity;private final LibraryStore store;private final JSONArray checks;private final File output;
    private interface Task{void run()throws Exception;}private interface Condition{boolean ready()throws Exception;}
    private CloudProfileTestSupport(Instrumentation i,Activity a,LibraryStore s,JSONArray checks,File output){instrumentation=i;activity=a;store=s;this.checks=checks;this.output=output;}
    public static void run(Instrumentation i,Activity activity,LibraryStore store,JSONArray checks,File output)throws Exception{new CloudProfileTestSupport(i,activity,store,checks,output).run();}
    private static String repeated(char c){char[] v=new char[43];Arrays.fill(v,c);return new String(v);}
    private static final class Jar implements CloudProfileApi.CookieSource{volatile String value="__Host-lc_session="+repeated('a');public String current(){return value;}}
    private static final class Backend implements CloudProfileApi.Transport{
        final Jar jar;volatile String owner="42",replyOwner="42";volatile long revision=7;volatile int gets,puts,sessions;volatile boolean conflict,unauthorized,malformed,switchAfterSession,omitOwner;volatile ProfileCrypto.Envelope envelope;volatile String writtenBody;
        Backend(Jar jar,ProfileCrypto.Envelope envelope){this.jar=jar;this.envelope=envelope;}
        public synchronized CloudProfileApi.Response request(String method,String path,String body,String bearer,String csrf)throws IOException{
            try{
                if(!bearer.equals(repeated('a'))&&!bearer.equals(repeated('b')))throw new IOException("Unexpected fixture bearer");
                if(path.equals("/api/session")){sessions++;if(unauthorized)return new CloudProfileApi.Response(401,"");JSONObject data=new JSONObject().put("authenticated",true).put("csrf",repeated('c')).put("user",new JSONObject().put("id",owner).put("name","Fixture cloud owner"));if(switchAfterSession){switchAfterSession=false;jar.value="__Host-lc_session="+repeated('b');}return new CloudProfileApi.Response(200,data.toString());}
                if(!path.equals("/api/profile"))throw new IOException("Unexpected path");
                if(method.equals("GET")){gets++;JSONObject reply=new JSONObject().put("revision",revision).put("updatedAt",1700000000000L).put("envelope",CloudProfileApi.json(envelope));if(!omitOwner)reply.put("ownerId",replyOwner);return new CloudProfileApi.Response(200,malformed?"{\"revision\":7}":reply.toString());}
                if(!method.equals("PUT")||!csrf.equals(repeated('c')))throw new IOException("Unexpected mutation");puts++;JSONObject value=new JSONObject(body);if(value.length()!=2||!value.has("revision")||!value.has("envelope")||body.contains("Portable one")||body.contains("password"))throw new IOException("Plaintext or unknown mutation fields");
                if(conflict||value.getLong("revision")!=revision)return new CloudProfileApi.Response(409,"");envelope=CloudProfileApi.envelope(value.getJSONObject("envelope"));writtenBody=body;revision++;return new CloudProfileApi.Response(200,new JSONObject().put("ownerId",replyOwner).put("revision",revision).put("updatedAt",1700000000001L).toString());
            }catch(JSONException invalid){throw new IOException(invalid);}
        }
    }
    private void run()throws Exception{
        JSONObject vectors=new JSONObject(asset("crypto-v1.json"));JSONArray rows=vectors.getJSONArray("vectors");
        for(int index=0;index<rows.length();index++){JSONObject row=rows.getJSONObject(index);ProfileCrypto.Envelope envelope=CloudProfileApi.envelope(row.getJSONObject("envelope"));char[] password=row.getString("password").toCharArray();String decoded=ProfileCrypto.decrypt(envelope,password);check(new JSONObject(decoded).getJSONObject("music").getJSONObject("dsp").getDouble("rate")==1.75,"Actual Android scrypt/AES-GCM decrypts the public Node vector "+index);for(char c:password)if(c!='\0')throw new AssertionError("Password retained");}
        JSONObject first=rows.getJSONObject(0);String password=first.getString("password");ProfileCrypto.Envelope envelope=CloudProfileApi.envelope(first.getJSONObject("envelope"));
        Jar jar=new Jar();Backend backend=new Backend(jar,envelope);CloudProfileApi api=new CloudProfileApi(jar,backend);CloudProfileApi.Snapshot snapshot=api.read();
        check(snapshot.owner.id.equals("42")&&snapshot.revision==7&&backend.sessions==1&&backend.gets==1,"Cloud read verifies the native session before reading its encrypted revision");
        backend.replyOwner="99";boolean aba=false;try{api.read();}catch(CloudProfileApi.ApiError expected){aba=expected.status==409;}check(aba&&api.current(snapshot.owner),"A foreign profile response is rejected even when the cookie has returned to the original owner (ABA)");backend.replyOwner="42";
        backend.omitOwner=true;boolean missingOwner=false;try{api.read();}catch(CloudProfileApi.ApiError expected){missingOwner=expected.status==409;}check(missingOwner,"An ownerless legacy response cannot be restored as the captured account");backend.omitOwner=false;
        Backend foreignReceipt=new Backend(jar,envelope);CloudProfileApi receiptApi=new CloudProfileApi(jar,foreignReceipt);CloudProfileApi.Snapshot receiptSnapshot=receiptApi.read();foreignReceipt.replyOwner="99";boolean badReceipt=false;try{receiptApi.save(receiptSnapshot,envelope,()->true);}catch(CloudProfileApi.ApiError expected){badReceipt=expected.status==409;}check(badReceipt&&foreignReceipt.puts==1,"A mismatched PUT receipt is not reported as a confirmed save and is never retried");
        backend.switchAfterSession=true;int puts=backend.puts;boolean changed=false;try{api.save(snapshot,envelope,()->true);}catch(CloudProfileApi.ApiError expected){changed=expected.status==409;}check(changed&&backend.puts==puts,"A cookie swap during fresh owner verification prevents PUT entirely");
        jar.value="__Host-lc_session="+repeated('a');backend.owner="99";changed=false;try{api.save(snapshot,envelope,()->true);}catch(CloudProfileApi.ApiError expected){changed=expected.status==409;}check(changed&&backend.puts==puts,"A changed owner with the same session handle cannot overwrite the previous account");backend.owner="42";
        boolean cancelled=false;try{api.save(snapshot,envelope,()->false);}catch(IOException expected){cancelled=true;}check(cancelled&&backend.puts==puts,"A cancelled operation cannot begin a cloud write");
        backend.conflict=true;boolean conflict=false;try{api.save(snapshot,envelope,()->true);}catch(CloudProfileApi.ApiError expected){conflict=expected.status==409;}check(conflict&&backend.puts==puts+1&&backend.revision==7&&backend.envelope==envelope,"Revision409 leaves the encrypted copy intact and is not retried");backend.conflict=false;
        backend.malformed=true;boolean corrupt=false;try{api.read();}catch(IOException expected){corrupt=true;}check(corrupt,"An incomplete cloud reply cannot be mistaken for an empty copy");backend.malformed=false;
        backend.unauthorized=true;int get=backend.gets;boolean unauthorized=false;try{api.read();}catch(CloudProfileApi.ApiError expected){unauthorized=expected.status==401;}check(unauthorized&&backend.gets==get,"Rejected session never reaches the cloud profile route");backend.unauthorized=false;
        String desktop=asset("desktop-v1.json");store.importProfile(desktop,false);Map<String,?> before=new HashMap<>(store.preferences().getAll());boolean guarded=false;try{store.importProfile(desktop,true,()->{throw new IOException("Fixture owner changed");});}catch(IOException expected){guarded=true;}check(guarded&&before.equals(store.preferences().getAll()),"The final restore owner guard fails before a single preference commit or backup mutation");
        final String[] restored={null};final CloudProfileDialog[] panel={null};onMain(()->{panel[0]=new CloudProfileDialog(activity,store,0xff1c2720,0xfff1f5f2,0xff97a99e,0xffa5e5bd,(json,owner)->{restored[0]=json;},()->{},api);panel[0].show();});
        try{
            await(()->!busy(panel[0])&&button(panel[0],"cloud_save").isEnabled(),8000,"Native cloud read UI");check(text(panel[0],"cloud_status").contains("Fixture cloud owner"),"Native dialog displays the verified fixture owner and cloud revision");capture("cloud-read.png");
            onMain(()->{input(panel[0]).setText(password);button(panel[0],"cloud_save").performClick();});await(()->confirmation(panel[0])!=null&&confirmation(panel[0]).isShowing(),8000,"Explicit replace confirmation");
            check(backend.puts==puts+1&&input(panel[0]).length()==0,"Opening upload confirmation sends no PUT and clears the password widget");capture("cloud-confirm.png");
            onMain(()->confirmation(panel[0]).getButton(AlertDialog.BUTTON_NEGATIVE).performClick());await(()->!busy(panel[0]),3000,"Cancel overwrite");check(backend.puts==puts+1,"Cancel overwrite confirmation preserves the existing cloud copy");
            onMain(()->button(panel[0],"cloud_read").performClick());await(()->button(panel[0],"cloud_save").isEnabled(),8000,"Read after cancellation");
            onMain(()->{input(panel[0]).setText(password);button(panel[0],"cloud_save").performClick();});await(()->confirmation(panel[0])!=null&&confirmation(panel[0]).isShowing(),8000,"Second overwrite confirmation");
            onMain(()->confirmation(panel[0]).getButton(AlertDialog.BUTTON_POSITIVE).performClick());await(()->!busy(panel[0])&&backend.revision==8,20000,"Actual Android encryption and fixture PUT receipt");check(backend.writtenBody!=null&&backend.puts==puts+2,"Explicit native replacement sends exactly one authenticated encrypted revision write");write("android-cloud-upload-envelope.json",CloudProfileApi.json(backend.envelope).toString());
            JSONObject decrypted=new JSONObject(ProfileCrypto.decrypt(backend.envelope,password.toCharArray()));check(decrypted.getString("format").equals("lolzcloud-profile")&&decrypted.getJSONObject("music").getJSONObject("dsp").getDouble("preampDb")==-6,"Native UI upload contains the real common profile and preserves unsupported fields inside encryption");
            before=new HashMap<>(store.preferences().getAll());onMain(()->{input(panel[0]).setText("wrong fixture password");button(panel[0],"cloud_restore").performClick();});await(()->!busy(panel[0])&&text(panel[0],"cloud_error").contains("пароль"),20000,"Wrong password failure UI");check(restored[0]==null&&before.equals(store.preferences().getAll()),"Wrong password cannot open a restore preview or mutate local data");
            onMain(()->{input(panel[0]).setText(password);button(panel[0],"cloud_restore").performClick();});await(()->restored[0]!=null,20000,"Successful decrypt callback");check(before.equals(store.preferences().getAll())&&PortableProfile.parse(restored[0]).getJSONObject("tools").getBoolean("normalization"),"Successful decrypt reaches a preview payload without auto-applying local or unsupported settings");write("android-cloud-restored-profile.json",restored[0]);
        }finally{onMain(()->panel[0].close());awaitClosed(panel[0]);}
        CloudProfileDialog[] second={null};onMain(()->{second[0]=new CloudProfileDialog(activity,store,0xff1c2720,0xfff1f5f2,0xff97a99e,0xffa5e5bd,(json,owner)->{},()->{},api);second[0].show();});
        try{
            await(()->button(second[0],"cloud_save").isEnabled(),8000,"Cloud UI conflict setup");backend.conflict=true;int prior=backend.puts;ProfileCrypto.Envelope retained=backend.envelope;
            onMain(()->{input(second[0]).setText(password);button(second[0],"cloud_save").performClick();});await(()->confirmation(second[0])!=null&&confirmation(second[0]).isShowing(),8000,"Conflict confirmation");onMain(()->confirmation(second[0]).getButton(AlertDialog.BUTTON_POSITIVE).performClick());await(()->!busy(second[0])&&text(second[0],"cloud_error").contains("изменилась"),20000,"Visible409 conflict");
            check(backend.puts==prior+1&&backend.envelope==retained&&!button(second[0],"cloud_save").isEnabled(),"Native409 is visible, preserves cloud data and requires a new read before another write");backend.conflict=false;
            onMain(()->button(second[0],"cloud_read").performClick());await(()->button(second[0],"cloud_save").isEnabled(),8000,"Read before cancellation race");prior=backend.puts;
            onMain(()->{input(second[0]).setText(password);button(second[0],"cloud_save").performClick();});await(()->confirmation(second[0])!=null&&confirmation(second[0]).isShowing(),8000,"Cancel race confirmation");
            onMain(()->{confirmation(second[0]).getButton(AlertDialog.BUTTON_POSITIVE).performClick();second[0].suspend();});onMain(()->second[0].close());awaitClosed(second[0]);check(backend.puts==prior,"Cancellation immediately after confirm fences the actual crypto worker before any PUT");
        }finally{onMain(()->second[0].close());awaitClosed(second[0]);}
    }
    private void awaitClosed(CloudProfileDialog panel)throws Exception{ExecutorService worker=(ExecutorService)field(panel,"worker");if(!worker.awaitTermination(20,TimeUnit.SECONDS))throw new AssertionError("Cloud worker did not release after cancellation");}
    private static Object field(Object target,String name)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}
    private static AlertDialog confirmation(CloudProfileDialog panel)throws Exception{return(AlertDialog)field(panel,"confirmation");}
    private static AlertDialog dialog(CloudProfileDialog panel)throws Exception{return(AlertDialog)field(panel,"dialog");}
    private static Button button(CloudProfileDialog panel,String tag)throws Exception{return(Button)dialog(panel).getWindow().getDecorView().findViewWithTag(tag);}
    private static EditText input(CloudProfileDialog panel)throws Exception{return(EditText)field(panel,"password");}
    private static boolean busy(CloudProfileDialog panel)throws Exception{return(Boolean)field(panel,"busy");}
    private static String text(CloudProfileDialog panel,String tag)throws Exception{return((TextView)dialog(panel).getWindow().getDecorView().findViewWithTag(tag)).getText().toString();}
    private void await(Condition condition,long timeout,String message)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(true){boolean[] ready={false};onMain(()->ready[0]=condition.ready());if(ready[0])return;if(SystemClock.elapsedRealtime()>end)throw new AssertionError(message);SystemClock.sleep(35);}}
    private void onMain(Task task)throws Exception{Throwable[] failure={null};instrumentation.runOnMainSync(()->{try{task.run();}catch(Throwable error){failure[0]=error;}});if(failure[0] instanceof Error)throw(Error)failure[0];if(failure[0]!=null)throw(Exception)failure[0];}
    private void check(boolean value,String message){if(!value)throw new AssertionError(message);checks.put(message);}
    private String asset(String name)throws IOException{try(InputStream in=instrumentation.getContext().getAssets().open("profiles/"+name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private void write(String name,String value)throws IOException{try(FileOutputStream out=new FileOutputStream(new File(output,name))){out.write(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
    private void capture(String name)throws Exception{SystemClock.sleep(350);android.graphics.Bitmap bitmap=instrumentation.getUiAutomation().takeScreenshot();if(bitmap!=null){try(FileOutputStream out=new FileOutputStream(new File(output,name))){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}}
}
