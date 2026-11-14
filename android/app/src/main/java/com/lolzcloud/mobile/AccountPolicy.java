package com.lolzcloud.mobile;

import java.net.URI;
import java.net.URLDecoder;
import java.util.Locale;

/** Device pairing accepts only the application's fixed HTTPS origin and opaque server codes. */
public final class AccountPolicy {
    public static final String ORIGIN="https://lolzcloud.com";
    public static final String PROFILE=ORIGIN+"/social?tab=profile";
    static final long MAX_SESSION=7L*24*60*60*1000;
    private AccountPolicy(){}
    static boolean secret(String value){return value!=null&&value.matches("[A-Za-z0-9_-]{43}");}
    static boolean code(String value){return value!=null&&value.matches("[A-Za-z0-9_-]{12}");}
    static String userId(Object value){String id=value==null?"":String.valueOf(value);return id.matches("[1-9][0-9]{0,14}")?id:"";}
    static String verification(String code){return code(code)?ORIGIN+"/connect?code="+code:null;}
    static boolean verification(String url,String code){return verification(code)!=null&&verification(code).equals(url);}
    static boolean expires(long value,long now){return value>now&&value-now<=MAX_SESSION+60_000;}
    static URI https(String value){try{if(value==null||value.length()>8192)return null;URI uri=new URI(value);return "https".equalsIgnoreCase(uri.getScheme())&&uri.getHost()!=null&&uri.getRawUserInfo()==null&&(uri.getPort()==-1||uri.getPort()==443)?uri:null;}catch(Exception invalid){return null;}}
    static boolean own(String value){URI uri=https(value);return uri!=null&&"lolzcloud.com".equalsIgnoreCase(uri.getHost());}
    static boolean provider(String value){URI uri=https(value);if(uri==null)return false;String host=uri.getHost().toLowerCase(Locale.ROOT);for(String domain:new String[]{"lolz.team","lolz.live","zelenka.guru"})if(host.equals(domain)||host.endsWith("."+domain))return true;return false;}
    public static boolean loginNavigation(String value){
        URI uri=https(value);if(uri==null)return false;String path=uri.getPath()==null?"":uri.getPath().toLowerCase(Locale.ROOT);
        if(own(value))return path.equals("/login")||path.equals("/login/")||path.equals("/auth/lolz")||path.startsWith("/auth/lolz/");
        if(!provider(value))return false;
        return path.matches("^/(?:oauth(?:2)?|login|register|signin|sign-in|account/authorize|account/login|account/two-step)(?:/.*)?$")
                ||query(uri,"client_id")!=null||query(uri,"redirect_uri")!=null||query(uri,"response_type")!=null;
    }
    /** Empty means an untrusted or unrelated destination; no forum/OAuth URL becomes a return target. */
    static String target(String value){
        URI uri=https(value);if(uri==null||!own(value))return "";String path=uri.getRawPath();
        if(path==null||!(path.equals("/social")||path.equals("/rooms")||path.matches("/(?:room|remote)/[a-f0-9]{32}/?")))return "";
        String query=uri.getRawQuery();if(query!=null&&query.length()>1024)return "";
        if(path.equals("/social")){
            String tab=query(uri,"tab"),user=query(uri,"user");
            if(tab==null||!tab.matches("profile|friends|notifications"))tab="profile";
            return ORIGIN+"/social?tab="+tab+(userId(user).isEmpty()?"":"&user="+user);
        }
        return ORIGIN+path+(query==null?"":"?"+query);
    }
    static String destination(String navigation,String last,String initial){
        if(loginNavigation(navigation)&&own(navigation)){
            String next=query(https(navigation),"next");
            if(next!=null&&next.startsWith("/")&&!next.startsWith("//")){String target=target(ORIGIN+next);if(!target.isEmpty())return target;}
        }
        for(String candidate:new String[]{last,initial}){String target=target(candidate);if(!target.isEmpty())return target;}
        return PROFILE;
    }
    private static String query(URI uri,String key){try{if(uri==null||uri.getRawQuery()==null)return null;for(String part:uri.getRawQuery().split("&")){int at=part.indexOf('=');String name=URLDecoder.decode(at<0?part:part.substring(0,at),"UTF-8");if(key.equals(name))return URLDecoder.decode(at<0?"":part.substring(at+1),"UTF-8");}}catch(Exception invalid){}return null;}
    static String cookie(String token,long expires,long serverNow){
        if(!secret(token)||!expires(expires,serverNow))throw new IllegalArgumentException("Invalid checked session");
        long seconds=Math.max(1,Math.min(MAX_SESSION/1000,(expires-serverNow)/1000));
        return "__Host-lc_session="+token+"; Path=/; Max-Age="+seconds+"; Secure; HttpOnly; SameSite=Lax";
    }
    static long retryDelay(int failures,int status){return status==429?60_000:Math.min(30_000,3000L*(1L<<Math.min(4,Math.max(0,failures-1))));}
}
