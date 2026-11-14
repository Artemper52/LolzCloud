package com.lolzcloud.mobile;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
/** Public, declared fixture values only; this CLI is never packaged in production. */
public final class ProfileCryptoVectorCli {
    private static String decode(String value){return new String(Base64.getDecoder().decode(value),StandardCharsets.UTF_8);}
    public static void main(String[] args)throws Exception{
        if(args[0].equals("invalid-passwords")){for(char[] password:new char[][]{"short".toCharArray(),("valid prefix "+'\uD800').toCharArray(),("valid prefix "+'\uDC00').toCharArray(),new char[257]}){boolean denied=false;try{ProfileCrypto.validatePassword(password);}catch(java.io.IOException expected){denied=true;}if(!denied)throw new AssertionError("Malformed password accepted");}System.out.print("PASS4");return;}
        char[] password=decode(args[1]).toCharArray();
        if(args[0].equals("derive")){byte[] key=ProfileCrypto.derive(password,Base64.getDecoder().decode(args[2]));StringBuilder hex=new StringBuilder();for(byte b:key)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));java.util.Arrays.fill(key,(byte)0);java.util.Arrays.fill(password,'\0');System.out.print(hex);return;}
        if(args[0].equals("decrypt")){ProfileCrypto.Envelope e=new ProfileCrypto.Envelope(args[2],args[3],args[4],args[5]);String plain=ProfileCrypto.decrypt(e,password);System.out.print(Base64.getEncoder().encodeToString(plain.getBytes(StandardCharsets.UTF_8)));return;}
        ProfileCrypto.Envelope e=args[0].equals("random")?ProfileCrypto.encrypt(decode(args[2]),password):ProfileCrypto.encrypt(decode(args[2]),password,Base64.getDecoder().decode(args[3]),Base64.getDecoder().decode(args[4]));
        for(char c:password)if(c!='\0')throw new AssertionError("Password buffer retained");
        System.out.print("{\"version\":1,\"salt\":\""+e.salt+"\",\"iv\":\""+e.iv+"\",\"tag\":\""+e.tag+"\",\"ciphertext\":\""+e.ciphertext+"\"}");
    }
}
