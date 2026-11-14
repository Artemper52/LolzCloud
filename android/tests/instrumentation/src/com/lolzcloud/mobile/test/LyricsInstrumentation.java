package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import com.lolzcloud.mobile.LyricsFixtures;
import com.lolzcloud.mobile.OnlineActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Declared lyrics fixture + actual Android views/MediaPlayer; no personal account or forum login. */
public final class LyricsInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    @Override public void onStart(){
        JSONObject report=new JSONObject();int result=Activity.RESULT_OK;LyricsFixtures fixtures=null;ActivityMonitor browser=null,web=null;
        try{
            if(!shell("getprop ro.kernel.qemu").trim().equals("1"))throw new AssertionError("Only the isolated emulator is allowed");
            IntentFilter filter=new IntentFilter(Intent.ACTION_VIEW);filter.addDataScheme("http");filter.addDataScheme("https");browser=addMonitor(filter,new ActivityResult(Activity.RESULT_CANCELED,null),true);web=addMonitor(OnlineActivity.class.getName(),new ActivityResult(Activity.RESULT_CANCELED,null),true);
            fixtures=new LyricsFixtures(this);fixtures.run();
            if(browser.getHits()!=0||web.getHits()!=0)throw new AssertionError("Native lyrics unexpectedly opened a browser/source Activity");
            report.put("status","passed");
        }catch(Throwable error){result=Activity.RESULT_CANCELED;try{report.put("status","failed");report.put("error",error.toString());}catch(Exception ignored){}}
        finally{if(browser!=null)removeMonitor(browser);if(web!=null)removeMonitor(web);}
        try{
            report.put("checks",fixtures==null?new JSONArray():fixtures.checks());report.put("screenshots",fixtures==null?new JSONArray():fixtures.captures());
            report.put("scope","Declared bounded LRCLIB transport fixtures; real native UI, source LRC line highlighting/seeking, MediaPlayer, private cache/import priority/cancel. No substituted media SDK, real-user account or room navigation.");
            android.content.pm.PackageInfo installed=getTargetContext().getPackageManager().getPackageInfo("com.lolzcloud.mobile",0);report.put("version",installed.versionName);report.put("versionCode",installed.versionCode);report.put("apkSha256",sha(new File(installed.applicationInfo.sourceDir)));report.put("androidApi",android.os.Build.VERSION.SDK_INT);report.put("personalAccountsUsed",false);
            File directory=new File(getTargetContext().getExternalFilesDir(null),"lyrics-review");directory.mkdirs();try(FileOutputStream output=new FileOutputStream(new File(directory,"android-lyrics-test.json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
            Bundle out=new Bundle();out.putString("stream",report.toString(2)+"\n");finish(result,out);
        }catch(Exception error){Bundle out=new Bundle();out.putString("stream",error.toString());finish(0,out);}
    }
    private static String sha(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] bytes=new byte[8192];int count;while((count=input.read(bytes))!=-1)digest.update(bytes,0,count);}StringBuilder value=new StringBuilder();for(byte row:digest.digest())value.append(String.format(java.util.Locale.ROOT,"%02x",row&255));return value.toString();}
    private String shell(String command)throws Exception{try(InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()){byte[] bytes=new byte[1024];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);return output.toString("UTF-8");}}
}
