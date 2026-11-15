package com.lolzcloud.mobile;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public final class WavePolicyTest {
    private static final List<String> checks=new ArrayList<>();
    private static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks.add(name);}
    private static String decode(String value){return new String(Base64.getDecoder().decode(value),StandardCharsets.UTF_8);}
    public static void main(String[]args)throws Exception{
        try(BufferedReader input=new BufferedReader(new InputStreamReader(new FileInputStream(new File(args[0])),StandardCharsets.UTF_8))){String line;int index=0;while((line=input.readLine())!=null){String[] row=line.split("\t",-1);check(String.join(",",WavePolicy.fingerprints(decode(row[0]),decode(row[1]),decode(row[2]),decode(row[3]))).equals(row[4]),"PC SHA256 vectors "+(++index));}}
        check(WavePolicy.source("https://www.soundcloud.com/artist/track/").equals("https://soundcloud.com/artist/track"),"canonical public source");
        for(String value:new String[]{"file:///private.mp3","content://files/private","https://soundcloud.com.evil/a/b","https://soundcloud.com/a/b?token=x","http://soundcloud.com/a/b","https://soundcloud.com/sets/foo","https://u:p@soundcloud.com/a/b"})check(WavePolicy.source(value).isEmpty(),"reject noncanonical source "+checks.size());
        WavePolicy.Gate gate=new WavePolicy.Gate();check(!gate.active()&&!gate.intent()&&!gate.loading(),"restart never autoplays");
        gate.start();long a=gate.request();check(gate.owns(a)&&gate.intent(),"explicit start owns request");
        check(gate.request()==-1,"one refill in flight");gate.pause();check(!gate.owns(a)&&gate.active()&&!gate.intent(),"pause retires late batch but retains station");
        gate.resume();long b=gate.request();check(b!=a&&!gate.finish(a)&&gate.owns(b),"old batch cannot cancel new request");
        check(gate.finish(b)&&!gate.loading(),"matching batch commits once");check(!gate.finish(b),"duplicate result ignored");
        check(gate.complete(10)&&!gate.complete(10),"one natural end per occurrence");check(gate.complete(11),"same recording new occurrence advances");
        gate.rearm();check(gate.complete(11),"explicit backward seek rearms end");
        gate.pause();check(!gate.complete(12),"paused late end cannot autoplay");gate.resume();check(gate.complete(12),"explicit resume permits next occurrence");
        long c=gate.request();gate.start();check(!gate.owns(c),"new station rejects old taste response");long d=gate.request();gate.invalidate();check(!gate.owns(d)&&gate.active()&&gate.intent(),"settings invalidate old batch without pause");
        long e=gate.request();gate.stop();check(!gate.owns(e)&&!gate.active()&&!gate.complete(99),"manual queue retires station and late end");
        StringBuilder json=new StringBuilder("{\"status\":\"passed\",\"checks\":[");for(int i=0;i<checks.size();i++){if(i>0)json.append(',');json.append('"').append(checks.get(i)).append('"');}System.out.println(json.append("]}"));
    }
}
