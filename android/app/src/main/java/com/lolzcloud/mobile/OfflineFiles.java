package com.lolzcloud.mobile;

import java.io.File;
import java.io.IOException;
import java.net.URI;

/** Only the private filenames created by StreamDownloads belong to this deletion policy. */
public final class OfflineFiles {
    public static File owned(File files,String address) {
        try {
            URI uri=new URI(address==null?"":address);
            if(!"file".equals(uri.getScheme())||uri.getRawAuthority()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null)return null;
            File root=files.getCanonicalFile(),directory=new File(root,"offline").getCanonicalFile();
            if(!root.equals(directory.getParentFile())||!directory.getName().equals("offline"))return null;
            File raw=new File(uri).getAbsoluteFile(),file=raw.getCanonicalFile();
            // Android canonicalizes its trusted /data/user/0 app root to /data/data.
            // Permit only that context-owned root alias, never a per-file link or traversal.
            File expectedRaw=new File(files.getAbsoluteFile(),"offline");
            if(!expectedRaw.equals(raw.getParentFile())&&!directory.equals(raw.getParentFile()))return null;
            if(!raw.getName().equals(file.getName()))return null;
            if(!directory.equals(file.getParentFile())||!file.getName().matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.audio"))return null;
            return file;
        } catch(Exception invalid){return null;}
    }
    public static long delete(File files,String address)throws IOException {
        File file=owned(files,address);if(file==null)throw new IOException("Можно удалить только загрузку самого LolzCloud");
        if(!file.exists())return 0;
        if(!file.isFile())throw new IOException("Сохранённая копия недоступна");
        long bytes=file.length();if(!file.delete()||file.exists())throw new IOException("Не удалось освободить сохранённый файл. Повтори удаление загрузки");
        return bytes;
    }
    private OfflineFiles(){}
}
