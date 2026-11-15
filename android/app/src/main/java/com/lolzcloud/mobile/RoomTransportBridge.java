package com.lolzcloud.mobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.util.UUID;

/** Main-frame-only reads/commands. No Java object or message handler is exposed to provider frames. */
final class RoomTransportBridge implements PlaybackService.RoomController {
    private static java.lang.ref.WeakReference<RoomTransportBridge> visibleRoom=new java.lang.ref.WeakReference<>(null);
    private final OnlineActivity activity;private final WebView web;private final Handler handler=new Handler(Looper.getMainLooper());
    private PlaybackService service;private boolean bound,closed,committed,reading;private long generation;
    private String token="",room="";private RoomTransportPolicy.Snapshot last;
    private final ServiceConnection connection=new ServiceConnection(){
        public void onServiceConnected(ComponentName name,IBinder binder){if(closed)return;service=((PlaybackService.LocalBinder)binder).getService();if(!token.isEmpty())service.enterOnlineRoom(token,room,RoomTransportBridge.this);}
        public void onServiceDisconnected(ComponentName name){service=null;}
    };
    RoomTransportBridge(OnlineActivity activity,WebView web){this.activity=activity;this.web=web;}
    void started(String url){
        if(closed)return;
        String next=roomId(url);if(next.isEmpty()){leave();return;}
        RoomTransportBridge previous=visibleRoom.get();if(previous!=null&&previous!=this)previous.activity.finishRoomForHandoff();visibleRoom=new java.lang.ref.WeakReference<>(this);
        leave();room=next;token=UUID.randomUUID().toString();generation++;committed=false;reading=false;last=null;
        if(!bound)bound=activity.bindService(new Intent(activity,PlaybackService.class),connection,Context.BIND_AUTO_CREATE);
        if(service!=null)service.enterOnlineRoom(token,room,this);else PlaybackService.pauseForOnlineRoom();
        handler.post(poll);
    }
    void committed(String url){if(!closed&&!token.isEmpty()&&room.equals(roomId(url)))committed=true;}
    private String roomId(String url){try{return SocialPolicy.roomPage(url)?new URI(url).getRawPath().split("/")[2]:"";}catch(Exception invalid){return "";}}
    private boolean valid(String expected){return !closed&&!activity.isFinishing()&&!token.isEmpty()&&token.equals(expected)&&room.equals(roomId(web.getUrl()));}
    private String guard(){return "window===top&&location.origin==='https://lolzcloud.com'&&location.pathname.replace(/\\/$/,'')==="+JSONObject.quote("/room/"+room);}
    private String read(String raw){try{return new JSONArray("["+raw+"]").getString(0);}catch(Exception invalid){return "";}}
    private final Runnable poll=new Runnable(){public void run(){
        if(closed)return;handler.postDelayed(this,250);if(!committed||reading||!valid(token))return;
        final String owner=token;final long ticket=generation;reading=true;
        web.evaluateJavascript("(function(){if(!("+guard()+"))return null;var a=window.LolzCloudRoomTransport;return a&&typeof a.snapshot==='function'?JSON.stringify(a.snapshot()):null;})()",raw->{
            if(ticket!=generation||!valid(owner))return;reading=false;
            try{RoomTransportPolicy.Snapshot snapshot=RoomTransportPolicy.parse(read(raw));if(!room.equals(snapshot.roomId))return;if(last!=null&&(!last.documentId.equals(snapshot.documentId)||snapshot.epoch<last.epoch||snapshot.epoch==last.epoch&&snapshot.revision<last.revision))return;last=snapshot;if(service!=null)service.onlineRoomSnapshot(owner,snapshot);}
            catch(Exception unavailable){/* Pending/unavailable stays room-owned; never fall back to a native queue. */}
        });
    }};
    private final class Reply {
        final PlaybackService.RoomReply callback;boolean done;final Runnable timeout=()->finish(false);
        Reply(PlaybackService.RoomReply callback){this.callback=callback;extend(3000);}
        void extend(long milliseconds){handler.removeCallbacks(timeout);handler.postDelayed(timeout,milliseconds);}
        void finish(boolean okay){if(done)return;done=true;handler.removeCallbacks(timeout);callback.complete(okay);}
    }
    public void release(String nativeToken,RoomTransportPolicy.Snapshot expected,PlaybackService.RoomReply callback){
        if(!valid(nativeToken)){callback.complete(false);return;}final long ticket=generation;Reply reply=new Reply(callback);
        String owner=expected==null?"null":expected.owner().toString();
        String script="(function(){if(!("+guard()+"))return null;var a=window.LolzCloudRoomTransport,s=a&&a.snapshot(),e="+owner+";if(!s||s.roomId!=="+JSONObject.quote(room)+")return null;if(e&&(s.roomId!==e.roomId||s.documentId!==e.documentId||s.epoch!==e.epoch))return null;if(s.active&&a.release(s)!==true)return null;return JSON.stringify(a.snapshot());})()";
        web.evaluateJavascript(script,result->{boolean okay=false;if(ticket==generation&&valid(nativeToken))try{RoomTransportPolicy.Snapshot released=RoomTransportPolicy.parse(read(result));okay=!released.active&&released.roomId.equals(room)&&(expected==null||released.sameOwner(expected));if(okay){last=released;if(service!=null)service.onlineRoomReleased(nativeToken,released);}}catch(Exception invalid){}reply.finish(okay);});
    }
    public void command(String nativeToken,RoomTransportPolicy.Snapshot expected,String command,long value,PlaybackService.RoomReply callback){
        if(!valid(nativeToken)||expected==null||last==null||!last.sameOwner(expected)||!expected.capabilities.contains(command)){callback.complete(false);return;}
        final long ticket=generation;final String id=UUID.randomUUID().toString();Reply reply=new Reply(callback);
        try{
            JSONObject request=expected.owner().put("command",command).put("id",id);if(command.equals("seek"))request.put("value",value/1000d);
            String box="window.__lcAndroidRoomReplies",key=JSONObject.quote(id);
            String script="(function(){if(!("+guard()+"))return false;var a=window.LolzCloudRoomTransport;if(!a||typeof a.command!=='function')return false;var b="+box+"||("+box+"=Object.create(null));var k=Object.keys(b);if(k.length>=8)delete b[k[0]];Promise.resolve(a.command("+request+")).then(function(r){b["+key+"]=!!r&&r.ok===true;},function(){b["+key+"]=false;});return true;})()";
            web.evaluateJavascript(script,result->{
                if(ticket!=generation||!valid(nativeToken)||!"true".equals(result)){reply.finish(false);return;}
                reply.extend(60000); // Delivery was acknowledged; SDK readiness is a separately bounded operation.
                handler.post(new Runnable(){public void run(){
                    if(reply.done)return;if(ticket!=generation||!valid(nativeToken)){reply.finish(false);return;}
                    web.evaluateJavascript("(function(){if(!("+guard()+"))return false;var b="+box+";if(!b||!Object.prototype.hasOwnProperty.call(b,"+key+"))return null;var r=b["+key+"];delete b["+key+"];return r;})()",answer->{if("null".equals(answer)){handler.postDelayed(this,80);return;}reply.finish(ticket==generation&&valid(nativeToken)&&"true".equals(answer));});
                }});
            });
        }catch(Exception invalid){reply.finish(false);}
    }
    private void leave(){
        String previous=token;if(previous.isEmpty())return;
        if(valid(previous)&&last!=null)release(previous,last,okay->{});
        if(service!=null)service.leaveOnlineRoom(previous);
        handler.removeCallbacks(poll);
        token="";room="";last=null;committed=false;reading=false;generation++;
    }
    void close(){if(closed)return;leave();closed=true;if(visibleRoom.get()==this)visibleRoom.clear();handler.removeCallbacksAndMessages(null);if(bound){activity.unbindService(connection);bound=false;}service=null;}
}
