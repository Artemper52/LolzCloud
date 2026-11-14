package com.lolzcloud.mobile.test;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.inputmethod.*;
import android.widget.*;
import com.lolzcloud.mobile.*;
import org.json.*;
import java.io.*;
import java.lang.reflect.Field;
import java.util.*;
import java.util.concurrent.Callable;

/** Exercises the actual search, IME and dialog views. Browser intent is observed before launch. */
public final class VideoFixesInstrumentation extends Instrumentation {
    private MainActivity activity;
    private Bundle arguments;
    private final JSONArray checks=new JSONArray();
    private final List<Intent> browserIntents=Collections.synchronizedList(new ArrayList<>());
    private interface Condition { boolean get() throws Exception; }
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);this.arguments=arguments;start();}
    @Override public void onStart(){
        JSONObject report=new JSONObject();int result=Activity.RESULT_OK;
        try{
            if(!"1".equals(shell("getprop ro.kernel.qemu").trim()))throw new AssertionError("Emulator required");
            AccessibilityServiceInfo info=getUiAutomation().getServiceInfo();info.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;getUiAutomation().setServiceInfo(info);
            report.put("version",getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0).versionName);
            if(arguments!=null&&"snapshot".equals(arguments.getString("phase")))report.put("data",snapshot());else if(arguments!=null&&"layout".equals(arguments.getString("phase")))layout();else run();report.put("status","passed");
        }catch(Throwable error){result=Activity.RESULT_CANCELED;try{report.put("status","failed");report.put("error",error.toString());StringWriter trace=new StringWriter();error.printStackTrace(new PrintWriter(trace));report.put("trace",trace.toString());}catch(Exception ignored){}}
        try{report.put("checks",checks);try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"android-video-fixes.json"))){out.write(report.toString(2).getBytes("UTF-8"));}Bundle output=new Bundle();output.putString("stream",report.toString(2)+"\n");finish(result,output);}catch(Exception error){Bundle output=new Bundle();output.putString("stream",error.toString());finish(Activity.RESULT_CANCELED,output);}
    }
    private JSONObject snapshot()throws Exception{
        LibraryStore library=new LibraryStore(getTargetContext());JSONObject data=new JSONObject();data.put("preferences",new JSONObject(library.preferences().getAll()));JSONArray grants=new JSONArray();
        for(android.content.UriPermission permission:getTargetContext().getContentResolver().getPersistedUriPermissions())if(permission.isReadPermission())grants.put(permission.getUri().toString());
        data.put("persistedReadGrants",grants);return data;
    }
    private void layout()throws Exception{
        LibraryStore library=new LibraryStore(getTargetContext());String original=library.preferences().getString("theme","forest");
        library.preferences().edit().putString("theme","paper").putString("search_source","soundcloud").commit();
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        try{
            await(()->field(activity,"player")!=null,8000,"layout service binding");ui(()->{((PlaybackService)fieldUnchecked(activity,"player")).pause();return null;});
            check(activity.getResources().getConfiguration().fontScale>=1.95f&&activity.getResources().getConfiguration().screenWidthDp<=360,"Real 360dp device configuration with 200% system font");
            clickDescription("Поиск");ui(()->{input().setText("тёмный принц");return null;});focusInput();
            await(()->ui(()->input().getRootWindowInsets().isVisible(WindowInsets.Type.ime())),5000,"large-font search keyboard");
            check(ui(()->fullyVisible(input())),"Large-font query remains visible above the keyboard");
            screenshot("video-paper-large-search.png");
            ui(()->{View button=activity.findViewById(R.id.search_submit);button.requestRectangleOnScreen(new android.graphics.Rect(0,0,button.getWidth(),button.getHeight()),true);return null;});SystemClock.sleep(200);
            check(ui(()->fullyVisible(activity.findViewById(R.id.search_submit))),"Search action can be reached by scrolling with the keyboard visible");
            clickDescription("Комнаты");clickDescription("По приглашению. Открыть ссылку на комнату");
            focusLinkKeyboard();
            ui(()->{linkInput().setText("неверная ссылка");((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_POSITIVE).performClick();return null;});
            check(ui(()->linkError().getVisibility()==View.VISIBLE&&fullyVisible(((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_POSITIVE))),"Large-font invitation error leaves the Open action visible");
            check(ui(()->linkError().getAccessibilityLiveRegion()==View.ACCESSIBILITY_LIVE_REGION_POLITE),"Validation message is announced as an accessibility live region");
            screenshot("video-paper-large-invite.png");
            ui(()->{((AlertDialog)fieldUnchecked(activity,"linkDialog")).dismiss();return null;});clickDescription("Моя музыка");clickDescription("Добавить прямую HTTPS ссылку");
            focusLinkKeyboard();
            check(ui(()->fullyVisible(((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_NEGATIVE))&&fullyVisible(((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_POSITIVE))),"Long audio-link explanation scrolls while both dialog actions remain reachable");
            screenshot("video-paper-large-stream.png");ui(()->{((AlertDialog)fieldUnchecked(activity,"linkDialog")).dismiss();return null;});
        }finally{library.preferences().edit().putString("theme",original).commit();if(activity!=null)ui(()->{activity.finish();return null;});}
    }
    private boolean fullyVisible(View view){android.graphics.Rect rect=new android.graphics.Rect();return view!=null&&view.getGlobalVisibleRect(rect)&&rect.height()>=view.getHeight()-2&&rect.width()>=view.getWidth()-2;}
    private void run() throws Exception {
        LibraryStore library=new LibraryStore(getTargetContext());library.preferences().edit().putString("theme","forest").putString("search_source","soundcloud").commit();
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        await(()->field(activity,"player")!=null,8000,"service binding");ui(()->{((PlaybackService)fieldUnchecked(activity,"player")).pause();return null;});
        ActivityMonitor browser=new ActivityMonitor(){@Override public ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getData()!=null){browserIntents.add(new Intent(intent));return new ActivityResult(Activity.RESULT_CANCELED,null);}return null;}};
        addMonitor(browser);
        try{
            clickDescription("Поиск");
            check(ui(()->activity.findViewById(R.id.search_soundcloud).isSelected()),"Default source is visibly selected SoundCloud");
            check(ui(()->findText((View)fieldUnchecked(activity,"searchResults"),"Найди трек или вставь ссылку SoundCloud. Нажми «Найти», чтобы увидеть результаты.")!=null&&findText((View)fieldUnchecked(activity,"searchResults"),"Совпадений в библиотеке нет")==null),"Native SoundCloud scope displays its search hint, not a local-library empty state");
            ui(()->{activity.findViewById(R.id.search_submit).performClick();return null;});
            check(ui(()->((TextView)fieldUnchecked(activity,"searchError")).getVisibility()==View.VISIBLE)&&browserIntents.isEmpty(),"Empty online query stays in the field with an inline error");
            String query="тёмный принц";
            focusInput();setAccessibleText("Поиск музыки",query);
            check(ui(()->(input().getImeOptions()&EditorInfo.IME_MASK_ACTION)==EditorInfo.IME_ACTION_SEARCH),"Search field exposes the keyboard Search action");
            await(()->ui(()->input().getRootWindowInsets()!=null&&input().getRootWindowInsets().isVisible(WindowInsets.Type.ime())),5000,"visible real keyboard");
            screenshot("video-search-keyboard.png");
            AccessibilityNodeInfo node=nodeDescription(getUiAutomation().getRootInActiveWindow(),"Поиск музыки");
            check(node!=null&&node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId()),"Actual accessibility IME Enter action is accepted");
            await(()->ui(()->query.equals(fieldUnchecked(activity,"catalogQuery"))&&!((Boolean)fieldUnchecked(activity,"catalogLoading"))&&!((java.util.List<?>)fieldUnchecked(activity,"catalogTracks")).isEmpty()),35000,"native SoundCloud results from the actual IME action");
            check(browserIntents.isEmpty()&&ui(()->query.equals(fieldUnchecked(activity,"catalogQuery"))),"Actual keyboard Search displays native SoundCloud results for the Cyrillic query without a browser");
            check(ui(()->query.equals(input().getText().toString())),"Query survives native SoundCloud search");
            ui(()->{activity.findViewById(R.id.search_youtube).performClick();return null;});
            check(browserIntents.isEmpty()&&ui(()->activity.findViewById(R.id.search_youtube).isSelected()&&query.equals(input().getText().toString())),"Changing source preserves query and does not launch a page");
            ActivityMonitor online=addMonitor(OnlineActivity.class.getName(),null,false);
            ui(()->{activity.findViewById(R.id.search_submit).performClick();return null;});
            Activity web=waitForMonitorWithTimeout(online,8000);removeMonitor(online);
            check(web instanceof OnlineActivity&&("https://music.youtube.com/search?q="+android.net.Uri.encode(query)).equals(web.getIntent().getStringExtra("url")),"Visible Search button opens matching YouTube Music results");
            final Activity youtubeWeb=web;ui(()->{youtubeWeb.finish();return null;});SystemClock.sleep(500);
            ui(()->{activity.findViewById(R.id.search_local).performClick();input().setText("совсем неизвестный трек 71285");return null;});
            check(ui(()->findText((View)fieldUnchecked(activity,"searchResults"),"Совпадений в библиотеке нет")!=null),"Only My music displays the local no-results state");
            if(!library.tracks().isEmpty()){
                String title=library.tracks().get(0).title;ui(()->{input().setText(title);return null;});
                check(ui(()->findText((View)fieldUnchecked(activity,"searchResults"),title)!=null),"Local search finds the existing imported fixture");
            }
            ui(()->{input().setText(query);input().setSelection(3,6);input().requestFocus();return null;});
            PlaybackService playback=(PlaybackService)field(activity,"player");
            if(playback.current()!=null&&playback.queue().size()>1){
                String previousTrack=playback.current().id;EditText previousInput=ui(()->input());
                clickDescription("Следующий трек");
                await(()->ui(()->input()!=previousInput&&!previousTrack.equals(playback.current().id)),5000,"real queue transition while searching");
                check(ui(()->input().hasFocus()&&input().getSelectionStart()==3&&input().getSelectionEnd()==6&&query.equals(input().getText().toString())),"Real queue Next preserves search focus, selection and query while the mini-player changes");
            }
            recreate();
            check(ui(()->activity.findViewById(R.id.search_local).isSelected()&&query.equals(input().getText().toString())),"Search source and Cyrillic query survive actual activity recreation");
            screenshot("video-search-local.png");
            clickDescription("Комнаты");clickDescription("По приглашению. Открыть ссылку на комнату");
            AlertDialog dialog=(AlertDialog)field(activity,"linkDialog");
            check(ui(()->linkInput().getText().length()==0&&"Вставь ссылку".contentEquals(linkInput().getHint())&&!dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled()),"Invitation starts empty with a short hint and disabled Open");
            check(ui(()->(linkInput().getInputType()&InputType.TYPE_MASK_VARIATION)==InputType.TYPE_TEXT_VARIATION_URI&&(linkInput().getImeOptions()&EditorInfo.IME_MASK_ACTION)==EditorInfo.IME_ACTION_GO),"Link field uses URI input and keyboard Go");
            String invalid="https://lolzcloud.com/room/не-код";
            ui(()->{linkInput().setText(invalid);dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();return null;});
            check(ui(()->dialog.isShowing()&&linkError().getVisibility()==View.VISIBLE&&invalid.contentEquals(linkInput().getText())),"Invalid invitation keeps the dialog, text and inline error");
            screenshot("video-invite-error.png");
            recreate();await(()->field(activity,"linkDialog")!=null,5000,"restored link dialog");
            check(ui(()->invalid.contentEquals(linkInput().getText())),"Unsubmitted invitation survives actual activity recreation");
            String room="https://lolzcloud.com/room/0123456789abcdef0123456789abcdef";
            online=addMonitor(OnlineActivity.class.getName(),null,false);
            ui(()->{linkInput().setText(room);linkInput().onEditorAction(EditorInfo.IME_ACTION_GO);return null;});
            web=waitForMonitorWithTimeout(online,8000);removeMonitor(online);final Activity roomWeb=web;
            check(web instanceof OnlineActivity&&room.equals(web.getIntent().getStringExtra("url")),"Keyboard Go opens the validated room URL");
            ui(()->{roomWeb.finish();return null;});SystemClock.sleep(500);
            clickDescription("Пульт компьютера. Открыть ссылку пульта с ПК");
            ui(()->{linkInput().setText(room);((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_POSITIVE).performClick();return null;});
            check(ui(()->linkError().getVisibility()==View.VISIBLE),"Remote dialog rejects a room URL instead of opening the wrong destination");
            ui(()->{((AlertDialog)fieldUnchecked(activity,"linkDialog")).dismiss();return null;});
            clickDescription("Моя музыка");clickDescription("Добавить прямую HTTPS ссылку");
            ui(()->{linkInput().setText("https://music.youtube.com/watch?v=abcdefghijk");((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_POSITIVE).performClick();return null;});
            check(ui(()->linkError().getVisibility()==View.VISIBLE&&((AlertDialog)fieldUnchecked(activity,"linkDialog")).isShowing()),"Audio-link dialog retains a rejected YouTube service-page URL");
            String nativeTrack="https://soundcloud.com/darkprinceee/gnoy";
            ui(()->{linkInput().setText(nativeTrack);((AlertDialog)fieldUnchecked(activity,"linkDialog")).getButton(AlertDialog.BUTTON_POSITIVE).performClick();return null;});
            await(()->ui(()->nativeTrack.equals(fieldUnchecked(activity,"catalogQuery"))&&!((Boolean)fieldUnchecked(activity,"catalogLoading"))&&!((java.util.List<?>)fieldUnchecked(activity,"catalogTracks")).isEmpty()),35000,"SoundCloud link dialog routes to native search");
            check(browserIntents.isEmpty()&&ui(()->fieldUnchecked(activity,"linkDialog")==null&&activity.findViewById(R.id.search_soundcloud).isSelected()&&!((PlaybackService)fieldUnchecked(activity,"player")).isPlaying()),"SoundCloud link opens native results without a browser or autoplay");
            clickDescription("Комнаты");screenshot("video-rooms-clean.png");
        }finally{removeMonitor(browser);}
    }
    private void focusInput() throws Exception{ui(()->{input().requestFocus();((InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(input(),InputMethodManager.SHOW_IMPLICIT);return null;});SystemClock.sleep(400);}
    private void focusLinkKeyboard()throws Exception{SystemClock.sleep(450);ui(()->{linkInput().requestFocus();((InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(linkInput(),InputMethodManager.SHOW_IMPLICIT);return null;});await(()->imeWindowVisible(),5000,"stable URI keyboard window");SystemClock.sleep(700);check(imeWindowVisible(),"Actual URI keyboard window stays visible after its animation");}
    private boolean imeWindowVisible(){for(AccessibilityWindowInfo window:getUiAutomation().getWindows())if(window.getType()==AccessibilityWindowInfo.TYPE_INPUT_METHOD){android.graphics.Rect bounds=new android.graphics.Rect();window.getBoundsInScreen(bounds);if(bounds.height()>100)return true;}return false;}
    private EditText input(){return activity.findViewById(R.id.search_query);}
    private EditText linkInput(){return (EditText)fieldUnchecked(activity,"linkInput");}
    private TextView linkError(){return (TextView)fieldUnchecked(activity,"linkError");}
    private void setAccessibleText(String description,String text) throws Exception{await(()->nodeDescription(getUiAutomation().getRootInActiveWindow(),description)!=null,5000,description);Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,text);check(nodeDescription(getUiAutomation().getRootInActiveWindow(),description).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args),"Real accessibility text entry accepts Cyrillic");}
    private void clickDescription(String description) throws Exception{ui(()->{View view=findDescription(activity.getWindow().getDecorView(),description);if(view==null)throw new AssertionError("Missing view: "+description);view.performClick();return null;});SystemClock.sleep(180);}
    private View findDescription(View view,String description){if(description.contentEquals(view.getContentDescription()==null?"":view.getContentDescription())|| (description+", выбрано").contentEquals(view.getContentDescription()==null?"":view.getContentDescription()))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=findDescription(((ViewGroup)view).getChildAt(i),description);if(found!=null)return found;}return null;}
    private View findText(View view,String text){if(view instanceof TextView&&text.contentEquals(((TextView)view).getText()))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=findText(((ViewGroup)view).getChildAt(i),text);if(found!=null)return found;}return null;}
    private AccessibilityNodeInfo nodeDescription(AccessibilityNodeInfo node,String text){if(node==null)return null;if(text.contentEquals(node.getContentDescription()==null?"":node.getContentDescription()))return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=nodeDescription(node.getChild(i),text);if(found!=null)return found;}return null;}
    private void recreate() throws Exception{
        MainActivity old=activity;final MainActivity[] replacement={null};Application app=(Application)getTargetContext().getApplicationContext();
        Application.ActivityLifecycleCallbacks callback=new Application.ActivityLifecycleCallbacks(){public void onActivityCreated(Activity a,Bundle b){if(a instanceof MainActivity&&a!=old)replacement[0]=(MainActivity)a;}public void onActivityStarted(Activity a){}public void onActivityResumed(Activity a){}public void onActivityPaused(Activity a){}public void onActivityStopped(Activity a){}public void onActivitySaveInstanceState(Activity a,Bundle b){}public void onActivityDestroyed(Activity a){}};
        app.registerActivityLifecycleCallbacks(callback);try{ui(()->{old.recreate();return null;});await(()->replacement[0]!=null&&field(replacement[0],"player")!=null,8000,"activity recreation");activity=replacement[0];SystemClock.sleep(300);}finally{app.unregisterActivityLifecycleCallbacks(callback);}
    }
    private <T>T ui(Callable<T> call) throws Exception{Object[] value={null};Throwable[] error={null};runOnMainSync(()->{try{value[0]=call.call();}catch(Throwable t){error[0]=t;}});if(error[0]!=null)throw new RuntimeException(error[0]);return (T)value[0];}
    private static Object field(Object target,String name)throws Exception{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(target);}
    private static Object fieldUnchecked(Object target,String name){try{return field(target,name);}catch(Exception e){throw new RuntimeException(e);}}
    private void check(boolean ok,String message){if(!ok)throw new AssertionError(message);checks.put(message);}
    private void await(Condition condition,long timeout,String what)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if(condition.get())return;SystemClock.sleep(100);}throw new AssertionError("Timed out: "+what);}
    private void screenshot(String name)throws Exception{SystemClock.sleep(700);Bitmap bitmap=getUiAutomation().takeScreenshot();if(bitmap==null)throw new IOException("Screenshot unavailable");File folder=new File(getTargetContext().getExternalFilesDir(null),"video-fixes");folder.mkdirs();try(FileOutputStream out=new FileOutputStream(new File(folder,name))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}
    private String shell(String command)throws Exception{try(ParcelFileDescriptor fd=getUiAutomation().executeShellCommand(command);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[512];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);return out.toString("UTF-8");}}
}
