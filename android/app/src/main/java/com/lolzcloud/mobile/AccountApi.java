package com.lolzcloud.mobile;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Device approval is browser-owned. This client never receives a forum token or forum cookies. */
public final class AccountApi {
    static final class Pair {
        final String deviceCode,code,url;final long lifetime;
        Pair(String device,String code,String url,long lifetime){this.deviceCode=device;this.code=code;this.url=url;this.lifetime=lifetime;}
    }
    static final class Session {
        final String token,id,name;final long expires,serverNow;
        Session(String token,String id,String name,long expires,long serverNow){this.token=token;this.id=id;this.name=name;this.expires=expires;this.serverNow=serverNow;}
    }
    static final class ApiError extends IOException {
        final int status;ApiError(int status,String message){super(message);this.status=status;}
    }
    interface Transport{Response request(String method,String path,String body,String authorization,String cookie)throws IOException;}
    static final class Response {
        final int status;final String body;final long serverNow;
        Response(int status,String body,long serverNow){this.status=status;this.body=body;this.serverNow=serverNow;}
    }
    private final Transport transport;
    public AccountApi(){this(new HttpsTransport());}
    AccountApi(Transport transport){this.transport=transport;}
    Pair start()throws IOException{
        Response response=call("POST","/api/desktop/start","{}","","");
        try{JSONObject data=new JSONObject(response.body);String device=data.getString("deviceCode"),code=data.getString("code"),url=data.getString("verificationUrl");long seconds=integer(data,"expiresIn");
            if(!AccountPolicy.secret(device)||!AccountPolicy.code(code)||!AccountPolicy.verification(url,code)||seconds<=0||seconds>600)throw new IllegalArgumentException();
            return new Pair(device,code,url,seconds*1000);
        }catch(Exception invalid){throw new ApiError(422,"Сервер вернул неверный код подключения. Запроси новый код.");}
    }
    Session poll(String device)throws IOException{
        if(!AccountPolicy.secret(device))throw new ApiError(400,"Неверный код подключения");
        Response response=call("POST","/api/desktop/poll","{\"deviceCode\":\""+device+"\"}","","");
        try{JSONObject data=new JSONObject(response.body);Object pending=data.get("pending");if(Boolean.TRUE.equals(pending))return null;if(!Boolean.FALSE.equals(pending))throw new IllegalArgumentException();
            String token=data.getString("token");JSONObject user=data.getJSONObject("user");String id=AccountPolicy.userId(user.get("id"));long expires=integer(data,"expires");
            if(!AccountPolicy.secret(token)||id.isEmpty()||!AccountPolicy.expires(expires,response.serverNow))throw new IllegalArgumentException();
            return verify(token,id,expires,false);
        }catch(IOException rejected){throw rejected;}catch(Exception invalid){throw new ApiError(422,"Сервер не подтвердил аккаунт. Запроси новый код подключения.");}
    }
    Session verify(String token,String id,long expires,boolean cookie)throws IOException{
        if(!AccountPolicy.secret(token)||AccountPolicy.userId(id).isEmpty())throw new ApiError(422,"Неверная сессия подключения");
        Response response=call("GET","/api/session",null,cookie?"":"Bearer "+token,cookie?"__Host-lc_session="+token:"");
        try{JSONObject data=new JSONObject(response.body),user=data.getJSONObject("user");String actual=AccountPolicy.userId(user.get("id"));String name=user.getString("name").trim();
            if(!Boolean.TRUE.equals(data.get("authenticated"))||!id.equals(actual)||name.isEmpty()||name.length()>300||!AccountPolicy.secret(data.getString("csrf"))||!AccountPolicy.expires(expires,response.serverNow))throw new IllegalArgumentException();
            return new Session(token,actual,name,expires,response.serverNow);
        }catch(Exception invalid){throw new ApiError(422,"Не удалось подтвердить аккаунт LolzCloud. Войди заново.");}
    }
    private static long integer(JSONObject data,String name)throws Exception{Object value=data.get(name);if(!(value instanceof Number))throw new IllegalArgumentException();Number number=(Number)value;long result=number.longValue();if(number.doubleValue()!=result)throw new IllegalArgumentException();return result;}
    private Response call(String method,String path,String body,String authorization,String cookie)throws IOException{
        Response response=transport.request(method,path,body,authorization,cookie);int status=response.status;if(status==200)return response;
        String message=status==410?"Код истёк. Получи новый код и подтверди вход в браузере.":status==429?"Слишком много проверок. Подождём минуту и попробуем снова.":status==401||status==403?"Сервер не подтвердил вход. Получи новый код.":status==404?"Подключение приложения пока недоступно на сервере.":"Не удалось проверить вход (HTTP "+status+"). Попробуй ещё раз.";
        throw new ApiError(status,message);
    }
    private static final class HttpsTransport implements Transport {
        @Override public Response request(String method,String path,String body,String authorization,String cookie)throws IOException{
            if(!(("POST".equals(method)&&(path.equals("/api/desktop/start")||path.equals("/api/desktop/poll")))||"GET".equals(method)&&path.equals("/api/session")))throw new IOException("Недопустимый API входа");
            HttpsURLConnection connection=(HttpsURLConnection)new URL(AccountPolicy.ORIGIN+path).openConnection();
            try{
                connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(7000);connection.setReadTimeout(8000);connection.setRequestMethod(method);
                connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("User-Agent","LolzCloud-Android");
                if(!authorization.isEmpty())connection.setRequestProperty("Authorization",authorization);
                if(!cookie.isEmpty())connection.setRequestProperty("Cookie",cookie);
                if(body!=null){byte[] bytes=body.getBytes(StandardCharsets.UTF_8);connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream output=connection.getOutputStream()){output.write(bytes);}}
                int status=connection.getResponseCode();long serverNow=connection.getDate();if(serverNow<=0)serverNow=System.currentTimeMillis();
                if(status!=200)return new Response(status,"",serverNow);
                String mime=connection.getContentType();if(mime==null||!mime.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")||connection.getContentLengthLong()>128*1024)throw new ApiError(422,"Сервер вернул неверный ответ входа");
                try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int count;long deadline=System.nanoTime()+15_000_000_000L;
                    while((count=input.read(buffer))!=-1){if(Thread.currentThread().isInterrupted()||System.nanoTime()>deadline)throw new IOException("Проверка входа прервана. Повтори её.");if(output.size()+count>128*1024)throw new ApiError(422,"Ответ входа слишком большой");output.write(buffer,0,count);}
                    return new Response(status,new String(output.toByteArray(),StandardCharsets.UTF_8),serverNow);
                }
            }finally{connection.disconnect();}
        }
    }
}
