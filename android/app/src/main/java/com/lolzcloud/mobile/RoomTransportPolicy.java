package com.lolzcloud.mobile;

import org.json.JSONObject;
import org.json.JSONException;
import java.net.URI;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Strict, nonprivileged room snapshots. A SoundCloud page URL is metadata, never native audio. */
public final class RoomTransportPolicy {
    private static final long SAFE=9007199254740991L;
    public static boolean roomId(String value){return value!=null&&value.matches("[a-f0-9]{32}");}
    public static boolean uuid(String value){return value!=null&&value.matches("[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}");}
    public static final class Snapshot {
        public final String roomId,documentId,url,title,artist,cover;
        public final long epoch,revision,duration,position;
        public final boolean active,playing;
        public final Set<String> capabilities;
        private Snapshot(JSONObject value)throws JSONException {
            roomId=text(value,"roomId",32);documentId=text(value,"documentId",36);epoch=integer(value,"epoch");revision=integer(value,"revision");
            if(!roomId(roomId)||!uuid(documentId))throw new JSONException("Invalid room owner");
            active=bool(value,"active");JSONObject playback=value.getJSONObject("playback"),caps=value.getJSONObject("capabilities");
            url=text(playback,"url",2048);if(!url.isEmpty()&&!mediaUrl(url))throw new JSONException("Invalid source");
            title=text(playback,"title",300);artist=text(playback,"artist",300);String image=text(playback,"cover",2048);cover=artwork(image)?image:"";
            duration=seconds(playback,"duration");position=Math.min(seconds(playback,"position"),duration>0?duration:86400000);
            playing=bool(playback,"playing")&&active;
            Set<String> enabled=new HashSet<>();for(String command:new String[]{"play","pause","next","previous","seek"})if(bool(caps,command)&&active)enabled.add(command);
            capabilities=Collections.unmodifiableSet(enabled);
        }
        public JSONObject owner(){try{return new JSONObject().put("roomId",roomId).put("documentId",documentId).put("epoch",epoch);}catch(JSONException impossible){throw new IllegalStateException(impossible);}}
        public boolean sameOwner(Snapshot other){return other!=null&&roomId.equals(other.roomId)&&documentId.equals(other.documentId)&&epoch==other.epoch;}
    }
    public static Snapshot parse(String json)throws JSONException {
        if(json==null||json.length()>64000)throw new JSONException("Room snapshot too large");return new Snapshot(new JSONObject(json));
    }
    /** First-ever acquire may retain epoch1; the synchronous release revision still fences older reads. */
    public static boolean afterRelease(Snapshot next,Snapshot released){return next!=null&&released!=null&&next.active&&!released.active&&next.roomId.equals(released.roomId)&&next.documentId.equals(released.documentId)&&(next.epoch>released.epoch||next.epoch==released.epoch&&next.revision>released.revision);}
    /** Each WebView main-frame commit has an independent native token. Revisions cannot cross it. */
    public static final class Lease {
        private String token="",room="";private Snapshot snapshot;
        public void begin(String nativeToken,String roomId){if(!uuid(nativeToken)||!roomId(roomId))throw new IllegalArgumentException("Invalid room lease");token=nativeToken;room=roomId;snapshot=null;}
        public boolean owns(String nativeToken){return !token.isEmpty()&&token.equals(nativeToken);}
        public boolean accept(String nativeToken,Snapshot next){
            if(!owns(nativeToken)||next==null||!room.equals(next.roomId))return false;
            if(snapshot!=null&&(!snapshot.documentId.equals(next.documentId)||next.epoch<snapshot.epoch||next.epoch==snapshot.epoch&&next.revision<=snapshot.revision))return false;
            snapshot=next;return true;
        }
        public Snapshot snapshot(){return snapshot;}
        public boolean clear(String nativeToken){if(!owns(nativeToken))return false;token="";room="";snapshot=null;return true;}
    }
    private static String text(JSONObject object,String key,int max)throws JSONException {Object value=object.get(key);if(!(value instanceof String)||((String)value).length()>max)throw new JSONException("Invalid "+key);return ((String)value).replaceAll("[\\p{Cntrl}&&[^\\n\\t]]","");}
    private static boolean bool(JSONObject object,String key)throws JSONException {Object value=object.get(key);if(!(value instanceof Boolean))throw new JSONException("Invalid "+key);return(Boolean)value;}
    private static long integer(JSONObject object,String key)throws JSONException {Object value=object.get(key);if(!(value instanceof Number))throw new JSONException("Invalid "+key);double number=((Number)value).doubleValue();if(!Double.isFinite(number)||number<1||number>SAFE||number!=Math.floor(number))throw new JSONException("Invalid "+key);return(long)number;}
    private static long seconds(JSONObject object,String key)throws JSONException {Object value=object.get(key);if(!(value instanceof Number))throw new JSONException("Invalid "+key);double number=((Number)value).doubleValue();if(!Double.isFinite(number)||number<0||number>86400)throw new JSONException("Invalid "+key);return Math.round(number*1000);}
    static boolean mediaUrl(String value){
        try{URI uri=new URI(value);String host=uri.getHost(),path=uri.getRawPath();if(!"https".equals(uri.getScheme())||uri.getRawUserInfo()!=null||uri.getPort()!=-1||uri.getRawFragment()!=null||host==null)return false;
            if(host.equals("soundcloud.com")||host.equals("www.soundcloud.com")||host.equals("m.soundcloud.com"))return uri.getRawQuery()==null&&path.matches("/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/?");
            return (host.equals("youtube.com")||host.equals("www.youtube.com")||host.equals("music.youtube.com"))&&"/watch".equals(path)&&uri.getRawQuery()!=null&&uri.getRawQuery().matches("v=[A-Za-z0-9_-]{11}");
        }catch(Exception invalid){return false;}
    }
    private static boolean artwork(String value){try{URI uri=new URI(value);return "https".equals(uri.getScheme())&&uri.getRawUserInfo()==null&&uri.getPort()==-1&&uri.getHost()!=null&&uri.getHost().matches("(?:[a-z0-9-]+\\.sndcdn\\.com|i\\.ytimg\\.com|lh3\\.googleusercontent\\.com)");}catch(Exception invalid){return false;}}
    private RoomTransportPolicy(){}
}
