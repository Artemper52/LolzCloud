package com.lolzcloud.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Read-only access to the one verified APK. Never exposes arbitrary cache paths. */
public final class UpdateFileProvider extends ContentProvider {
    static final String DIRECTORY = "verified-update";
    static final String APK = "LolzCloud-Android-update.apk";

    static File apkFile(android.content.Context context) { return new File(new File(context.getCacheDir(), DIRECTORY), APK); }

    static Uri apkUri(android.content.Context context) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".updates").appendPath(APK).build();
    }

    @Override public boolean onCreate() { return true; }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (getContext() == null || !"content".equals(uri.getScheme())
                || !(getContext().getPackageName() + ".updates").equals(uri.getAuthority())
                || !uri.getPathSegments().equals(java.util.Collections.singletonList(APK))
                || uri.getQuery() != null || uri.getFragment() != null) throw new FileNotFoundException("Unknown update file");
        File file = apkFile(getContext());
        try {
            File directory = new File(getContext().getCacheDir(), DIRECTORY).getCanonicalFile();
            if (!file.isFile() || !directory.equals(file.getCanonicalFile().getParentFile())) throw new FileNotFoundException("Update file is unavailable");
        } catch (IOException error) { throw new FileNotFoundException("Update file is unavailable"); }
        return file;
    }

    @Override public String getType(Uri uri) {
        try { resolve(uri); return "application/vnd.android.package-archive"; }
        catch (FileNotFoundException error) { return null; }
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only update provider");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File file = resolve(uri);
            String[] columns = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
            MatrixCursor cursor = new MatrixCursor(columns, 1);
            Object[] values = new Object[columns.length];
            for (int index = 0; index < columns.length; index++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[index])) values[index] = APK;
                else if (OpenableColumns.SIZE.equals(columns[index])) values[index] = file.length();
            }
            cursor.addRow(values);
            return cursor;
        } catch (FileNotFoundException error) { return null; }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Read only"); }
}
