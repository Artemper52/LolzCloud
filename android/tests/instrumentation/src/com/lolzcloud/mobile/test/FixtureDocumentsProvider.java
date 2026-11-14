package com.lolzcloud.mobile.test;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Only installed in the separate test APK. The production APK has no test library or fake login. */
public final class FixtureDocumentsProvider extends DocumentsProvider {
    public static final String AUTHORITY = "com.lolzcloud.mobile.test.documents";
    public static final String[] IDS = {"night-route", "warm-air", "quiet-shore", "before-dawn"};
    public static final String[] TITLES = {"Ночной маршрут", "Тёплый воздух", "Тихий берег", "До рассвета"};
    private static final String[] ROOT_COLUMNS = {DocumentsContract.Root.COLUMN_ROOT_ID,
            DocumentsContract.Root.COLUMN_DOCUMENT_ID, DocumentsContract.Root.COLUMN_TITLE,
            DocumentsContract.Root.COLUMN_SUMMARY, DocumentsContract.Root.COLUMN_MIME_TYPES,
            DocumentsContract.Root.COLUMN_FLAGS, DocumentsContract.Root.COLUMN_ICON};
    private static final String[] DOC_COLUMNS = {DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS, DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED};

    @Override public boolean onCreate() { return true; }
    @Override public Cursor queryRoots(String[] projection) {
        MatrixCursor cursor = new MatrixCursor(projection == null ? ROOT_COLUMNS : projection);
        MatrixCursor.RowBuilder row = cursor.newRow();
        row.add(DocumentsContract.Root.COLUMN_ROOT_ID, "fixtures");
        row.add(DocumentsContract.Root.COLUMN_DOCUMENT_ID, "root");
        row.add(DocumentsContract.Root.COLUMN_TITLE, "LolzCloud fixtures");
        row.add(DocumentsContract.Root.COLUMN_SUMMARY, "Generated test audio, not commercial tracks");
        row.add(DocumentsContract.Root.COLUMN_MIME_TYPES, "audio/mpeg\ntext/plain");
        row.add(DocumentsContract.Root.COLUMN_FLAGS, DocumentsContract.Root.FLAG_LOCAL_ONLY);
        row.add(DocumentsContract.Root.COLUMN_ICON, android.R.drawable.ic_media_play);
        return cursor;
    }
    @Override public Cursor queryDocument(String documentId, String[] projection) throws FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? DOC_COLUMNS : projection);
        addDocument(cursor, documentId);
        return cursor;
    }
    @Override public Cursor queryChildDocuments(String parentId, String[] projection, String sortOrder) throws FileNotFoundException {
        if (!"root".equals(parentId)) throw new FileNotFoundException("Not a fixture directory");
        MatrixCursor cursor = new MatrixCursor(projection == null ? DOC_COLUMNS : projection);
        for (String id : IDS) addDocument(cursor, id);
        addDocument(cursor, "night-route-lyrics");
        return cursor;
    }
    @Override public boolean isChildDocument(String parent, String child) {
        if (!"root".equals(parent)) return false;
        for (String id : IDS) if (id.equals(child)) return true;
        return "night-route-lyrics".equals(child);
    }
    @Override public ParcelFileDescriptor openDocument(String documentId, String mode, CancellationSignal signal) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Fixtures are read-only");
        return ParcelFileDescriptor.open(fixtureFile(documentId), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    private void addDocument(MatrixCursor cursor, String id) throws FileNotFoundException {
        MatrixCursor.RowBuilder row = cursor.newRow();
        if ("root".equals(id)) {
            row.add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, id);
            row.add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, "LolzCloud fixtures");
            row.add(DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.MIME_TYPE_DIR);
            row.add(DocumentsContract.Document.COLUMN_FLAGS, 0);
            return;
        }
        int index = "night-route-lyrics".equals(id) ? 0 : indexOf(id);
        File file = fixtureFile(id);
        row.add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, id);
        row.add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, "night-route-lyrics".equals(id) ? "Ночной маршрут.lrc" : TITLES[index] + ".mp3");
        row.add(DocumentsContract.Document.COLUMN_MIME_TYPE, "night-route-lyrics".equals(id) ? "text/plain" : "audio/mpeg");
        row.add(DocumentsContract.Document.COLUMN_FLAGS, 0);
        row.add(DocumentsContract.Document.COLUMN_SIZE, file.length());
        row.add(DocumentsContract.Document.COLUMN_LAST_MODIFIED, file.lastModified());
    }
    private int indexOf(String id) throws FileNotFoundException {
        for (int i = 0; i < IDS.length; i++) if (IDS[i].equals(id)) return i;
        throw new FileNotFoundException("Unknown fixture");
    }
    private synchronized File fixtureFile(String id) throws FileNotFoundException {
        if (!"night-route-lyrics".equals(id)) indexOf(id);
        String name = id + ("night-route-lyrics".equals(id) ? ".lrc" : ".mp3");
        File file = new File(getContext().getCacheDir(), name);
        if (!file.exists()) {
            try (InputStream in = getContext().getAssets().open("fixtures/" + name); FileOutputStream out = new FileOutputStream(file)) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            } catch (IOException error) { throw new FileNotFoundException("Could not load fixture: " + error.getMessage()); }
        }
        return file;
    }
}
