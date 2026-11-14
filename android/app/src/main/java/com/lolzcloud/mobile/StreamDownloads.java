package com.lolzcloud.mobile;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import java.io.*;
import java.net.*;
import java.util.UUID;

/** Finite direct audio downloads only. Service pages are never extracted or converted. */
final class StreamDownloads {
    private static final java.util.Set<String> ACTIVE = new java.util.HashSet<>();
    static Track save(Context context, Track source, LibraryStore store) throws IOException {
        synchronized(ACTIVE){if(!ACTIVE.add(source.id))throw new IOException("Этот трек уже сохраняется. Дождись завершения загрузки");}
        try {
            Track saved=store.find(source.id);
            if(saved!=null&&!LibraryStore.isDirectHttps(Uri.parse(saved.uri))){
                Uri local=Uri.parse(saved.uri);
                if("file".equals(local.getScheme())&&local.getPath()!=null){File file=new File(local.getPath());if(file.isFile()&&file.length()>0)return saved;}
                throw new IOException("Локальный источник уже изменился. Обнови библиотеку перед загрузкой");
            }
            return download(context,source,store);
        } finally { synchronized(ACTIVE){ACTIVE.remove(source.id);} }
    }
    private static Track download(Context context, Track source, LibraryStore store) throws IOException {
        if(!LibraryStore.isDirectHttps(Uri.parse(source.uri)))throw new IOException("Нужна прямая HTTPS-ссылка на аудио");
        boolean catalog=!OnlineCatalog.audioId(source.uri).isEmpty();
        // The catalog may need to convert a cold source. Poll its bounded job
        // before opening the audio response; a 20-second header wait is too short.
        if(catalog)new OnlineCatalog().prepareAudio(source.uri);
        File directory=new File(context.getFilesDir(),"offline");
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Нет места для загрузки");
        File temporary=new File(directory,UUID.randomUUID().toString()+".part");
        File destination=new File(directory,UUID.randomUUID().toString()+".audio");
        HttpURLConnection connection=null;
        try {
            URL url=new URL(source.uri);
            for(int redirect=0;redirect<6;redirect++){
                if(!LibraryStore.isDirectHttps(Uri.parse(url.toString())))throw new IOException("Небезопасная переадресация");
                connection=(HttpURLConnection)url.openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setRequestProperty("User-Agent","LolzCloud-Android");connection.setRequestProperty("Accept-Encoding","identity");
                int status=connection.getResponseCode();
                if(status>=300&&status<400){if(catalog)throw new IOException("Аудиосервис вернул переадресацию. Повтори загрузку");String location=connection.getHeaderField("Location");connection.disconnect();connection=null;if(location==null)throw new IOException("Пустая переадресация");url=new URL(url,location);continue;}
                if(status!=200)throw new IOException("Сервер вернул HTTP "+status);
                break;
            }
            if(connection==null||connection.getResponseCode()!=200)throw new IOException("Слишком много переадресаций");
            long limit=catalog?20_000_000L:150L*1024*1024,length=connection.getContentLengthLong();if(length>limit)throw new IOException(catalog?"Размер записи превышает 20 МБ":"Размер аудио больше 150 МБ");
            String type=connection.getContentType();if(type!=null)type=type.toLowerCase(java.util.Locale.ROOT);if(type!=null&&(type.startsWith("text/")||type.contains("html")||type.contains("json")))throw new IOException("Ссылка ведёт на страницу, а не аудиофайл");
            if(catalog&&(type==null||!type.startsWith("audio/mpeg")))throw new IOException("Аудиосервис вернул неподдерживаемую запись. Повтори загрузку");
            long total=0,deadline=android.os.SystemClock.elapsedRealtime()+180000;
            try(InputStream in=connection.getInputStream();OutputStream out=new FileOutputStream(temporary)){
                byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1){
                    if(Thread.currentThread().isInterrupted())throw new IOException("Загрузка отменена");
                    total+=n;if(total>limit)throw new IOException(catalog?"Размер записи превышает 20 МБ":"Поток превышает 150 МБ; выбери конечный файл");
                    if(android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("Загрузка заняла слишком много времени");out.write(buffer,0,n);
                }
            }
            if(total==0||(length>0&&total!=length))throw new IOException("Аудиофайл загрузился не полностью");
            long duration=0;MediaMetadataRetriever metadata=new MediaMetadataRetriever();
            try{metadata.setDataSource(temporary.getAbsolutePath());String raw=metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);duration=raw==null?0:Long.parseLong(raw);if(duration<=0)throw new IOException("Формат аудио не поддерживается устройством");}
            catch(RuntimeException error){throw new IOException("Не удалось проверить аудиофайл");}
            finally{try{metadata.release();}catch(Exception ignored){}}
            if(!temporary.renameTo(destination))throw new IOException("Не удалось сохранить аудиофайл");
            Track downloaded=source.withUri(Uri.fromFile(destination).toString(),duration);
            try{store.replaceWithOffline(source,downloaded);}catch(IOException failure){
                // commit() can return false after publishing the new URI in memory,
                // particularly when an Activity cancellation interrupts the IO worker.
                if(!store.referencesUri(downloaded.uri))destination.delete();
                throw failure;
            }
            return downloaded;
        }finally{if(connection!=null)connection.disconnect();if(temporary.exists())temporary.delete();}
    }
    private StreamDownloads(){}
}
