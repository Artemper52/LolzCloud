package com.lolzcloud.mobile;

import android.webkit.CookieManager;

/** Main-thread cookie commit with cancellation ownership. No newer account cookie is ever rolled back. */
final class AccountCookieCommit {
    interface Callback{void done(boolean accepted);}
    interface Jar{String current();void set(String value,Callback callback);void flush();}
    private static AccountCookieCommit owner;
    private final AccountApi.Session session;
    private final Jar jar;
    private String previous;
    private boolean cancelled,committed,writeFinished,rollingBack;
    AccountCookieCommit(AccountApi.Session session){this(session,new NativeJar());}
    AccountCookieCommit(AccountApi.Session session,Jar jar){this.session=session;this.jar=jar;}
    void apply(Callback callback){
        String current=jar.current();
        previous=owner!=null&&!owner.committed&&owner.matches(current)?owner.previous:current;
        owner=this;
        try{jar.set(AccountPolicy.cookie(session.token,session.expires,session.serverNow),accepted->{
            writeFinished=true;
            if(cancelled||owner!=this){rollback();callback.done(false);return;}
            if(!accepted||!matches(jar.current())){cancel();callback.done(false);return;}
            try{jar.flush();callback.done(true);}catch(RuntimeException failure){cancel();callback.done(false);}
        });}catch(RuntimeException failure){writeFinished=true;cancel();callback.done(false);}
    }
    boolean commit(){if(cancelled||owner!=this||!matches(jar.current()))return false;committed=true;owner=null;return true;}
    void cancel(){if(committed)return;cancelled=true;rollback();}
    private boolean matches(String cookie){return ("__Host-lc_session="+session.token).equals(cookie);}
    private void rollback(){
        if(committed||owner!=this||rollingBack)return;
        if(!matches(jar.current())){if(writeFinished)owner=null;return;}
        rollingBack=true;
        String restore=previous==null||previous.isEmpty()?"__Host-lc_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax":previous+"; Path=/; Secure; HttpOnly; SameSite=Lax";
        try{jar.set(restore,ignored->{rollingBack=false;try{jar.flush();}catch(RuntimeException unavailable){}if(owner==this)owner=null;});jar.flush();}
        catch(RuntimeException unavailable){rollingBack=false;/* A delayed write callback retries rollback if native storage recovers. */}
    }
    private static final class NativeJar implements Jar{
        @Override public String current(){try{return SocialPolicy.sessionCookie(CookieManager.getInstance().getCookie(AccountPolicy.ORIGIN+"/"));}catch(RuntimeException unavailable){return "";}}
        @Override public void set(String value,Callback callback){CookieManager manager=CookieManager.getInstance();manager.setAcceptCookie(true);manager.setCookie(AccountPolicy.ORIGIN+"/",value,accepted->callback.done(Boolean.TRUE.equals(accepted)));}
        @Override public void flush(){CookieManager.getInstance().flush();}
    }
}
