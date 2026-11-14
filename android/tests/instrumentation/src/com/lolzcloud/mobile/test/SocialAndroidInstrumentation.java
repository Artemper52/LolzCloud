package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.NotificationManager;
import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import com.lolzcloud.mobile.LibraryStore;
import com.lolzcloud.mobile.MainActivity;
import com.lolzcloud.mobile.OnlineActivity;
import com.lolzcloud.mobile.PlaybackService;
import com.lolzcloud.mobile.SocialNotifications;
import com.lolzcloud.mobile.Track;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Isolated emulator tests using real private storage, MediaPlayer and Android NotificationManager. */
public final class SocialAndroidInstrumentation extends Instrumentation {
    private final JSONArray checks = new JSONArray();
    private final JSONArray diagnostics = new JSONArray();
    private MainActivity activity;
    private PlaybackService player;
    private boolean backOnly;
    private boolean rolesOnly;
    private boolean uploadOnly;
    private boolean withoutPicker;
    private interface Condition { boolean evaluate() throws Exception; }
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); backOnly=arguments!=null&&"back".equals(arguments.getString("phase"));rolesOnly=arguments!=null&&"roles".equals(arguments.getString("phase"));uploadOnly=arguments!=null&&"upload".equals(arguments.getString("phase"));withoutPicker=arguments!=null&&"without-picker".equals(arguments.getString("phase")); start(); }
    @Override public void callActivityOnCreate(Activity target,Bundle state){
        super.callActivityOnCreate(target,state);
        // This suite declares own-origin UI fixtures, not an authenticated user. Stop only
        // startup page scripts before queued unauthenticated redirects can launch real login.
        // Native WebViewClient/ChromeClient/picker handlers remain the production objects.
        if(target instanceof OnlineActivity)try{WebView view=(WebView)field(target,"webView");if(view!=null)view.getSettings().setJavaScriptEnabled(false);}catch(Exception error){throw new RuntimeException(error);}
    }
    @Override public void onStart() {
        JSONObject report = new JSONObject(); int result = Activity.RESULT_OK;
        try {
            try(InputStream shell=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("getprop ro.kernel.qemu"))){
                byte[] value=new byte[32];int length=shell.read(value);check(length>0&&new String(value,0,length,StandardCharsets.UTF_8).trim().equals("1"),"Only an isolated emulator may run mutation checks");
            }
            Intent launcher=getTargetContext().getPackageManager().getLaunchIntentForPackage(getTargetContext().getPackageName());
            if(launcher==null)throw new AssertionError("Production launcher intent is unavailable");
            activity = (MainActivity) startActivitySync(launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            await(() -> { player = (PlaybackService) field(activity,"player"); return player != null; }, 15_000, "Production audio service binding");
            if(rolesOnly)rolesDrawer();else if(uploadOnly)uploadChooser();else{if(!backOnly){offline();if(!withoutPicker)uploadChooser();notifications();}backDrawer();}
            report.put("status", "passed");
        } catch (Throwable error) { result = Activity.RESULT_CANCELED; try { report.put("status","failed"); report.put("error",error.toString()); } catch(Exception ignored){} }
        try {
            report.put("checks", checks);
            report.put("diagnostics", diagnostics);
            File output = new File(getTargetContext().getFilesDir(),rolesOnly?"android-social-roles-test.json":uploadOnly?"android-social-upload-test.json":withoutPicker?"android-social-core-test.json":backOnly?"android-social-back-test.json":"android-social-native-test.json");
            try(FileOutputStream stream=new FileOutputStream(output)){stream.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
            Bundle out=new Bundle();out.putString("stream",report.toString(2)+"\n");finish(result,out);
        } catch(Exception error){Bundle out=new Bundle();out.putString("stream",error.toString());finish(0,out);}
    }

    private void backDrawer() throws Exception {
        onMain(()->{try{diagnostics.put(new JSONObject().put("phase","before-Back-main-lifecycle").put("finishing",activity.isFinishing()).put("destroyed",activity.isDestroyed()).put("focus",activity.hasWindowFocus()).put("task",activity.getTaskId()).put("baseAction",activity.getIntent().getAction()));}catch(Exception error){throw new RuntimeException(error);}});
        await(()->activity.hasWindowFocus(),10000,"Native activity is foreground before hardware Back regression");
        OnlineActivity room=openOnlineFixture("https://lolzcloud.com/room/0123456789abcdef0123456789abcdef?back-fixture="+UUID.randomUUID(),"room");
        WebView web=(WebView)field(room,"webView");String[] roomUrl={null};onMain(()->roomUrl[0]=web.getUrl());
        try {
            installActualSocialDrawer(web,"room");
            waitScript(web,"!!window.LolzCloudSocial&&window.LolzCloudSocial.isOpen()&&!!document.querySelector('dialog[open]')",10000,"Actual social.js opens an HTML drawer over the room fixture");
            boolean[] noHistory={false};onMain(()->{web.clearHistory();noHistory[0]=!web.canGoBack();});
            check(noHistory[0],"Back fixture starts without native WebView history");
            shellBack();
            long backDeadline=SystemClock.elapsedRealtime()+5000;boolean processed=false;
            while(SystemClock.elapsedRealtime()<backDeadline){boolean[] ended={false};onMain(()->ended[0]=room.isFinishing()||room.isDestroyed());if(ended[0]||"false".equals(evaluate(web,"window.LolzCloudSocial.isOpen()"))){processed=true;break;}SystemClock.sleep(80);}
            check(processed,"First hardware Back is processed");
            check(!room.isFinishing()&&!room.isDestroyed(),"First system Back closes the social drawer without finishing the room activity");
            check(field(room,"webView")==web&&roomUrl[0].equals(new JSONArray("["+evaluate(web,"location.href")+"]").getString(0)),"First Back preserves the exact WebView instance and room URL");
            check("true".equals(evaluate(web,"!window.LolzCloudSocial.isOpen()&&!document.querySelector('dialog[open]')&&document.body.dataset.page==='room'&&window.__roomDocument===document.getElementById('room-player')&&window.__roomDocument.isConnected")),"Closing the real drawer retains the same connected room player DOM");
            shellBack();
            await(()->room.isFinishing()||room.isDestroyed(),5000,"Second system Back follows normal native history/finish behavior");
        } finally {onMain(room::finish);}
        await(()->activity.hasWindowFocus(),10000,"Return to native activity after leaving the room");
        OnlineActivity standalone=openOnlineFixture("https://lolzcloud.com/social?back-fixture="+UUID.randomUUID(),"social");
        try {
            WebView own=(WebView)field(standalone,"webView");installActualSocialDrawer(own,"social");
            waitScript(own,"!!window.LolzCloudSocial&&window.LolzCloudSocial.isOpen()&&document.body.dataset.page==='social'",10000,"Actual standalone social page is open for Back regression");
            onMain(own::clearHistory);shellBack();
            await(()->standalone.isFinishing()||standalone.isDestroyed(),5000,"Standalone social page exits normally without a close()/Back loop");
        } finally {onMain(standalone::finish);}
    }
    private OnlineActivity openOnlineFixture(String url,String page)throws Exception{
        ActivityMonitor monitor=addMonitor(OnlineActivity.class.getName(),null,false);
        onMain(()->activity.startActivity(new Intent(activity,OnlineActivity.class).putExtra("url",url).putExtra("title","Back regression fixture")));
        OnlineActivity online=(OnlineActivity)waitForMonitorWithTimeout(monitor,10000);removeMonitor(monitor);check(online!=null,"Open native "+page+" Activity for hardware Back test");
        WebView web=(WebView)field(online,"webView");
        onMain(()->{web.stopLoading();web.getSettings().setJavaScriptEnabled(false);web.loadUrl(url);});
        await(()->url.equals(web.getUrl())&&web.getProgress()==100,10000,"Own-origin "+page+" fixture loaded without an account");
        onMain(()->web.getSettings().setJavaScriptEnabled(true));
        String html="<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body data-page='"+page+"'><header><div id='account'></div></header><main id='social-root'></main><iframe id='room-player' src='https://w.soundcloud.com/'></iframe></body></html>";
        evaluate(web,"document.open();document.write("+JSONObject.quote(html)+");document.close();window.__roomDocument=document.getElementById('room-player');true;");
        return online;
    }
    private void installActualSocialDrawer(WebView web,String page)throws Exception{
        String script;
        try(InputStream input=getTargetContext().getAssets().open("room-client/social.js");java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);script=new String(output.toByteArray(),StandardCharsets.UTF_8);
        }
        // Explicit UI fixtures only: no cookie, real login, server mutation or invitation is fabricated.
        evaluate(web,"window.LolzCloudSessionReady=Promise.resolve({user:{id:991,name:'Declared UI fixture'}});window.LolzCloudSite={request:function(){return Promise.resolve({userId:991,notifications:[],unread:0,revision:1,enabled:true});},avatar:function(){return document.createElement('span');}};true;");
        evaluate(web,script);
        evaluate(web,"window.LolzCloudSocial.open('notifications');true;");
    }
    private void rolesDrawer()throws Exception{
        OnlineActivity room=openOnlineFixture("https://lolzcloud.com/room/0123456789abcdef0123456789abcdef?roles-fixture="+UUID.randomUUID(),"room");
        WebView web=(WebView)field(room,"webView");
        try{
            String script=assetText("room-client/social.js");
            evaluate(web,"var style=document.createElement('link');style.rel='stylesheet';style.href='/cloud/social.css';document.head.append(style);window.__roleRequests=[];window.__ownerProfile={id:991,name:'Declared Owner',url:'https://lolz.team/members/991/',roles:[{id:'owner',label:'Владелец',source:'lolzcloud'}],titles:[],background:{preset:'forest'},relationship:'self',revision:1,canManageRoles:true};window.__testerProfile={id:992,name:'Declared Tester',url:'https://lolz.team/members/992/',roles:[{id:'tester',label:'Тестер',source:'lolzcloud'},{id:'owner',label:'Untrusted fixture',source:'lolzteam'}],titles:[{id:'member',label:'Участник',source:'lolzteam'}],background:{preset:'forest'},relationship:'none',revision:1,canManageRoles:true};window.LolzCloudSessionReady=Promise.resolve({user:window.__ownerProfile});window.LolzCloudSite={avatar:function(){return document.createElement('span');},request:function(path,data,method){window.__roleRequests.push({path:path,method:method||'GET'});if(method&&method!=='GET')return Promise.reject(new Error('This fixture does not submit role mutations'));return Promise.resolve(path==='/api/social/me'?{profile:window.__ownerProfile}:path==='/api/social/users/992'?{profile:window.__testerProfile}:{userId:991,notifications:[],unread:0,revision:1,enabled:true});}};true;");
            evaluate(web,script);evaluate(web,"window.LolzCloudSocial.open('profile',{userId:992});true;");
            waitScript(web,"!!document.querySelector('[data-app-role=\"tester\"]')&&!!document.querySelector('[data-manage-roles]')&&!document.querySelector('[aria-busy=\"true\"]')",5000,"Actual bundled social.js renders the declared tester profile and management entry");
            waitScript(web,"getComputedStyle(document.querySelector('[data-app-role=\"tester\"]')).fontWeight==='600'",3000,"Actual bundled stylesheet loads through the allowed same-origin asset route");
            diagnostics.put(new JSONObject().put("phase","tester-computed-style").put("dom",evaluate(web,"JSON.stringify((function(){var b=document.querySelector('[data-app-role=\"tester\"]'),s=getComputedStyle(b);return{text:b.textContent,width:b.getBoundingClientRect().width,display:s.display,fontWeight:s.fontWeight,border:s.borderTopStyle};})())")));
            check("true".equals(evaluate(web,"(function(){var b=document.querySelector('[data-app-role=\"tester\"]'),s=getComputedStyle(b);return b.textContent==='Тестер'&&b.getBoundingClientRect().width>0&&['inline-flex','flex'].includes(s.display)&&s.fontWeight==='600'&&s.borderTopStyle==='solid';})()")),"Tester badge is visible and styled by the APK's actual social.css");
            check("true".equals(evaluate(web,"!document.querySelector('[data-app-role=\"owner\"]')&&document.querySelector('.social-verified').textContent.includes('Участник')")),"Untrusted-source app role is omitted while verified forum title remains separate");
            evaluate(web,"document.querySelector('[data-manage-roles]').id='fixture-manage-roles';true;");tapElement(web,"fixture-manage-roles");
            waitScript(web,"!!document.querySelector('#social-role-editor')&&document.getElementById('social-role-tester').checked&&!document.getElementById('social-role-owner').checked",3000,"A real WebView touch opens the native-hosted role editor with the declared server selection");
            check("true".equals(evaluate(web,"document.getElementById('social-role-owner').getBoundingClientRect().width>=18&&document.getElementById('social-role-tester').getBoundingClientRect().width>=18")),"Both role controls render with usable Android WebView dimensions");
            evaluate(web,"[...document.querySelectorAll('.social-role-footer button')].find(b=>b.textContent==='Отмена').id='fixture-cancel-roles';true;");tapElement(web,"fixture-cancel-roles");
            waitScript(web,"!document.querySelector('#social-role-editor')&&!document.querySelector('[data-manage-roles]').hidden",3000,"Actual role-editor Cancel restores the management action without submitting a mutation");
            evaluate(web,"window.LolzCloudSocial.open('profile');true;");
            waitScript(web,"!!document.querySelector('[data-app-role=\"owner\"]')&&!document.querySelector('[data-manage-roles]')",3000,"Owner badge is shown on the own profile and self role-edit controls are absent");
            check("true".equals(evaluate(web,"window.__roleRequests.every(r=>r.method==='GET')&&window.__roleRequests.some(r=>r.path==='/api/social/users/992')")),"Role rendering and Cancel remain declared read-only fixtures with no personal login or real role grant");
        }finally{onMain(room::finish);}
    }
    private String assetText(String path)throws Exception{try(InputStream input=getTargetContext().getAssets().open(path);java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return new String(output.toByteArray(),StandardCharsets.UTF_8);}}
    private void shellBack()throws Exception{try(InputStream shell=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK"))){while(shell.read()!=-1){}}}

    private void uploadChooser() throws Exception {
        ActivityMonitor monitor=addMonitor(OnlineActivity.class.getName(),null,false);
        onMain(()->activity.startActivity(new Intent(activity,OnlineActivity.class).putExtra("url","https://lolzcloud.com/social?tab=profile").putExtra("title","Upload policy fixture")));
        OnlineActivity online=(OnlineActivity)waitForMonitorWithTimeout(monitor,10000);removeMonitor(monitor);
        check(online!=null,"Own social page is available for native image upload");
        WebView web=(WebView)field(online,"webView");
        try {
            // No account is fabricated. Disable the app auth/redirect script only while loading
            // our actual bundled own-origin document, then replace it with an explicit test form.
            // All native navigation, MIME, frame and ValueCallback handlers remain production.
            String fixtureUrl="https://lolzcloud.com/social?native-upload-fixture="+UUID.randomUUID();
            onMain(()->{web.stopLoading();web.getSettings().setJavaScriptEnabled(false);web.loadUrl(fixtureUrl);});
            await(()->fixtureUrl.equals(web.getUrl())&&web.getProgress()==100,10000,"Actual bundled social fixture document loaded without a personal account");
            onMain(()->web.getSettings().setJavaScriptEnabled(true));
            String form="<h1>Native upload fixture</h1><input id='avatar' type='file' accept='image/jpeg,image/png'><iframe id='provider' tabindex='0' src='https://w.soundcloud.com/'></iframe>";
            evaluate(web,"document.open();document.write("+JSONObject.quote("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body>"+form+"</body></html>")+");document.close();window.__imageResult=null;document.getElementById('avatar').addEventListener('change',function(){var f=this.files[0];if(!f)return;var reader=new FileReader();reader.onerror=function(){window.__imageResult={error:'FileReader failed'};};reader.onload=function(){var img=new Image();img.onerror=function(){window.__imageResult={error:'Image decode failed'};};img.onload=function(){try{var c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;var ctx=c.getContext('2d');ctx.drawImage(img,0,0);window.__imageResult={name:f.name,type:f.type,size:f.size,width:c.width,height:c.height,pixel:Array.from(ctx.getImageData(0,0,1,1).data)};}catch(e){window.__imageResult={error:String(e)};}};img.src=reader.result;};reader.readAsDataURL(f);});true;");
            check(fixtureUrl.equals(new JSONArray("["+evaluate(web,"location.href")+"]").getString(0)),"The isolated form retains the trusted social main-frame URL");
            check("true".equals(evaluate(web,"!!document.getElementById('avatar')&&!!document.getElementById('provider')")),"Isolated form exists in the genuine own-origin document");
            String frameFocus=evaluate(web,"(function(){var e=document.getElementById('provider');if(e)e.focus();return document.activeElement.tagName;})()");
            diagnostics.put(new JSONObject().put("phase","upload-fixture").put("frameFocus",frameFocus)
                    .put("dom",evaluate(web,"JSON.stringify({url:location.href,ready:document.readyState,visibility:document.visibilityState,avatar:!!document.getElementById('avatar'),provider:!!document.getElementById('provider'),active:document.activeElement.tagName,body:document.body.innerHTML.slice(0,900)})")));
            check("\"IFRAME\"".equals(frameFocus),"Frame-focused file request has an iframe as top-level active element");
            final boolean[] frameDone={false};final Uri[][] frameValue={null};
            onMain(()->web.getWebChromeClient().onShowFileChooser(web,value->{frameValue[0]=value;frameDone[0]=true;},imageParams()));
            await(()->frameDone[0],5000,"Provider-frame upload request is explicitly cancelled");
            check(frameValue[0]==null&&field(online,"imageCallback")==null,"Provider frames receive no native file URI or picker");
            check("\"INPUT\"".equals(evaluate(web,"document.getElementById('avatar').focus();document.activeElement.tagName")),"Only a focused top-level file input can open the picker");
            tapElement(web,"avatar");
            await(()->activePackage().contains("documentsui"),10000,"A genuine top-level input tap opens the real Android system document picker");
            try(InputStream shell=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK"))){while(shell.read()!=-1){}}
            await(()->field(online,"imageCallback")==null&&!activePackage().contains("documentsui"),10000,"Cancelling the system picker resolves the production WebView callback");
            check("0".equals(evaluate(web,"document.getElementById('avatar').files.length")),"Cancelled image selection exposes no file URI to the page");
            tapElement(web,"avatar");
            await(()->activePackage().contains("documentsui"),10000,"Real input can reopen the system picker after cancellation");
            // Always choose the dedicated root, even if Recents/last-used already shows this name.
            // A tile visible during the Activity opening animation is not yet a reliable touch target.
            SystemClock.sleep(500);
            check(clickNode(new String[]{"Show roots","Open navigation drawer","Показать корневые папки","Открыть меню навигации"},true,4000),"Open actual SAF root menu");
            check(clickImageRoot(5000),"PNG-only test provider appears in the real Android picker");
            getUiAutomation().waitForIdle(200,3000);
            SystemClock.sleep(300);
            check(clickImageFile(5000),"Select the real provider-backed PNG document");
            await(()->!activePackage().contains("documentsui"),10000,"Selecting the PNG actually returns from the system picker");
            diagnostics.put(new JSONObject().put("phase","after-image-selection").put("pendingNativeCallback",field(online,"imageCallback")!=null)
                    .put("dom",evaluate(web,"JSON.stringify({url:location.href,files:document.getElementById('avatar').files.length,result:window.__imageResult})")));
            waitScript(web,"!!window.__imageResult",15000,"Production chooser callback delivers actual image bytes to FileReader and Canvas");
            String raw=evaluate(web,"JSON.stringify(window.__imageResult)");String decoded=new JSONArray("["+raw+"]").getString(0);JSONObject image=new JSONObject(decoded);
            diagnostics.put(new JSONObject().put("phase","successful-image-upload").put("result",image));
            check(!image.has("error")&&image.getInt("width")==8&&image.getInt("height")==8&&image.getString("type").equals("image/png")&&image.getLong("size")>0,"Native SAF image decodes with the genuine MIME, dimensions and nonempty bytes");
            JSONArray pixel=image.getJSONArray("pixel");
            check(pixel.getInt(0)==85&&pixel.getInt(1)==170&&pixel.getInt(2)==119&&pixel.getInt(3)==255,"Canvas reads the PNG provider's exact generated RGBA pixel");
            tapElement(web,"avatar");await(()->activePackage().contains("documentsui"),10000,"Open a genuine pending picker for Activity teardown");
            onMain(online::finish);
            await(()->field(online,"imageCallback")==null,10000,"Activity destruction cancels the genuine outstanding chooser callback");
            if(activePackage().contains("documentsui"))try(InputStream shell=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK"))){while(shell.read()!=-1){}}
        } finally {onMain(online::finish);if(activePackage().contains("documentsui"))try(InputStream shell=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK"))){while(shell.read()!=-1){}}}
    }
    private WebChromeClient.FileChooserParams imageParams(){return new WebChromeClient.FileChooserParams(){
        @Override public int getMode(){return MODE_OPEN;}
        @Override public String[] getAcceptTypes(){return new String[]{"image/jpeg","image/png"};}
        @Override public boolean isCaptureEnabled(){return false;}
        @Override public CharSequence getTitle(){return "Profile image";}
        @Override public String getFilenameHint(){return null;}
        @Override public Intent createIntent(){return new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*");}
    };}
    private void waitScript(WebView web,String script,long timeout,String label)throws Exception{
        long deadline=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<deadline){if("true".equals(evaluate(web,script))){check(true,label);return;}SystemClock.sleep(100);}
        diagnostics.put(new JSONObject().put("phase",label).put("dom",evaluate(web,"JSON.stringify({url:location.href,ready:document.readyState,body:document.body?document.body.innerText.slice(0,400):''})")));
        check(false,label);
    }
    private void tapElement(WebView web,String id)throws Exception{
        String raw=evaluate(web,"JSON.stringify((function(){var e=document.getElementById("+JSONObject.quote(id)+");e.scrollIntoView();var r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,width:innerWidth};})())");
        JSONObject rect=new JSONObject(new JSONArray("["+raw+"]").getString(0));int[] location=new int[2];int[] width={0};onMain(()->{web.requestFocus();web.getLocationOnScreen(location);width[0]=web.getWidth();});
        float scale=(float)(width[0]/rect.getDouble("width"));float x=location[0]+(float)rect.getDouble("x")*scale,y=location[1]+(float)rect.getDouble("y")*scale;
        long now=SystemClock.uptimeMillis();android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,x,y,0),up=android.view.MotionEvent.obtain(now,now+80,android.view.MotionEvent.ACTION_UP,x,y,0);
        try{sendPointerSync(down);sendPointerSync(up);}finally{down.recycle();up.recycle();}
    }
    private String activePackage(){android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();if(root==null)return "";try{return root.getPackageName()==null?"":root.getPackageName().toString();}finally{root.recycle();}}
    private boolean clickImageFile(long timeout)throws Exception{
        long deadline=SystemClock.elapsedRealtime()+timeout;
        pickerDiagnostic("before");
        while(SystemClock.elapsedRealtime()<deadline){
            android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
            if(root!=null&&findNode(root,new String[]{"Open from","Открыть из"},false)!=null){root.recycle();SystemClock.sleep(100);continue;}
            if(root!=null){android.view.accessibility.AccessibilityNodeInfo file=findNode(root,new String[]{"native-avatar.png"},false);
                if(file==null)file=findNode(root,new String[]{"native-avatar.png,"},true);
                if(file!=null){android.graphics.Rect bounds=new android.graphics.Rect();file.getBoundsInScreen(bounds);
                    diagnostics.put(new JSONObject().put("phase","SAF PNG tile tap").put("bounds",bounds.toShortString()).put("package",activePackage()));
                    android.view.accessibility.AccessibilityNodeInfo target=file;
                    while(!target.isClickable()&&target.getParent()!=null)target=target.getParent();
                    boolean selected=target.isEnabled()&&target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
                    diagnostics.put(new JSONObject().put("phase","SAF PNG accessibility action").put("clicked",selected).put("fileEnabled",file.isEnabled()).put("fileVisible",file.isVisibleToUser()).put("targetClass",String.valueOf(target.getClassName())));
                    root.recycle();
                    if(!selected&&!bounds.isEmpty()){
                        // DocumentsUI handles image-grid taps in its RecyclerView gesture
                        // listener, which need not expose ACTION_CLICK on the image node.
                        // Ask Android's input command to deliver a complete real touch at
                        // this observed tile; never replace the picker URI or callback.
                        try(InputStream shell=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand("input touchscreen tap "+bounds.centerX()+" "+bounds.centerY()))){while(shell.read()!=-1){}}
                        diagnostics.put(new JSONObject().put("phase","SAF PNG system input tap").put("x",bounds.centerX()).put("y",bounds.centerY()));
                    }
                    long dispatchDeadline=Math.min(deadline,SystemClock.elapsedRealtime()+900);
                    while(SystemClock.elapsedRealtime()<dispatchDeadline){if(!activePackage().contains("documentsui"))return true;SystemClock.sleep(80);}
                    // System transitions may consume the first tap. Retry only this still-visible
                    // declared PNG tile; never substitute a URI or invoke the production callback.
                    if(!activePackage().contains("documentsui"))return true;
                    continue;
                }root.recycle();
            }SystemClock.sleep(100);
        }pickerDiagnostic("after");return false;
    }
    private boolean clickImageRoot(long timeout)throws Exception{
        long deadline=SystemClock.elapsedRealtime()+timeout;
        while(SystemClock.elapsedRealtime()<deadline){
            android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
            if(root!=null){android.view.accessibility.AccessibilityNodeInfo found=findLastNode(root,"LolzCloud images");
                if(found!=null){android.graphics.Rect bounds=new android.graphics.Rect();found.getBoundsInScreen(bounds);root.recycle();
                    diagnostics.put(new JSONObject().put("phase","SAF drawer provider row").put("bounds",bounds.toShortString()));
                    long now=SystemClock.uptimeMillis();android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,bounds.centerX(),bounds.centerY(),0),up=android.view.MotionEvent.obtain(now,now+80,android.view.MotionEvent.ACTION_UP,bounds.centerX(),bounds.centerY(),0);
                    try{down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);getUiAutomation().injectInputEvent(down,true);getUiAutomation().injectInputEvent(up,true);}finally{down.recycle();up.recycle();}
                    SystemClock.sleep(250);
                    root=getUiAutomation().getRootInActiveWindow();boolean open=root!=null&&findNode(root,new String[]{"Open from","Открыть из"},false)!=null;if(root!=null)root.recycle();
                    // Selecting the already-current provider can leave the drawer visible. Back
                    // closes only that confirmed open drawer, never the document picker itself.
                    if(open)shellBack();
                    while(SystemClock.elapsedRealtime()<deadline){root=getUiAutomation().getRootInActiveWindow();if(root!=null){boolean closed=findNode(root,new String[]{"Open from","Открыть из"},false)==null;boolean correct=findNode(root,new String[]{"LolzCloud images"},false)!=null;root.recycle();if(closed&&correct)return true;}SystemClock.sleep(100);}return false;
                }root.recycle();
            }SystemClock.sleep(100);
        }return false;
    }
    private android.view.accessibility.AccessibilityNodeInfo findLastNode(android.view.accessibility.AccessibilityNodeInfo node,String text){android.view.accessibility.AccessibilityNodeInfo result=node.getText()!=null&&node.getText().toString().equals(text)?node:null;for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);if(child!=null){android.view.accessibility.AccessibilityNodeInfo found=findLastNode(child,text);if(found!=null)result=found;}}return result;}
    private void pickerDiagnostic(String phase)throws Exception{
        android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();JSONArray nodes=new JSONArray();if(root!=null){describeNodes(root,nodes,0);root.recycle();}
        diagnostics.put(new JSONObject().put("phase","SAF "+phase).put("nodes",nodes));android.graphics.Bitmap bitmap=getUiAutomation().takeScreenshot();if(bitmap!=null){File file=new File(getTargetContext().getExternalFilesDir(null),"social-picker-"+phase+".png");try(FileOutputStream output=new FileOutputStream(file)){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}finally{bitmap.recycle();}diagnostics.put(new JSONObject().put("phase","SAF "+phase+" screenshot").put("path",file.getAbsolutePath()));}
    }
    private void describeNodes(android.view.accessibility.AccessibilityNodeInfo node,JSONArray rows,int depth)throws Exception{if(depth>12||rows.length()>=100)return;android.graphics.Rect bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);rows.put(new JSONObject().put("text",String.valueOf(node.getText())).put("description",String.valueOf(node.getContentDescription())).put("class",String.valueOf(node.getClassName())).put("enabled",node.isEnabled()).put("clickable",node.isClickable()).put("selected",node.isSelected()).put("bounds",bounds.toShortString()));for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);if(child!=null){describeNodes(child,rows,depth+1);child.recycle();}}}
    private boolean clickNode(String[] labels,boolean description,long timeout){
        long deadline=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<deadline){android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();if(root!=null){android.view.accessibility.AccessibilityNodeInfo found=findNode(root,labels,description);if(found!=null){android.graphics.Rect bounds=new android.graphics.Rect();found.getBoundsInScreen(bounds);while(!found.isClickable()&&found.getParent()!=null)found=found.getParent();if(found.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)){root.recycle();return true;}if(!bounds.isEmpty()){long now=SystemClock.uptimeMillis();android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,bounds.centerX(),bounds.centerY(),0),up=android.view.MotionEvent.obtain(now,now+80,android.view.MotionEvent.ACTION_UP,bounds.centerX(),bounds.centerY(),0);try{down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);getUiAutomation().injectInputEvent(down,true);getUiAutomation().injectInputEvent(up,true);}finally{down.recycle();up.recycle();}root.recycle();return true;}}root.recycle();}SystemClock.sleep(100);}return false;
    }
    private android.view.accessibility.AccessibilityNodeInfo findNode(android.view.accessibility.AccessibilityNodeInfo node,String[] labels,boolean description){
        if(node==null)return null;CharSequence value=description?node.getContentDescription():node.getText();if(value!=null)for(String label:labels)if(value.toString().equals(label)||description&&label.endsWith(",")&&value.toString().startsWith(label))return node;
        for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=findNode(node.getChild(i),labels,description);if(found!=null)return found;}return null;
    }
    private String evaluate(WebView web,String script)throws Exception{
        java.util.concurrent.CountDownLatch ready=new java.util.concurrent.CountDownLatch(1);String[] value={null};
        onMain(()->web.evaluateJavascript(script,result->{value[0]=result;ready.countDown();}));
        if(!ready.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("WebView evaluation timed out");
        return value[0];
    }

    private void offline() throws Exception {
        LibraryStore store = new LibraryStore(getTargetContext());
        SharedPreferences prefs = store.preferences(); Map<String,?> before = prefs.getAll();
        List<Track> previous = player.queue(); int previousIndex = player.currentIndex(); long previousPosition = player.position(); boolean playing = player.isPlaying();
        File directory = new File(getTargetContext().getFilesDir(),"offline");directory.mkdirs();
        File audio = new File(directory,"test-"+UUID.randomUUID()+".audio");
        File replacement = new File(directory,"test-"+UUID.randomUUID()+".audio");
        try {
            try(InputStream input=getContext().getAssets().open("fixtures/night-route.mp3");FileOutputStream output=new FileOutputStream(audio)){
                byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            }
            Track stream = store.addStream("https://audio.example.test/"+UUID.randomUUID()+".mp3","Offline regression fixture");
            if(!store.isLiked(stream.id))store.toggleLike(stream.id);
            store.saveLyrics(stream.id,"[00:01.00]Fixture");
            store.saveQueue(Arrays.asList(stream),0,1234);store.setPrivateMode(false);store.recordPlayed(stream);
            Track local=new Track(stream.id,stream.title,stream.artist,Uri.fromFile(audio).toString(),40000,stream.addedAt);
            store.replaceWithOffline(stream,local);
            check(store.find(stream.id).uri.equals(local.uri),"Offline conversion replaces the original HTTPS row instead of duplicate-id no-op");
            check(store.isLiked(stream.id)&&store.lyrics(stream.id).contains("Fixture"),"Offline conversion preserves identity, likes and imported lyrics");
            check(store.savedQueue().size()==1&&store.savedQueue().get(0).uri.equals(local.uri)&&store.savedPosition()==1234,"Saved queue and resume position point to the real local file");
            check(store.history().get(0).uri.equals(local.uri),"History opens the saved local source");
            onMain(()->player.setQueue(Arrays.asList(local),0,true));
            await(()->player.isPlaying()&&player.position()>400&&player.duration()>10000,15000,"Offline source is actually played by the native MediaPlayer");
            check(player.current().uri.startsWith("file:"),"Actual playback source is private file, with no stream/network dependency");
            java.nio.file.Files.copy(audio.toPath(),replacement.toPath());
            Track updated=new Track(local.id,local.title,local.artist,Uri.fromFile(replacement).toString(),local.duration,local.addedAt);
            onMain(()->player.seekTo(7000));await(()->player.position()>=7000,5000,"Seek fixture before active source replacement");
            long resumePosition=player.position();
            onMain(()->player.replaceStoredTrack(updated));
            await(()->player.isPlaying()&&player.current().uri.equals(updated.uri)&&player.position()>=resumePosition-300,10000,"Active MediaPlayer adopts the saved source and resumes its existing position");
            check(player.queue().size()==1&&player.currentIndex()==0&&player.current().id.equals(stream.id),"Active source replacement retains queue identity and index");
            boolean rejected=false;try{store.replaceWithOffline(stream,local);}catch(java.io.IOException expected){rejected=true;}
            check(rejected,"A stale second download cannot overwrite an already changed source");
            ActivityMonitor monitor=addMonitor(OnlineActivity.class.getName(),null,false);
            onMain(()->invoke(activity,"openSocial",new Class<?>[]{String.class},"profile"));
            Activity opened=waitForMonitorWithTimeout(monitor,10000);removeMonitor(monitor);
            check(opened!=null,"Native social entry opens the real OnlineActivity");
            check(player.isPlaying(),"Opening the shared social/profile page does not pause native music");
            WebView web=(WebView)field(opened,"webView");
            await(()->web.getProgress()==100,10000,"The isolated own-origin view is ready before room handoff");
            onMain(()->web.getSettings().setJavaScriptEnabled(true));
            evaluate(web,"document.open();document.write('<!doctype html><html><body data-page=rooms>Declared room-list UI fixture</body></html>');document.close();history.replaceState(null,'','/rooms');true;");
            SystemClock.sleep(300);
            check(player.isPlaying(),"Browsing the isolated same-origin /rooms view keeps native music playing");
            onMain(()->{web.getSettings().setJavaScriptEnabled(false);web.loadUrl("https://lolzcloud.com/room/0123456789abcdef0123456789abcdef");});
            await(()->!player.isPlaying()&&!player.isLoading(),10000,"Actual same-origin room entry pauses the native player before room audio");
            check(player.current().id.equals(stream.id)&&player.queue().size()==1&&player.position()>0,"Room handoff retains local queue and resume position");
            onMain(opened::finish);
        } finally {
            onMain(()->{
                while(!player.queue().isEmpty())player.removeFromQueue(0);
                if(!previous.isEmpty()){player.setQueue(previous,Math.max(0,previousIndex),playing);player.seekTo(previousPosition);}
                restore(prefs,before);
            });
            audio.delete();replacement.delete();
        }
    }

    private void notifications() throws Exception {
        SocialNotifications social=SocialNotifications.get(getTargetContext());
        await(()->activity.hasWindowFocus(),10000,"Return to the real native activity before notification UI assertions");
        await(()->!(Boolean)field(social,"busy"),35000,"Finish any genuine API check before native fixture delivery");
        Handler handler=(Handler)field(social,"main");Runnable poll=(Runnable)field(social,"poll");
        SharedPreferences prefs=(SharedPreferences)field(social,"prefs");Map<String,?> before=prefs.getAll();
        int activities=(Integer)field(social,"startedActivities");
        String user="native-test-"+UUID.randomUUID().toString().replace("-", "");
        String first=UUID.randomUUID().toString(),second=UUID.randomUUID().toString(),expired=UUID.randomUUID().toString();
        NotificationManager manager=(NotificationManager)getTargetContext().getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            onMain(()->{handler.removeCallbacks(poll);setField(social,"startedActivities",0);prefs.edit().putBoolean("enabled",true).apply();});
            check(social.systemAllowed(),"System notification permission/channel is genuinely enabled");
            apply(social,snapshot(user,true,event(first,false,false,"pending")));
            check(count(manager,user)==0,"First real Android snapshot establishes baseline without an old notification");
            apply(social,snapshot(user,true,event(second,false,false,"pending"),event(first,false,false,"pending")));
            await(()->count(manager,user)==1,3000,"A new unread friend request reaches Android's real NotificationManager");
            StatusBarNotification actual=find(manager,user);
            check(actual!=null&&"Запрос в друзья".equals(actual.getNotification().extras.getString(Notification.EXTRA_TITLE))
                    &&actual.getNotification().extras.getString(Notification.EXTRA_TEXT).contains("QA friend"),"System notification contains the genuine event type and actor");
            check(actual.getNotification().visibility==Notification.VISIBILITY_PRIVATE,"Social notification protects lock-screen content");
            if(android.os.Build.VERSION.SDK_INT>=31)check(actual.getNotification().contentIntent.isImmutable(),"Notification PendingIntent is immutable");
            apply(social,snapshot(user,true,event(second,false,false,"pending"),event(first,false,false,"pending")));
            check(count(manager,user)==1,"Repeated snapshot does not duplicate a native notification");
            check(prefs.getStringSet("seen_"+user,java.util.Collections.emptySet()).contains(second),"Dedup ids persist outside the page process");
            apply(social,snapshot(user,true,event(expired,false,true,"pending"),event(second,true,false,"pending")));
            long cancelStarted=SystemClock.elapsedRealtime();
            await(()->count(manager,user)==0,3000,"Read/expired events remove stale native notifications");
            diagnostics.put(new JSONObject().put("phase","Android notification cancellation").put("latencyMs",SystemClock.elapsedRealtime()-cancelStarted));
            apply(social,snapshot(user,false,event(UUID.randomUUID().toString(),false,false,"pending")));
            await(()->count(manager,user)==0,3000,"Server-disabled social notifications stay silent");
            onMain(()->setField(social,"startedActivities",1));
            final android.widget.EditText[] queryInput={null};
            onMain(()->{invoke(activity,"selectTab",new Class<?>[]{String.class},"search");try{queryInput[0]=(android.widget.EditText)field(activity,"searchInput");queryInput[0].setText("Сохранить ввод");queryInput[0].requestFocus();queryInput[0].setSelection(3);}catch(Exception error){throw new RuntimeException(error);}});
            apply(social,snapshot(user,true,event(UUID.randomUUID().toString(),false,false,"pending")));
            await(()->count(manager,user)==1,3000,"A new invitation remains visible as a system notification while app is foreground");
            final boolean[] badgeVisible={false};onMain(()->{try{android.widget.TextView badge=(android.widget.TextView)field(activity,"unreadBadge");badgeVisible[0]=badge!=null&&badge.getVisibility()==android.view.View.VISIBLE&&badge.getText().toString().equals("1");}catch(Exception error){throw new RuntimeException(error);}});
            check(badgeVisible[0],"Global profile badge reflects the real API unread count outside the profile page");
            final boolean[] inputPreserved={false};onMain(()->{try{inputPreserved[0]=queryInput[0]==field(activity,"searchInput")&&queryInput[0].getText().toString().equals("Сохранить ввод")&&queryInput[0].getSelectionStart()==3&&queryInput[0].hasFocus();}catch(Exception error){throw new RuntimeException(error);}});
            check(inputPreserved[0],"Unread badge updates preserve the existing search input, focus and cursor");
            onMain(()->setField(social,"startedActivities",0));
            apply(social,snapshot(user,true,event(UUID.randomUUID().toString(),false,false,"pending")));
            await(()->count(manager,user)==1,3000,"A later background event remains deliverable");
            actual=find(manager,user);
            ActivityMonitor monitor=addMonitor(OnlineActivity.class.getName(),null,false);
            actual.getNotification().contentIntent.send();
            Activity review=waitForMonitorWithTimeout(monitor,10000);removeMonitor(monitor);
            check(review!=null&&"https://lolzcloud.com/social?tab=notifications".equals(review.getIntent().getStringExtra("url")),"Real notification click opens the review page without accepting or joining a room");
            onMain(()->{review.finish();handler.removeCallbacks(poll);setField(social,"startedActivities",0);});
        } finally {
            for(StatusBarNotification notification:manager.getActiveNotifications())if(notification.getTag()!=null&&notification.getTag().startsWith("social:"+user+":"))manager.cancel(notification.getTag(),notification.getId());
            onMain(()->{restore(prefs,before);setField(social,"startedActivities",activities);if(activities>0)handler.postDelayed(poll,15000);});
        }
    }
    private JSONObject snapshot(String user,boolean enabled,JSONObject... events)throws Exception{
        JSONObject profile=new JSONObject().put("id",user).put("name","Native QA").put("preferences",new JSONObject().put("notificationsEnabled",true));
        JSONArray notes=new JSONArray();for(JSONObject event:events)notes.put(event);
        return new JSONObject().put("me",new JSONObject().put("profile",profile)).put("feed",new JSONObject().put("userId",user).put("enabled",enabled).put("notifications",notes).put("unread",events.length).put("revision",1));
    }
    private JSONObject event(String id,boolean read,boolean expired,String status)throws Exception{
        long now=System.currentTimeMillis();return new JSONObject().put("id",id).put("type","friend_request").put("actor",new JSONObject().put("id","42").put("name","QA friend"))
                .put("createdAt",now-1000).put("readAt",read?now:JSONObject.NULL).put("expiresAt",expired?now-10:now+60000).put("status",status);
    }
    private void apply(SocialNotifications social,JSONObject data)throws Exception{
        Class<?> api=Class.forName("com.lolzcloud.mobile.SocialApi");Method parse=api.getDeclaredMethod("parse",JSONObject.class,JSONObject.class);parse.setAccessible(true);
        Object snapshot=parse.invoke(null,data.getJSONObject("me"),data.getJSONObject("feed"));
        onMain(()->invoke(social,"apply",new Class<?>[]{snapshot.getClass()},snapshot));
    }
    private int count(NotificationManager manager,String user){int count=0;for(StatusBarNotification note:manager.getActiveNotifications())if(note.getTag()!=null&&note.getTag().startsWith("social:"+user+":"))count++;return count;}
    private StatusBarNotification find(NotificationManager manager,String user){for(StatusBarNotification note:manager.getActiveNotifications())if(note.getTag()!=null&&note.getTag().startsWith("social:"+user+":"))return note;return null;}
    private void check(boolean condition,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",condition));if(!condition)throw new AssertionError(label);}
    private void await(Condition condition,long timeout,String label)throws Exception{long limit=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<limit){final boolean[] result={false};final Exception[] failure={null};onMain(()->{try{result[0]=condition.evaluate();}catch(Exception e){failure[0]=e;}});if(failure[0]!=null)throw failure[0];if(result[0]){check(true,label);return;}SystemClock.sleep(80);}check(false,label);}
    private void onMain(Runnable task){runOnMainSync(task);}
    private static Object field(Object target,String name)throws Exception{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(target);}
    private static void setField(Object target,String name,Object value){try{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);field.set(target,value);}catch(Exception error){throw new RuntimeException(error);}}
    private static Object invoke(Object target,String name,Class<?>[] types,Object... args){try{Method method=target.getClass().getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(target,args);}catch(Exception error){throw new RuntimeException(error);}}
    @SuppressWarnings("unchecked")private static void restore(SharedPreferences prefs,Map<String,?> values){SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,?> row:values.entrySet()){Object value=row.getValue();String key=row.getKey();if(value instanceof String)edit.putString(key,(String)value);else if(value instanceof Integer)edit.putInt(key,(Integer)value);else if(value instanceof Long)edit.putLong(key,(Long)value);else if(value instanceof Float)edit.putFloat(key,(Float)value);else if(value instanceof Boolean)edit.putBoolean(key,(Boolean)value);else if(value instanceof Set)edit.putStringSet(key,(Set<String>)value);}edit.commit();}
}
