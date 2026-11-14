package com.lolzcloud.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Retained native flow. Pending codes and checked recovery grants stay in private app preferences. */
final class AccountLoginController {
    interface Listener{void changed();void success();}
    private final Context context;
    private final AccountApi api;
    private final SharedPreferences prefs;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private Listener listener;
    private AccountApi.Pair pair;
    private AccountApi.Session grant;
    private AccountCookieCommit cookieCommit;
    private long deadlineElapsed,deadlineWall,createdElapsed,createdWall,grantUntilWall;
    private int generation,failures;
    private long flow;
    private boolean active,busy,closed,complete,needsNewCode,automatic=true;
    String status="Получаем код подключения…";
    AccountLoginController(Context context){this(context,new AccountApi(),context.getApplicationContext().getSharedPreferences("lolzcloud_account_pending_v1",Context.MODE_PRIVATE));}
    AccountLoginController(Context context,AccountApi api,SharedPreferences prefs){this.context=context.getApplicationContext();this.api=api;this.prefs=prefs;flow=prefs.getLong("flow",0);restore();}
    static void discard(Context context){SharedPreferences prefs=context.getApplicationContext().getSharedPreferences("lolzcloud_account_pending_v1",Context.MODE_PRIVATE);prefs.edit().remove("pending").putBoolean("expired",false).putLong("flow",prefs.getLong("flow",0)+1).commit();}
    private boolean valid(int request){return !closed&&request==generation&&flow==prefs.getLong("flow",0);}
    private boolean flowCurrent(){return flow==prefs.getLong("flow",0);}
    void attach(Listener listener){this.listener=listener;changed();}
    void detach(){listener=null;}
    boolean busy(){return busy;}
    String code(){return pair==null?"":pair.code;}
    String verificationUrl(){return pair==null?null:pair.url;}
    boolean hasPair(){return pair!=null&&remaining()>0;}
    long remaining(){return Math.max(0,Math.min(deadlineElapsed-SystemClock.elapsedRealtime(),deadlineWall-System.currentTimeMillis()));}
    void resume(){active=true;if(flow!=prefs.getLong("flow",0)){status="Подключение отменено. Получи новый код, чтобы войти.";changed();return;}if(complete){if(listener!=null)listener.success();}else if(!busy){main.removeCallbacks(poll);main.post(poll);}}
    void pause(){active=false;main.removeCallbacks(poll);}
    void check(){if(flow!=prefs.getLong("flow",0)||needsNewCode){status="Получи новый код и подтверди его в браузере.";changed();return;}automatic=true;failures=0;main.removeCallbacks(poll);if(!busy)main.post(poll);}
    void newCode(){generation++;rollbackCookie();pair=null;grant=null;needsNewCode=false;automatic=true;failures=0;resetFlow();main.removeCallbacks(poll);if(!busy)begin();else{status="Подождём завершения проверки…";changed();}}
    void cancel(){generation++;rollbackCookie();main.removeCallbacks(poll);pair=null;grant=null;resetFlow();closed=true;listener=null;worker.shutdownNow();}
    void dispose(){generation++;rollbackCookie();closed=true;active=false;listener=null;main.removeCallbacks(poll);worker.shutdownNow();}
    private void rollbackCookie(){if(cookieCommit!=null){cookieCommit.cancel();cookieCommit=null;}}
    private final Runnable poll=()->{
        if(closed||busy||complete||!flowCurrent())return;
        if(grant!=null){install(grant);return;}
        if(pair==null){if(!needsNewCode)begin();return;}
        if(!hasPair()){expire();return;}
        if(!automatic){changed();return;}
        verifyPair();
    };
    private void begin(){
        if(closed||busy)return;busy=true;status="Получаем код подключения…";changed();final int request=++generation;
        worker.execute(()->{AccountApi.Pair result=null;Exception error=null;try{result=api.start();}catch(Exception failure){error=failure;}final AccountApi.Pair value=result;final Exception failure=error;
            main.post(()->{if(!valid(request)){busy=false;return;}busy=false;if(failure!=null){automatic=false;needsNewCode=true;status=failure.getMessage()==null?"Не удалось получить код. Проверь интернет и повтори.":failure.getMessage();changed();return;}
                pair=value;createdElapsed=SystemClock.elapsedRealtime();createdWall=System.currentTimeMillis();deadlineElapsed=createdElapsed+value.lifetime;deadlineWall=createdWall+value.lifetime;
                if(!persist()){pair=null;automatic=false;status="Не удалось сохранить код. Проверь свободное место и повтори.";changed();return;}
                status="Открой браузер, войди через Lolzteam и нажми «Подтвердить подключение». Затем вернись сюда.";changed();schedule(3000);
            });});
    }
    private void verifyPair(){
        busy=true;status="Проверяем подтверждение…";changed();final int request=generation;final String device=pair.deviceCode;
        worker.execute(()->{AccountApi.Session result=null;Exception error=null;try{result=api.poll(device);}catch(Exception failure){error=failure;}final AccountApi.Session value=result;final Exception failure=error;
            main.post(()->{if(!valid(request)){busy=false;return;}busy=false;if(failure!=null){failed(failure);return;}failures=0;
                if(value==null){status="Ждём подтверждения подключения в браузере. Один вход на форум ещё не подключает телефон.";changed();schedule(3000);return;}
                grant=value;grantUntilWall=System.currentTimeMillis()+Math.max(0,value.expires-value.serverNow);
                if(!persist()){automatic=false;status="Не удалось сохранить подтверждение. Проверь свободное место и нажми «Проверить».";changed();return;}
                install(value);
            });});
    }
    private void install(AccountApi.Session session){
        if(closed||busy)return;busy=true;status="Подключаем аккаунт к приложению…";changed();final int request=generation;
        worker.execute(()->{AccountApi.Session result=null;Exception error=null;try{result=api.verify(session.token,session.id,session.expires,false);}catch(Exception failure){error=failure;}final AccountApi.Session checked=result;final Exception failure=error;
            main.post(()->{if(!valid(request)){busy=false;return;}if(failure!=null){busy=false;failed(failure);return;}
                final AccountCookieCommit transaction=new AccountCookieCommit(checked);cookieCommit=transaction;
                transaction.apply(accepted->{
                    if(!valid(request)){transaction.cancel();busy=false;return;}
                    if(!accepted){transaction.cancel();busy=false;automatic=false;status="Android не сохранил сессию. Нажми «Проверить», чтобы повторить.";changed();return;}
                    worker.execute(()->{Exception cookieError=null;try{api.verify(checked.token,checked.id,checked.expires,true);}catch(Exception cookieFailure){cookieError=cookieFailure;}final Exception verifyError=cookieError;
                        main.post(()->{if(!valid(request)){transaction.cancel();busy=false;return;}busy=false;
                            if(verifyError!=null){transaction.cancel();cookieCommit=null;failed(verifyError);return;}
                            if(!transaction.commit()){transaction.cancel();cookieCommit=null;automatic=false;status="Сессия изменилась. Повтори проверку входа.";changed();return;}
                            cookieCommit=null;complete=true;status="Вход выполнен: "+SocialPolicy.displayName(checked.name);pair=null;grant=null;clear();main.removeCallbacks(poll);SocialNotifications.get(context).refresh();changed();if(active&&listener!=null)listener.success();
                        });});
                });
            });});
    }
    private void failed(Exception failure){
        int code=failure instanceof AccountApi.ApiError?((AccountApi.ApiError)failure).status:0;
        if(code==410){expire();return;}
        if(code==400||code==401||code==403||code==404||code==422){automatic=false;if(code!=404){pair=null;grant=null;needsNewCode=true;clear();}status=failure.getMessage();changed();return;}
        failures++;automatic=failures<5;status=(failure.getMessage()==null?"Не удалось проверить вход. Проверь интернет.":failure.getMessage())+(automatic?" Проверим ещё раз автоматически.":" Нажми «Проверить», чтобы продолжить.");changed();if(automatic)schedule(AccountPolicy.retryDelay(failures,code));
    }
    private void expire(){generation++;pair=null;grant=null;needsNewCode=true;clear();prefs.edit().putBoolean("expired",true).commit();automatic=false;status="Код истёк. Получи новый код, затем подтверди подключение в браузере.";changed();}
    private void schedule(long delay){main.removeCallbacks(poll);if(active&&!closed&&!complete&&automatic)main.postDelayed(poll,delay);}
    private void changed(){if(listener!=null)listener.changed();}
    private boolean persist(){
        try{JSONObject data=new JSONObject();if(pair!=null)data.put("device",pair.deviceCode).put("code",pair.code).put("wall",createdWall).put("elapsed",createdElapsed).put("wallDeadline",deadlineWall).put("elapsedDeadline",deadlineElapsed);
            if(grant!=null)data.put("token",grant.token).put("id",grant.id).put("name",grant.name).put("expires",grant.expires).put("serverNow",grant.serverNow).put("grantUntilWall",grantUntilWall);
            return prefs.edit().putString("pending",data.toString()).commit();
        }catch(Exception error){return false;}
    }
    private void restore(){
        needsNewCode=prefs.getBoolean("expired",false);if(needsNewCode)status="Код истёк. Получи новый код, чтобы продолжить.";
        try{String raw=prefs.getString("pending",null);if(raw==null)return;JSONObject data=new JSONObject(raw);long wall=System.currentTimeMillis(),elapsed=SystemClock.elapsedRealtime();
            if(data.has("token")){String token=data.getString("token"),id=data.getString("id");long expires=data.getLong("expires"),server=data.getLong("serverNow");grantUntilWall=data.getLong("grantUntilWall");
                if(AccountPolicy.secret(token)&&!AccountPolicy.userId(id).isEmpty()&&AccountPolicy.expires(expires,server)&&grantUntilWall>wall&&grantUntilWall-wall<=AccountPolicy.MAX_SESSION+60_000)grant=new AccountApi.Session(token,id,data.getString("name"),expires,server);
            }
            if(data.has("device")){String device=data.getString("device"),code=data.getString("code");createdWall=data.getLong("wall");createdElapsed=data.getLong("elapsed");deadlineWall=data.getLong("wallDeadline");deadlineElapsed=data.getLong("elapsedDeadline");
                if(AccountPolicy.secret(device)&&AccountPolicy.code(code)&&wall>=createdWall-60_000&&elapsed>=createdElapsed&&deadlineWall>wall&&deadlineElapsed>elapsed&&deadlineWall-createdWall<=600_000&&deadlineElapsed-createdElapsed<=600_000)pair=new AccountApi.Pair(device,code,AccountPolicy.verification(code),deadlineElapsed-createdElapsed);
            }
            if(pair==null&&grant==null){clear();needsNewCode=true;prefs.edit().putBoolean("expired",true).commit();status="Предыдущий код истёк. Получи новый код, чтобы продолжить.";}else{needsNewCode=false;status="Продолжим подключение телефона. Подтверди код в браузере и вернись сюда.";}
        }catch(Exception invalid){clear();pair=null;grant=null;needsNewCode=true;}
    }
    private void clear(){prefs.edit().remove("pending").commit();}
    private void resetFlow(){flow=prefs.getLong("flow",0)+1;prefs.edit().remove("pending").putBoolean("expired",false).putLong("flow",flow).commit();}
}
