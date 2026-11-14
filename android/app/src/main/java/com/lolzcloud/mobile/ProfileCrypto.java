package com.lolzcloud.mobile;

import com.lambdaworks.crypto.SCrypt;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** PC envelope v1. Password and plaintext never enter an HTTP request. */
public final class ProfileCrypto {
    private ProfileCrypto() { }
    public static final class Envelope {
        public final String salt, iv, tag, ciphertext;
        public Envelope(String salt,String iv,String tag,String ciphertext)throws IOException {
            decode(salt,16,16);decode(iv,12,12);decode(tag,16,16);decode(ciphertext,2,750000);
            this.salt=salt;this.iv=iv;this.tag=tag;this.ciphertext=ciphertext;
        }
    }
    public static void validatePassword(char[] password)throws IOException {
        if(password==null||password.length<10||password.length>256)throw new IOException("Нужна парольная фраза от 10 до 256 символов");
        for(int i=0;i<password.length;i++) {
            char c=password[i];
            if(Character.isHighSurrogate(c)){if(i+1>=password.length||!Character.isLowSurrogate(password[++i]))throw new IOException("Парольная фраза содержит неполный Unicode-символ. Введи её заново");}
            else if(Character.isLowSurrogate(c))throw new IOException("Парольная фраза содержит неполный Unicode-символ. Введи её заново");
        }
    }
    static byte[] derive(char[] password,byte[] salt)throws IOException {
        validatePassword(password);if(salt==null||salt.length!=16)throw new IOException("Неверная соль зашифрованного профиля");
        byte[] bytes=null;
        try {
            if(Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");
            ByteBuffer encoded=StandardCharsets.UTF_8.encode(java.nio.CharBuffer.wrap(password));bytes=new byte[encoded.remaining()];encoded.get(bytes);if(encoded.hasArray())Arrays.fill(encoded.array(),(byte)0);
            byte[] key=SCrypt.scryptJ(bytes,salt,16384,8,1,32);
            if(Thread.currentThread().isInterrupted()){Arrays.fill(key,(byte)0);throw new IOException("Операция отменена");}
            return key;
        }catch(GeneralSecurityException failure){throw new IOException("Android не смог вычислить ключ профиля",failure);}
        catch(OutOfMemoryError lowMemory){throw new IOException("Не хватает памяти для защиты профиля. Закрой другие приложения и повтори",lowMemory);}
        finally{if(bytes!=null)Arrays.fill(bytes,(byte)0);}
    }
    public static Envelope encrypt(String json,char[] password)throws IOException {
        byte[] salt=new byte[16],iv=new byte[12];SecureRandom random=new SecureRandom();random.nextBytes(salt);random.nextBytes(iv);
        return encrypt(json,password,salt,iv);
    }
    /** Deterministic inputs are package-private and used only by public interoperability vectors. */
    static Envelope encrypt(String json,char[] password,byte[] salt,byte[] iv)throws IOException {
        byte[] plain=null,key=null;
        try {
            if(json==null||iv==null||iv.length!=12)throw new IOException("Некорректные данные профиля");
            plain=json.getBytes(StandardCharsets.UTF_8);if(plain.length>750000||plain.length<2)throw new IOException("Профиль должен быть не больше 750 КБ");
            key=derive(password,salt);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
            byte[] sealed=cipher.doFinal(plain);int length=sealed.length-16;
            return new Envelope(encode(salt),encode(iv),encode(Arrays.copyOfRange(sealed,length,sealed.length)),encode(Arrays.copyOf(sealed,length)));
        }catch(GeneralSecurityException failure){throw new IOException("Не удалось зашифровать профиль на этом Android",failure);}
        finally{if(plain!=null)Arrays.fill(plain,(byte)0);if(key!=null)Arrays.fill(key,(byte)0);if(password!=null)Arrays.fill(password,'\0');}
    }
    public static String decrypt(Envelope envelope,char[] password)throws IOException {
        byte[] key=null,plain=null;
        try {
            if(envelope==null)throw new IOException("Зашифрованная копия отсутствует");
            key=derive(password,decode(envelope.salt,16,16));byte[] ciphertext=decode(envelope.ciphertext,2,750000),tag=decode(envelope.tag,16,16),sealed=Arrays.copyOf(ciphertext,ciphertext.length+16);System.arraycopy(tag,0,sealed,ciphertext.length,16);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,decode(envelope.iv,12,12)));plain=cipher.doFinal(sealed);
            if(Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(plain)).toString();
        }catch(GeneralSecurityException failure){throw new IOException("Не удалось открыть копию. Проверь парольную фразу: файл мог быть изменён",failure);}
        finally{if(key!=null)Arrays.fill(key,(byte)0);if(plain!=null)Arrays.fill(plain,(byte)0);if(password!=null)Arrays.fill(password,'\0');}
    }
    static byte[] decode(String value,int min,int max)throws IOException {
        if(value==null||value.length()>1000000||!value.matches("[A-Za-z0-9+/]*={0,2}"))throw new IOException("Неверный формат зашифрованного профиля");
        try{byte[] data=Base64.getDecoder().decode(value);if(data.length<min||data.length>max||!encode(data).equals(value))throw new IOException("Неверный размер зашифрованного профиля");return data;}
        catch(IllegalArgumentException invalid){throw new IOException("Повреждённая кодировка зашифрованного профиля",invalid);}
    }
    private static String encode(byte[] data){return Base64.getEncoder().encodeToString(data);}
}
