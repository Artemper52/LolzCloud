package com.lolzcloud.mobile;

import android.webkit.CookieManager;
import org.json.*;
import java.io.*;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;

/** Exact app-origin session only. No browser/provider credentials or passwords are transferred. */
public final class CloudProfileApi {
    private static final int LIMIT=1050000;
    public static final class ApiError extends IOException { public final int status;ApiError(int status,String message){super(message);this.status=status;} }
    public static final class Identity {
        public final String id,fingerprint;
        public Identity(String id,String fingerprint)throws IOException{if(AccountPolicy.userId(id).isEmpty()||fingerprint==null||!fingerprint.matches("[a-f0-9]{64}"))throw new IOException("Неверный владелец профиля");this.id=id;this.fingerprint=fingerprint;}
    }
    public static final class Snapshot {
        public final Identity owner;public final String name;public final long revision,updatedAt;public final ProfileCrypto.Envelope envelope;
        Snapshot(Identity owner,String name,long revision,long updatedAt,ProfileCrypto.Envelope envelope){this.owner=owner;this.name=name;this.revision=revision;this.updatedAt=updatedAt;this.envelope=envelope;}
    }
    interface CookieSource { String current(); }
    interface Transport { Response request(String method,String path,String body,String bearer,String csrf)throws IOException;default void cancel(){} }
    static final class Response { final int status;final String body;Response(int status,String body){this.status=status;this.body=body;} }
    public interface Ownership { boolean active(); }
    private static final class Session { final Identity owner;final String cookie,token,csrf,name;Session(Identity owner,String cookie,String token,String csrf,String name){this.owner=owner;this.cookie=cookie;this.token=token;this.csrf=csrf;this.name=name;} }
    private final CookieSource cookies;private final Transport transport;
    public CloudProfileApi(){this(()->{try{return SocialPolicy.sessionCookie(CookieManager.getInstance().getCookie(AccountPolicy.ORIGIN+"/"));}catch(RuntimeException unavailable){return "";}},new NativeTransport());}
    CloudProfileApi(CookieSource cookies,Transport transport){this.cookies=cookies;this.transport=transport;}
    public void cancel(){try{transport.cancel();}catch(RuntimeException alreadyClosed){}}
    public boolean current(Identity identity){String cookie=cookies.current();return identity!=null&&cookie!=null&&!cookie.isEmpty()&&identity.fingerprint.equals(fingerprint(cookie));}

    public Snapshot read()throws IOException {
        Session session=session(null);Response response=request("GET","/api/profile",null,session);requireCurrent(session);
        try { JSONObject data=object(response.body);requireOwner(data,session.owner);if(!data.has("envelope")||!data.has("updatedAt"))throw new IOException("Облако вернуло неполную копию");long revision=integer(data,"revision",0);Object updated=data.opt("updatedAt");long at=updated==null||updated==JSONObject.NULL?0:integer(data,"updatedAt",1);
            ProfileCrypto.Envelope envelope=data.isNull("envelope")?null:envelope(data.getJSONObject("envelope"));
            if(revision==0&&(envelope!=null||at!=0)||revision>0&&(envelope==null||at==0))throw new IOException("Облако вернуло неполную копию");
            return new Snapshot(session.owner,session.name,revision,at,envelope);
        }catch(JSONException invalid){throw new IOException("Облако вернуло неверный профиль",invalid);}
    }
    /** Called immediately before local restore as well as before any cloud mutation. */
    public void verify(Identity owner)throws IOException { session(owner); }
    public Snapshot save(Snapshot previous,ProfileCrypto.Envelope envelope,Ownership operation)throws IOException {
        if(previous==null||envelope==null||operation==null||!operation.active())throw new IOException("Сначала прочитай облачную копию");
        Session session=session(previous.owner);if(!operation.active())throw new IOException("Операция отменена");requireCurrent(session);
        try {
            String body=new JSONObject().put("revision",previous.revision).put("envelope",json(envelope)).toString();
            if(!operation.active()||Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");
            Response response=request("PUT","/api/profile",body,session);requireCurrent(session);
            JSONObject data=object(response.body);requireOwner(data,session.owner);long revision=integer(data,"revision",1),at=integer(data,"updatedAt",1);
            if(revision!=previous.revision+1)throw new IOException("Не удалось подтвердить сохранение. Прочитай облако снова");
            return new Snapshot(session.owner,session.name,revision,at,envelope);
        }catch(JSONException invalid){throw new IOException("Не удалось подтвердить сохранение. Прочитай облако снова",invalid);}
    }
    private Session session(Identity expected)throws IOException {
        if(Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");
        String cookie=cookies.current();String prefix="__Host-lc_session=";
        if(cookie==null||!cookie.startsWith(prefix)||!AccountPolicy.secret(cookie.substring(prefix.length())))throw new ApiError(401,"Войди через Lolzteam, затем прочитай облако снова");
        String token=cookie.substring(prefix.length()),fingerprint=fingerprint(cookie);
        if(expected!=null&&!expected.fingerprint.equals(fingerprint))throw changed();
        Response response=transport.request("GET","/api/session",null,token,"");ensure(response.status);
        try { JSONObject value=object(response.body),user=value.getJSONObject("user");String id=AccountPolicy.userId(user.get("id")),csrf=value.getString("csrf");
            if(!Boolean.TRUE.equals(value.get("authenticated"))||id.isEmpty()||!AccountPolicy.secret(csrf))throw new ApiError(401,"Не удалось подтвердить аккаунт. Войди снова");
            if(expected!=null&&!expected.id.equals(id))throw changed();
            Session session=new Session(new Identity(id,fingerprint),cookie,token,csrf,SocialPolicy.displayName(user.getString("name")));requireCurrent(session);return session;
        }catch(JSONException invalid){throw new ApiError(422,"Не удалось подтвердить владельца облачной копии");}
    }
    private void requireCurrent(Session session)throws IOException{if(Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");if(!session.cookie.equals(cookies.current()))throw changed();}
    private static ApiError changed(){return new ApiError(409,"Аккаунт изменился. Прочитай облако снова");}
    private static void requireOwner(JSONObject value,Identity expected)throws IOException{Object id=value.opt("ownerId");if(!(id instanceof String)||!expected.id.equals(id))throw new ApiError(409,"Не удалось подтвердить владельца ответа. Прочитай облако снова");}
    private Response request(String method,String path,String body,Session session)throws IOException{requireCurrent(session);Response response=transport.request(method,path,body,session.token,session.csrf);ensure(response.status);return response;}
    private static void ensure(int status)throws ApiError{if(status==200)return;throw new ApiError(status,status==409?"Копия изменилась на другом устройстве. Прочитай её снова; данные не перезаписаны":status==401||status==403?"Сессия закончилась. Войди через Lolzteam и прочитай облако снова":status==429?"Слишком много запросов. Подожди минуту и повтори":status==404?"Облачный профиль пока недоступен на сервере":"Облако недоступно (HTTP "+status+"). Попробуй позже");}
    static JSONObject json(ProfileCrypto.Envelope envelope)throws JSONException{return new JSONObject().put("version",1).put("salt",envelope.salt).put("iv",envelope.iv).put("tag",envelope.tag).put("ciphertext",envelope.ciphertext);}
    static ProfileCrypto.Envelope envelope(JSONObject value)throws IOException,JSONException{if(!(value.opt("version") instanceof Number)||value.getDouble("version")!=1)throw new IOException("Версия зашифрованной копии не поддерживается");for(String key:new String[]{"salt","iv","tag","ciphertext"})if(!(value.opt(key) instanceof String))throw new IOException("Неверный формат зашифрованной копии");return new ProfileCrypto.Envelope(value.getString("salt"),value.getString("iv"),value.getString("tag"),value.getString("ciphertext"));}
    private static JSONObject object(String json)throws IOException,JSONException{ProfileJson.requireObject(json);return new JSONObject(json);}
    private static long integer(JSONObject value,String key,long min)throws IOException,JSONException{Object raw=value.get(key);if(!(raw instanceof Number))throw new IOException("Неверная версия облачной копии");Number number=(Number)raw;long result=number.longValue();if(!Double.isFinite(number.doubleValue())||number.doubleValue()!=result||result<min||result>9007199254740990L)throw new IOException("Неверная версия облачной копии");return result;}
    private static String fingerprint(String cookie){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(cookie.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}catch(Exception impossible){throw new IllegalStateException(impossible);}}

    private static final class NativeTransport implements Transport {
        private volatile HttpsURLConnection active;
        private static final ScheduledExecutorService DEADLINES=Executors.newSingleThreadScheduledExecutor(task->{Thread t=new Thread(task,"LolzCloud-cloud-deadline");t.setDaemon(true);return t;});
        public void cancel(){HttpsURLConnection connection=active;if(connection!=null)connection.disconnect();}
        public Response request(String method,String path,String body,String bearer,String csrf)throws IOException {
            if(!(method.equals("GET")&&(path.equals("/api/session")||path.equals("/api/profile"))||method.equals("PUT")&&path.equals("/api/profile"))||!AccountPolicy.secret(bearer))throw new IOException("Недопустимый запрос облачного профиля");
            HttpsURLConnection connection=(HttpsURLConnection)new URL(AccountPolicy.ORIGIN+path).openConnection();active=connection;ScheduledFuture<?> deadline=DEADLINES.schedule(connection::disconnect,20,TimeUnit.SECONDS);
            try {
                if(Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");
                connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(7000);connection.setReadTimeout(8000);connection.setRequestMethod(method);connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Authorization","Bearer "+bearer);connection.setRequestProperty("User-Agent","LolzCloud-Android");
                if(method.equals("PUT")){if(!AccountPolicy.secret(csrf))throw new IOException("Не удалось подтвердить запрос");connection.setRequestProperty("Origin",AccountPolicy.ORIGIN);connection.setRequestProperty("X-CSRF-Token",csrf);}
                if(body!=null){byte[] bytes=body.getBytes(StandardCharsets.UTF_8);if(bytes.length>LIMIT)throw new IOException("Зашифрованный профиль слишком большой");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}}
                int status=connection.getResponseCode();if(status!=200)return new Response(status,"");String type=connection.getContentType();if(type==null||!type.toLowerCase(Locale.ROOT).startsWith("application/json")||connection.getContentLengthLong()>LIMIT)throw new IOException("Облако вернуло неподдерживаемый ответ");
                try(InputStream in=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");if(bytes.size()+count>LIMIT)throw new IOException("Ответ облака слишком большой");bytes.write(buffer,0,count);}return new Response(status,StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString());}
            }finally{deadline.cancel(false);if(active==connection)active=null;connection.disconnect();}
        }
    }
}
