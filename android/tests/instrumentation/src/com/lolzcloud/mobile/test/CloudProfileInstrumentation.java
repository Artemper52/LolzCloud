package com.lolzcloud.mobile.test;

import android.app.*;
import android.content.*;
import android.os.*;
import com.lolzcloud.mobile.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Real native UI and Android crypto with an explicitly isolated, injected transport. */
public final class CloudProfileInstrumentation extends Instrumentation {
    private Bundle arguments;private File output,preferenceBackup;private MainActivity activity;private LibraryStore store;
    private final JSONArray checks=new JSONArray();private ActivityMonitor browser;
    @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args;start();}
    @Override public void onStart(){JSONObject report=new JSONObject();Map<String,Object> original=null;boolean restored=false;int code=Activity.RESULT_OK;
        try{
            if(!"1".equals(shell("getprop ro.kernel.qemu").trim()))throw new AssertionError("Only the owned emulator is allowed");
            output=new File(getTargetContext().getExternalFilesDir(null),"cloud-profile-review");if(!output.isDirectory()&&!output.mkdirs())throw new IOException("Cannot create test report folder");
            store=new LibraryStore(getTargetContext());original=snapshot(store.preferences());preferenceBackup=new File(getTargetContext().getCacheDir(),"cloud-qa-original-"+UUID.randomUUID()+".json");backup(preferenceBackup,original);store.preferences().edit().clear().putBoolean("notification_permission_asked",true).commit();
            IntentFilter filter=new IntentFilter(Intent.ACTION_VIEW);filter.addDataScheme("http");filter.addDataScheme("https");browser=addMonitor(filter,new ActivityResult(Activity.RESULT_CANCELED,null),true);
            activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));waitForIdleSync();
            CloudProfileTestSupport.run(this,activity,store,checks,output);
            if(browser.getHits()!=0)throw new AssertionError("Native cloud opened an external browser");checks.put("Native cloud flow opens no browser or WebView");report.put("status","passed");
        }catch(Throwable failure){code=Activity.RESULT_CANCELED;try{report.put("status","failed").put("error",failure.toString());}catch(Exception ignored){}}
        finally{
            try{if(activity!=null){PlaybackService service=(PlaybackService)field(activity,"player");runOnMainSync(()->{if(service!=null)service.stopPlayback();activity.finishAndRemoveTask();getTargetContext().stopService(new Intent(getTargetContext(),PlaybackService.class));});long end=SystemClock.elapsedRealtime()+12000;boolean[] released={false};do{runOnMainSync(()->{try{released[0]=(activity.isDestroyed()||activity.isFinishing())&&(service==null||(Boolean)field(service,"destroyed"));}catch(Exception ignored){}});if(released[0])break;SystemClock.sleep(40);}while(SystemClock.elapsedRealtime()<end);if(!released[0])throw new IOException("Service did not release before preference restoration");waitForIdleSync();}}catch(Throwable failure){code=Activity.RESULT_CANCELED;try{report.put("status","failed").put("cleanupError",failure.toString());}catch(Exception ignored){}}
            finally{try{if(original!=null){restore(store.preferences(),original);restored=original.equals(snapshot(store.preferences()));if(restored&&preferenceBackup!=null)preferenceBackup.delete();}}catch(Throwable failure){code=Activity.RESULT_CANCELED;try{report.put("status","failed").put("restoreError",failure.toString());}catch(Exception ignored){}}}if(browser!=null)removeMonitor(browser);
        }
        try{android.content.pm.PackageInfo p=getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0);JSONArray shots=new JSONArray();for(String name:new String[]{"cloud-read.png","cloud-confirm.png"})if(new File(output,name).isFile())shots.put(name);
            report.put("checks",checks).put("screenshots",shots).put("runId",arguments==null?"":arguments.getString("runId","")).put("version",p.versionName).put("versionCode",p.versionCode).put("apkSha256",sha(new File(p.applicationInfo.sourceDir))).put("preferencesRestored",restored).put("personalAccountsUsed",false).put("transport","isolated injected native transport; no real cloud mutation").put("scope","Actual Android scrypt/AES-GCM providers and native dialog widgets, encrypted revision requests, strict owner/cookie/ABA/409/cancel guards. Explicit fixture account only. Personal OAuth, live authenticated server roundtrip and physical devices are not tested.");
            try(FileOutputStream out=new FileOutputStream(new File(output,"android-cloud-profile-test.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}Bundle result=new Bundle();result.putString("stream",report.toString(2));finish(code,result);
        }catch(Throwable failure){Bundle result=new Bundle();result.putString("stream",failure.toString());finish(Activity.RESULT_CANCELED,result);}
    }
    private String shell(String command)throws IOException{try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private static Object field(Object target,String name)throws Exception{java.lang.reflect.Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(target);}
    private static void backup(File file,Map<String,Object> values)throws Exception{JSONObject data=new JSONObject();for(Map.Entry<String,Object> entry:values.entrySet()){Object value=entry.getValue();String type=value instanceof Set?"set":value instanceof String?"string":value instanceof Boolean?"boolean":value instanceof Integer?"int":value instanceof Long?"long":value instanceof Float?"float":"unsupported";if(type.equals("unsupported"))throw new IOException("Unknown preference type");data.put(entry.getKey(),new JSONObject().put("type",type).put("value",value instanceof Set?new JSONArray((Set<?>)value):value));}try(FileOutputStream out=new FileOutputStream(file)){out.write(data.toString().getBytes(StandardCharsets.UTF_8));}}
    private static Map<String,Object> snapshot(SharedPreferences prefs){Map<String,Object> values=new HashMap<>();for(Map.Entry<String,?> entry:prefs.getAll().entrySet())values.put(entry.getKey(),entry.getValue() instanceof Set?new HashSet<>((Set<?>)entry.getValue()):entry.getValue());return values;}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,Object> values)throws IOException{SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,Object> entry:values.entrySet()){String key=entry.getKey();Object value=entry.getValue();if(value instanceof String)edit.putString(key,(String)value);else if(value instanceof Boolean)edit.putBoolean(key,(Boolean)value);else if(value instanceof Integer)edit.putInt(key,(Integer)value);else if(value instanceof Long)edit.putLong(key,(Long)value);else if(value instanceof Float)edit.putFloat(key,(Float)value);else if(value instanceof Set)edit.putStringSet(key,(Set<String>)value);}if(!edit.commit())throw new IOException("Preference restore failed");}
    private static String sha(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder value=new StringBuilder();for(byte b:digest.digest())value.append(String.format(Locale.ROOT,"%02x",b&255));return value.toString();}
}
