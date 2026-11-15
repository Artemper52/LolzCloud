package com.lolzcloud.mobile;
import org.json.JSONObject;

public final class RoomTransportPolicyTest {
    private static int checks;private static final String ROOM="0123456789abcdef0123456789abcdef",DOC="12345678-1234-1234-1234-123456789abc",TOKEN="abcdefab-1234-1234-1234-123456789abc";
    private static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    private static JSONObject fixture()throws Exception{return new JSONObject().put("roomId",ROOM).put("documentId",DOC).put("epoch",1).put("revision",1).put("active",true).put("playback",new JSONObject().put("url","https://soundcloud.com/fixture/track").put("title","Title").put("artist","Artist").put("cover","").put("duration",60).put("position",2.25).put("playing",true)).put("capabilities",new JSONObject().put("play",true).put("pause",true).put("next",false).put("previous",false).put("seek",false));}
    private static RoomTransportPolicy.Snapshot parse(JSONObject value)throws Exception{return RoomTransportPolicy.parse(value.toString());}
    private static void invalid(JSONObject value,String label){boolean rejected=false;try{parse(value);}catch(Exception expected){rejected=true;}check(rejected,label);}
    public static void main(String[] args)throws Exception{
        RoomTransportPolicy.Snapshot state=parse(fixture());check(state.position==2250&&state.duration==60000&&state.playing,"Source seconds map once to native milliseconds at shared1x");
        check(state.capabilities.contains("pause")&&!state.capabilities.contains("next"),"A listener never inherits a native queue's Next capability");
        JSONObject inactive=fixture().put("active",false);state=parse(inactive);check(!state.playing&&state.capabilities.isEmpty(),"A pending/released room has no transport or autoplay capability");
        JSONObject paused=fixture();paused.getJSONObject("playback").put("playing",false);state=parse(paused);check(state.active&&!state.playing&&state.capabilities.contains("play"),"Paused listener ownership retains hardware Resume");
        for(String key:new String[]{"epoch","revision"})for(Object value:new Object[]{0,-1,1.5,"1",9007199254740992d})invalid(fixture().put(key,value),"Reject invalid owner counter "+key+"="+value);
        invalid(fixture().put("roomId",ROOM.toUpperCase()),"Room identity uses the exact lower-case route");invalid(fixture().put("documentId","not-a-uuid"),"Document ownership cannot be omitted");invalid(fixture().put("active","true"),"Boolean flags are never string-coerced");
        JSONObject wrong=fixture();wrong.getJSONObject("capabilities").put("next",1);invalid(wrong,"Privileges require real boolean capabilities");
        for(String address:new String[]{"file:///private/audio.mp3","content://private/audio","http://soundcloud.com/user/track","https://user:password@soundcloud.com/user/track","https://lolzcloud.com/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3","https://music.youtube.com/watch?v=abcdefghijk&list=private"}){wrong=fixture();wrong.getJSONObject("playback").put("url",address);invalid(wrong,"Reject non-room metadata source "+address);}
        wrong=fixture();wrong.getJSONObject("playback").put("url","https://music.youtube.com/watch?v=abcdefghijk");check(parse(wrong).url.contains("abcdefghijk"),"A canonical YouTube room URL remains metadata rather than extracted audio");
        wrong=fixture();wrong.getJSONObject("playback").put("position",70);check(parse(wrong).position==60000,"Native lockscreen position cannot extrapolate beyond the shared duration");
        wrong=fixture();wrong.getJSONObject("playback").put("duration",-1);invalid(wrong,"Negative shared duration is rejected");
        boolean immutable=false;try{parse(fixture()).capabilities.add("next");}catch(UnsupportedOperationException expected){immutable=true;}check(immutable,"Readback cannot mutate a validated capability set");
        RoomTransportPolicy.Lease lease=new RoomTransportPolicy.Lease();lease.begin(TOKEN,ROOM);check(lease.accept(TOKEN,parse(fixture())),"Initial snapshot binds its document to the exact native main-frame token");
        check(!lease.accept(TOKEN,parse(fixture())),"Repeated revisions are not applied twice");check(!lease.accept(DOC,parse(fixture().put("revision",2))),"Another native document token cannot deliver a snapshot");
        check(!lease.accept(TOKEN,parse(fixture().put("documentId",TOKEN).put("revision",2))),"A different JS document cannot reuse the same WebView commit");
        check(lease.accept(TOKEN,parse(fixture().put("revision",2))),"A newer snapshot in the current lease is accepted");
        check(lease.accept(TOKEN,parse(fixture().put("epoch",2).put("revision",3))),"Explicit reacquire advances the ownership epoch");
        check(!lease.accept(TOKEN,parse(fixture().put("epoch",1).put("revision",999))),"A late active snapshot from a released epoch cannot regain ownership");
        check(!lease.clear(DOC)&&lease.clear(TOKEN)&&!lease.accept(TOKEN,parse(fixture().put("epoch",3).put("revision",1000))),"Stale release and late callbacks cannot clear or resurrect another document");
        RoomTransportPolicy.Snapshot released=parse(fixture().put("active",false).put("revision",10));
        check(!RoomTransportPolicy.afterRelease(parse(fixture().put("revision",9)),released),"An active response queued before a release acknowledgment cannot reclaim solo");
        check(RoomTransportPolicy.afterRelease(parse(fixture().put("revision",11)),released),"A first-ever explicit acquire after an initial inactive release can retain epoch1 with a newer revision");
        check(RoomTransportPolicy.afterRelease(parse(fixture().put("epoch",2).put("revision",12)),released),"Later explicit reacquire advances the epoch after a release");
        check(!RoomTransportPolicy.afterRelease(parse(fixture().put("documentId",TOKEN).put("epoch",2).put("revision",20)),released),"Another JS document cannot reuse a native release barrier");
        System.out.println("Room transport policy: "+checks+" behavior checks passed");
    }
    private RoomTransportPolicyTest(){}
}
