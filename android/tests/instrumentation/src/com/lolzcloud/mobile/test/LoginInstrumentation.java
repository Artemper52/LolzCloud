package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.widget.TextView;
import com.lolzcloud.mobile.AccountFlowFixtures;
import com.lolzcloud.mobile.AccountLoginActivity;
import com.lolzcloud.mobile.OnlineActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;

/** No personal login/approval: strict protocol fixtures plus actual pending-code/cancel/rotation UI. */
public final class LoginInstrumentation extends Instrumentation {
    private final JSONArray checks=new JSONArray();
    private interface Condition{boolean evaluate()throws Exception;}
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    @Override public void onStart(){
        JSONObject report=new JSONObject();int result=Activity.RESULT_OK;
        try{
            check(shell("getprop ro.kernel.qemu").trim().equals("1"),"Only the task emulator may run private pending-code lifecycle checks");
            JSONArray fixtures=AccountFlowFixtures.run(this);for(int i=0;i<fixtures.length();i++)checks.put(fixtures.get(i));
            lifecycle();report.put("status","passed");
        }catch(Throwable error){result=Activity.RESULT_CANCELED;try{report.put("status","failed");report.put("error",error.toString());}catch(Exception ignored){}}
        try{
            report.put("checks",checks);report.put("scope","Declared bounded protocol fixtures; real native pairing/pending persistence/rotation/cancel and captured browser intent. No real forum login, approval, user credentials or synthetic connected account.");
            try(FileOutputStream output=new FileOutputStream(new File(getTargetContext().getFilesDir(),"android-account-login-test.json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
            Bundle out=new Bundle();out.putString("stream",report.toString(2)+"\n");finish(result,out);
        }catch(Exception error){Bundle out=new Bundle();out.putString("stream",error.toString());finish(0,out);}
    }
    private void lifecycle()throws Exception{
        Context context=getTargetContext();SharedPreferences pending=context.getSharedPreferences("lolzcloud_account_pending_v1",Context.MODE_PRIVATE);Map<String,?> previous=pending.getAll();
        String[] cookieBefore={null};onMain(()->{cookieBefore[0]=CookieManager.getInstance().getCookie("https://lolzcloud.com/");pending.edit().clear().commit();});
        final Intent[] browserIntent={null};final int[] browserLaunches={0};
        IntentFilter browserFilter=new IntentFilter(Intent.ACTION_VIEW);browserFilter.addDataScheme("http");browserFilter.addDataScheme("https");browserFilter.addCategory(Intent.CATEGORY_BROWSABLE);
        ActivityMonitor browser=new ActivityMonitor(){@Override public ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getData()!=null&&browserFilter.match(getTargetContext().getContentResolver(),intent,true,"Login test")>=0){browserIntent[0]=new Intent(intent);browserLaunches[0]++;return new ActivityResult(Activity.RESULT_CANCELED,null);}return null;}};
        addMonitor(browser);
        OnlineActivity online=null;AccountLoginActivity login=null;
        try{
            String room="https://lolzcloud.com/room/0123456789abcdef0123456789abcdef/";
            String loginUrl="https://lolzcloud.com/login?next=%2Froom%2F0123456789abcdef0123456789abcdef%2F";
            ActivityMonitor opened=addMonitor(AccountLoginActivity.class.getName(),null,false);
            online=(OnlineActivity)startActivitySync(new Intent(context,OnlineActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra("url",loginUrl).putExtra("title","Declared login lifecycle check"));
            login=(AccountLoginActivity)waitForMonitorWithTimeout(opened,12000);removeMonitor(opened);
            check(login!=null,"Own /login opens the actual native pairing Activity instead of forum WebView");
            final AccountLoginActivity current=login;
            await(()->{String value=((TextView)field(current,"code")).getText().toString().replace(" ","");return value.matches("[A-Za-z0-9_-]{12}");},20000,"Real unauthenticated start API supplies one bounded pending code");
            check(room.equals(login.getIntent().getStringExtra(AccountLoginActivity.RETURN_URL)),"Native flow retains the requested own room destination");
            String stored=pending.getString("pending",null);check(stored!=null,"Actual native Activity persists its unapproved code privately");JSONObject pair=new JSONObject(stored);String code=pair.getString("code"),device=pair.getString("device");
            check(device.matches("[A-Za-z0-9_-]{43}")&&pair.getLong("wallDeadline")-pair.getLong("wall")<=600000,"Private pending credential and expiry follow the device API contract");
            onMain(()->{try{((android.widget.Button)field(current,"browser")).performClick();}catch(Exception error){throw new RuntimeException(error);}});
            await(()->browserIntent[0]!=null,5000,"Explicit native browser action creates an external intent");
            check(browserLaunches[0]==1&&browserIntent[0].getDataString().equals("https://lolzcloud.com/connect?code="+code)&&browserIntent[0].getPackage()!=null,"Browser receives the whole fixed-origin verification page in one browser context, with no partial OAuth URL");
            ActivityMonitor rotated=addMonitor(AccountLoginActivity.class.getName(),null,false);Object retained=field(login,"controller");onMain(current::recreate);
            AccountLoginActivity after=(AccountLoginActivity)waitForMonitorWithTimeout(rotated,10000);removeMonitor(rotated);check(after!=null,"Native account Activity survives an actual configuration recreation");
            login=after;check(field(after,"controller")==retained,"Rotation retains the in-flight controller rather than requesting another code");
            check(new JSONObject(pending.getString("pending","{}")).getString("device").equals(device)&&browserLaunches[0]==1,"Rotation keeps the same private device code and never reopens the browser automatically");
            await(after::hasWindowFocus,5000,"Recreated native login has actual window focus before system Back");
            shell("input keyevent KEYCODE_BACK");await(()->after.isFinishing()||after.isDestroyed(),5000,"Actual system Back cancels native pairing");
            check(!pending.contains("pending"),"Cancelling the native screen removes its pending credential");
            final OnlineActivity parent=online;await(()->parent.hasWindowFocus(),8000,"Cancelled pairing returns to the existing own app screen");
            check((Boolean)field(parent,"accountRequired")&&!(Boolean)field(parent,"accountFlowOpen")&&((TextView)field(parent,"errorHeading")).getText().toString().equals("Вход в LolzCloud"),"Cancel shows an explicit sign-in/retry state rather than a generic network failure");
            ActivityMonitor unexpected=addMonitor(AccountLoginActivity.class.getName(),null,false);WebView web=(WebView)field(parent,"webView");
            onMain(()->{web.getWebViewClient().onPageStarted(web,loginUrl,null);web.getWebViewClient().onPageFinished(web,loginUrl);});SystemClock.sleep(400);
            check(unexpected.getHits()==0&&!(Boolean)field(parent,"accountFlowOpen"),"Stale login page-start/page-finished callbacks do not reopen a cancelled flow");
            ActivityMonitor parentRecreated=addMonitor(OnlineActivity.class.getName(),null,false);onMain(parent::recreate);
            OnlineActivity restored=(OnlineActivity)waitForMonitorWithTimeout(parentRecreated,10000);removeMonitor(parentRecreated);online=restored;check(restored!=null,"Own retry screen can be recreated after cancellation");SystemClock.sleep(400);
            check(unexpected.getHits()==0&&!(Boolean)field(restored,"accountFlowOpen")&&(Boolean)field(restored,"accountRequired"),"Rotation/resume of the cancelled parent does not create an automatic login loop");removeMonitor(unexpected);
            String[] cookieAfter={null};onMain(()->cookieAfter[0]=CookieManager.getInstance().getCookie("https://lolzcloud.com/"));
            check(java.util.Objects.equals(cookieBefore[0],cookieAfter[0]),"Unapproved browser/pending/cancel lifecycle never fabricates an authenticated app cookie");
            ActivityMonitor retry=addMonitor(AccountLoginActivity.class.getName(),null,false);onMain(()->{try{((android.widget.Button)field(restored,"retryButton")).performClick();}catch(Exception error){throw new RuntimeException(error);}});
            AccountLoginActivity explicit=(AccountLoginActivity)waitForMonitorWithTimeout(retry,10000);removeMonitor(retry);check(explicit!=null,"Only an explicit native sign-in action reopens pairing after cancellation");login=explicit;await(explicit::hasWindowFocus,5000,"Explicit retry has actual native window focus");shell("input keyevent KEYCODE_BACK");await(()->explicit.isFinishing()||explicit.isDestroyed(),5000,"Explicit retry remains cancellable without approving any account");
        }finally{
            removeMonitor(browser);final AccountLoginActivity closeLogin=login;final OnlineActivity closeOnline=online;onMain(()->{if(closeLogin!=null&&!closeLogin.isFinishing())closeLogin.finish();if(closeOnline!=null&&!closeOnline.isFinishing())closeOnline.finish();restore(pending,previous);});
        }
    }
    private void check(boolean condition,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",condition));if(!condition)throw new AssertionError(label);}
    private void await(Condition condition,long timeout,String label)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){boolean[] result={false};Exception[] failure={null};onMain(()->{try{result[0]=condition.evaluate();}catch(Exception error){failure[0]=error;}});if(failure[0]!=null)throw failure[0];if(result[0]){check(true,label);return;}SystemClock.sleep(60);}check(false,label);}
    private void onMain(Runnable action){runOnMainSync(action);}
    private static Object field(Object target,String name)throws Exception{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(target);}
    private String shell(String command)throws Exception{try(InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command));java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()){byte[] data=new byte[1024];int count;while((count=input.read(data))!=-1)output.write(data,0,count);return output.toString("UTF-8");}}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,?> values){SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,?> row:values.entrySet()){Object value=row.getValue();String key=row.getKey();if(value instanceof String)edit.putString(key,(String)value);else if(value instanceof Integer)edit.putInt(key,(Integer)value);else if(value instanceof Long)edit.putLong(key,(Long)value);else if(value instanceof Float)edit.putFloat(key,(Float)value);else if(value instanceof Boolean)edit.putBoolean(key,(Boolean)value);else if(value instanceof Set)edit.putStringSet(key,(Set<String>)value);}edit.commit();}
}
