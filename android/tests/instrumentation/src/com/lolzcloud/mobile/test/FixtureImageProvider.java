package com.lolzcloud.mobile.test;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;

/** Separate PNG-only SAF root. Audio fixture IDs and the production APK are unchanged. */
public final class FixtureImageProvider extends DocumentsProvider {
    public static final String AUTHORITY="com.lolzcloud.mobile.test.images";
    private static final String[] ROOT_COLUMNS={DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID,DocumentsContract.Root.COLUMN_TITLE,DocumentsContract.Root.COLUMN_MIME_TYPES,DocumentsContract.Root.COLUMN_FLAGS,DocumentsContract.Root.COLUMN_ICON};
    private static final String[] DOCUMENT_COLUMNS={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE};
    @Override public boolean onCreate(){return true;}
    @Override public Cursor queryRoots(String[] projection){
        MatrixCursor cursor=new MatrixCursor(projection==null?ROOT_COLUMNS:projection);MatrixCursor.RowBuilder row=cursor.newRow();
        row.add(DocumentsContract.Root.COLUMN_ROOT_ID,"image-fixtures").add(DocumentsContract.Root.COLUMN_DOCUMENT_ID,"root")
                .add(DocumentsContract.Root.COLUMN_TITLE,"LolzCloud images").add(DocumentsContract.Root.COLUMN_MIME_TYPES,"image/png")
                .add(DocumentsContract.Root.COLUMN_FLAGS,DocumentsContract.Root.FLAG_LOCAL_ONLY).add(DocumentsContract.Root.COLUMN_ICON,android.R.drawable.ic_menu_gallery);
        return cursor;
    }
    @Override public Cursor queryDocument(String id,String[] projection)throws FileNotFoundException{MatrixCursor cursor=new MatrixCursor(projection==null?DOCUMENT_COLUMNS:projection);add(cursor,id);return cursor;}
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String order)throws FileNotFoundException{
        if(!"root".equals(parent))throw new FileNotFoundException();android.util.Log.i("LolzCloudImageFixture","queryChildDocuments avatar image/png flags=0 bytes="+image().length());MatrixCursor cursor=new MatrixCursor(projection==null?DOCUMENT_COLUMNS:projection);add(cursor,"avatar");return cursor;
    }
    @Override public boolean isChildDocument(String parent,String child){return "root".equals(parent)&&"avatar".equals(child);}
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{
        if(!"avatar".equals(id)||!"r".equals(mode))throw new FileNotFoundException("Read-only test PNG");android.util.Log.i("LolzCloudImageFixture","openDocument avatar mode=r image/png bytes="+image().length());return ParcelFileDescriptor.open(image(),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    private void add(MatrixCursor cursor,String id)throws FileNotFoundException{
        boolean root="root".equals(id);if(!root&&!"avatar".equals(id))throw new FileNotFoundException();MatrixCursor.RowBuilder row=cursor.newRow();
        row.add(DocumentsContract.Document.COLUMN_DOCUMENT_ID,id).add(DocumentsContract.Document.COLUMN_DISPLAY_NAME,root?"LolzCloud images":"native-avatar.png")
                .add(DocumentsContract.Document.COLUMN_MIME_TYPE,root?DocumentsContract.Document.MIME_TYPE_DIR:"image/png").add(DocumentsContract.Document.COLUMN_FLAGS,0)
                .add(DocumentsContract.Document.COLUMN_SIZE,root?0:image().length());
    }
    private synchronized File image()throws FileNotFoundException{
        File file=new File(getContext().getCacheDir(),"native-avatar.png");
        if(!file.isFile()){
            Bitmap bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);bitmap.eraseColor(Color.rgb(85,170,119));
            try(FileOutputStream output=new FileOutputStream(file)){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,output))throw new java.io.IOException("PNG encode failed");}
            catch(java.io.IOException error){throw new FileNotFoundException(error.toString());}finally{bitmap.recycle();}
        }
        return file;
    }
}
