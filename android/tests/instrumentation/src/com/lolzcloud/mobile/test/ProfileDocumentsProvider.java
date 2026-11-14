package com.lolzcloud.mobile.test;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.*;
import java.security.MessageDigest;
import java.util.UUID;

/** Separate test APK only. Real DocumentsUI imports and writes profile files through this provider. */
public final class ProfileDocumentsProvider extends DocumentsProvider {
    public static final String AUTHORITY="com.lolzcloud.mobile.test.profiles";
    private static final String[] ROOT={"root_id","document_id","title","summary","mime_types","flags","icon"};
    private static final String[] DOC={"document_id","_display_name","mime_type","flags","_size","last_modified"};
    @Override public boolean onCreate(){return true;}
    @Override public Cursor queryRoots(String[] projection){MatrixCursor cursor=new MatrixCursor(projection==null?ROOT:projection);MatrixCursor.RowBuilder row=cursor.newRow();row.add("root_id","profiles").add("document_id","root").add("title","LolzCloud profile QA").add("summary","Declared portable JSON fixtures").add("mime_types","application/json").add("flags",DocumentsContract.Root.FLAG_LOCAL_ONLY|DocumentsContract.Root.FLAG_SUPPORTS_CREATE).add("icon",android.R.drawable.ic_menu_save);return cursor;}
    @Override public Cursor queryDocument(String id,String[] projection)throws FileNotFoundException{MatrixCursor cursor=new MatrixCursor(projection==null?DOC:projection);row(cursor,id);return cursor;}
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String order)throws FileNotFoundException{if(!"root".equals(parent))throw new FileNotFoundException();MatrixCursor cursor=new MatrixCursor(projection==null?DOC:projection);for(String id:new String[]{"desktop-v1","legacy-android-v1","invalid-v1"})row(cursor,id);File[] files=directory().listFiles();if(files!=null)for(File file:files)if(file.getName().matches("export-[a-f0-9-]{36}\\.json"))row(cursor,file.getName());return cursor;}
    @Override public boolean isChildDocument(String parent,String child){return "root".equals(parent)&&(child.equals("desktop-v1")||child.equals("legacy-android-v1")||child.equals("invalid-v1")||child.matches("export-[a-f0-9-]{36}\\.json"));}
    @Override public String createDocument(String parent,String mime,String name)throws FileNotFoundException{if(!"root".equals(parent)||!"application/json".equals(mime))throw new FileNotFoundException();String id="export-"+UUID.randomUUID()+".json";try{if(!file(id).createNewFile())throw new IOException();}catch(IOException failure){throw new FileNotFoundException("Cannot create test export");}return id;}
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{if(!id.startsWith("export-")&&!"r".equals(mode))throw new FileNotFoundException("Fixture is read-only");return ParcelFileDescriptor.open(file(id),ParcelFileDescriptor.parseMode(mode));}
    @Override public void deleteDocument(String id)throws FileNotFoundException{if(!id.matches("export-[a-f0-9-]{36}\\.json")||!file(id).delete())throw new FileNotFoundException();}
    private File directory()throws FileNotFoundException{File base=new File(getContext().getCacheDir(),"portable-documents");if(!base.isDirectory()&&!base.mkdirs())throw new FileNotFoundException();return base;}
    private File file(String id)throws FileNotFoundException{
        if(id.matches("export-[a-f0-9-]{36}\\.json"))return new File(directory(),id);
        if(!id.equals("desktop-v1")&&!id.equals("legacy-android-v1")&&!id.equals("invalid-v1"))throw new FileNotFoundException();
        try{
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(id.equals("invalid-v1"))bytes.write("{\"format\":\"lolzcloud-profile\",\"version\":1,\"tools\":{\"bookmarks\":[{\"url\":\"file:///private/not-portable\"}]}}".getBytes("UTF-8"));
            else try(InputStream input=getContext().getAssets().open("profiles/"+id+".json")){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>1048576)throw new IOException();bytes.write(buffer,0,count);}}
            byte[] data=bytes.toByteArray(),hash=MessageDigest.getInstance("SHA-256").digest(data);StringBuilder name=new StringBuilder();for(byte b:hash)name.append(String.format(java.util.Locale.ROOT,"%02x",b&255));File file=new File(directory(),name+".json");
            if(!file.exists())try(FileOutputStream out=new FileOutputStream(file)){out.write(data);}return file;
        }catch(Exception failure){throw new FileNotFoundException("Missing declared profile fixture");}
    }
    private void row(MatrixCursor cursor,String id)throws FileNotFoundException{
        if(id.equals("root")){cursor.newRow().add("document_id",id).add("_display_name","LolzCloud profile QA").add("mime_type",DocumentsContract.Document.MIME_TYPE_DIR).add("flags",DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE);return;}
        File file=file(id);String name=id.equals("desktop-v1")?"Desktop profile.json":id.equals("legacy-android-v1")?"Legacy Android profile.json":id.equals("invalid-v1")?"Invalid profile.json":id;
        cursor.newRow().add("document_id",id).add("_display_name",name).add("mime_type","application/json").add("flags",id.startsWith("export-")?DocumentsContract.Document.FLAG_SUPPORTS_WRITE|DocumentsContract.Document.FLAG_SUPPORTS_DELETE:0).add("_size",file.length()).add("last_modified",file.lastModified());
    }
}
