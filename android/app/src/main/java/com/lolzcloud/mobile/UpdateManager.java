package com.lolzcloud.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/** Explicit, signed APK updates. This never installs silently or removes application data. */
public final class UpdateManager {
    public interface Listener {
        void onStatus(String status);
        void onAvailable(String version, String releaseUrl);
    }

    private static final String API = "https://api.github.com/repos/Artemper52/LolzCloud/releases?per_page=30";
    private static final int MAX_METADATA = 1024 * 1024;
    private static final int MAX_MIRROR_METADATA = 32 * 1024;
    private static final long MAX_APK = AndroidReleasePolicy.MAX_APK;
    private static final String PREFS = "android-update";
    private static final String PENDING = "awaiting-source-permission";
    private static final String PIN_SHA256 = "prepared-sha256", PIN_SIZE = "prepared-size";
    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean disposed;
    private volatile AndroidReleasePolicy.Selection available;

    public UpdateManager(Context context, Listener listener) {
        if (context == null || listener == null) throw new IllegalArgumentException("Context and listener are required");
        this.context = context;
        this.listener = listener;
    }

    /** Checks release metadata only. Download starts solely in installAvailable(). */
    public void check() {
        if (disposed || !busy.compareAndSet(false, true)) return;
        available = null;
        status("Проверяем Android-релиз…");
        worker.execute(() -> {
            try {
                AndroidReleasePolicy.Selection mirror = null, github = null;
                IOException mirrorError = null, githubError = null;
                String unverifiedVersion = null;
                try { mirror = parseMirror(readMetadata(AndroidReleasePolicy.MIRROR_METADATA, MAX_MIRROR_METADATA)); }
                catch (IOException error) { mirrorError = error; }
                try {
                    List<AndroidReleasePolicy.Release> releases = parseReleases(readMetadata(API, MAX_METADATA));
                    github = AndroidReleasePolicy.selectNewestStable(releases);
                    unverifiedVersion = AndroidReleasePolicy.newestUnverifiedStableVersion(releases);
                } catch (IOException error) { githubError = error; }
                PackageInfo installed = installedPackage();
                final AndroidReleasePolicy.Selection chosen;
                try { chosen = AndroidReleasePolicy.selectUpdate(github, mirror, installed.versionName, versionCode(installed)); }
                catch (IllegalArgumentException error) { throw new IOException("Не удалось сопоставить установленную Android-версию с релизом"); }
                if (chosen == null) {
                    if (unverifiedVersion != null && AndroidReleasePolicy.compareVersions(unverifiedVersion, installed.versionName) > 0)
                        throw new IOException("Для нового Android APK не опубликована проверяемая SHA-256 сумма. Обновление пока недоступно.");
                    AndroidReleasePolicy.Selection latest = AndroidReleasePolicy.newest(github, mirror);
                    if (latest == null) {
                        if (mirrorError != null) throw mirrorError;
                        if (githubError != null) throw githubError;
                        status("Android-релиз ещё не опубликован"); return;
                    }
                    if (AndroidReleasePolicy.compareVersions(latest.version, installed.versionName) > 0)
                        throw new IOException("Опубликованный APK не новее установленного по Android versionCode. Установка отменена.");
                    status("Установлена Android-версия " + installed.versionName + ". Более новая проверяемая версия не найдена.");
                    return;
                }
                available = chosen;
                final AndroidReleasePolicy.Selection result = chosen;
                status("Найден Android APK " + result.version + ". Перед установкой проверим версию и подпись.");
                main.post(() -> { if (!disposed) listener.onAvailable(result.version, result.releaseUrl); });
            } catch (Exception error) { status(message(error, "Не удалось проверить обновления. Повтори позже.")); }
            finally { busy.set(false); }
        });
    }

    /** Call only after a user's explicit action on the offered Android release. */
    public void installAvailable() {
        final AndroidReleasePolicy.Selection asset = available;
        if (disposed || !busy.compareAndSet(false, true)) return;
        if (asset == null) { busy.set(false); status("Сначала проверь наличие Android-релиза"); return; }
        status("Загружаем Android APK…");
        worker.execute(() -> {
            try {
                // The application may have been updated since metadata was checked.
                PackageInfo installed = installedPackage();
                if (!AndroidReleasePolicy.isNewer(asset, installed.versionName, versionCode(installed))) {
                    available = null;
                    status("Установлена такая же или более новая Android-версия");
                    return;
                }
                File target = download(asset);
                validateApk(target, asset);
                status("Подпись и версия APK проверены");
                main.post(() -> { if (!disposed) requestInstallation(target); });
            } catch (Exception error) {
                clearPending();
                status(message(error, "Не удалось подготовить обновление. Установленная версия сохранена."));
            } finally { busy.set(false); }
        });
    }

    /** Call from Activity.onResume() after returning from unknown-source settings. */
    public void resumePendingInstall() {
        if (disposed || !preferences().getBoolean(PENDING, false) || !context.getPackageManager().canRequestPackageInstalls()
                || !busy.compareAndSet(false, true)) return;
        clearPending();
        worker.execute(() -> {
            try {
                File apk = UpdateFileProvider.apkFile(context);
                verifyPreparedFile(apk);
                validateApk(apk);
                main.post(() -> { if (!disposed) requestInstallation(apk); });
            } catch (Exception error) { status(message(error, "Не удалось открыть подготовленное обновление")); }
            finally { busy.set(false); }
        });
    }

    private String readMetadata(String address, int limit) throws IOException {
        HttpsURLConnection connection = open(address, true);
        try {
            int response = connection.getResponseCode();
            if (response == 404) throw new IOException("Android-релиз ещё не опубликован на этом источнике");
            if (API.equals(address) && (response == 403 || response == 429)) throw new IOException("GitHub ограничил запросы. Проверь обновления позже.");
            if (response != 200) throw new IOException("Источник обновления временно недоступен. Повтори проверку позже.");
            if (connection.getContentLengthLong() > limit) throw new IOException("Слишком большой ответ обновления");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (disposed || Thread.currentThread().isInterrupted()) throw new IOException("Проверка отменена");
                    if (bytes.size() + count > limit) throw new IOException("Слишком большой ответ обновления");
                    bytes.write(buffer, 0, count);
                }
                return bytes.toString("UTF-8");
            }
        } finally { connection.disconnect(); }
    }

    private static AndroidReleasePolicy.Selection parseMirror(String metadata) throws IOException {
        try {
            JSONObject value = new JSONObject(metadata);
            for (String key : new String[] { "versionName", "packageName", "url", "sha256" })
                if (!(value.get(key) instanceof String)) throw new IOException("Официальный Android-манифест содержит неверные поля");
            String certificate = "";
            if (value.has("certificateSha256")) {
                if (!(value.get("certificateSha256") instanceof String)) throw new IOException("Официальный Android-манифест содержит неверный сертификат");
                certificate = value.getString("certificateSha256");
            }
            AndroidReleasePolicy.Selection selected = AndroidReleasePolicy.selectMirror(value.getString("versionName"),
                    integer(value, "versionCode"), value.getString("packageName"), value.getString("url"),
                    integer(value, "size"), value.getString("sha256"), certificate);
            if (selected == null) throw new IOException("Официальный Android-манифест не прошёл проверку версии, адреса или SHA-256 суммы");
            return selected;
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw new IOException("Официальный Android-манифест повреждён"); }
    }

    private static long integer(JSONObject object, String key) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) throw new IOException("Манифест обновления требует целое число: " + key);
        return ((Number) value).longValue();
    }

    private static List<AndroidReleasePolicy.Release> parseReleases(String metadata) throws IOException {
        try {
            JSONArray releases = new JSONArray(metadata);
            if (releases.length() > 30) throw new IOException("GitHub вернул слишком много релизов");
            List<AndroidReleasePolicy.Release> result = new ArrayList<>();
            for (int index = 0; index < releases.length(); index++) {
                JSONObject release = releases.getJSONObject(index);
                if (!(release.get("draft") instanceof Boolean) || !(release.get("prerelease") instanceof Boolean)
                        || !(release.get("tag_name") instanceof String) || !(release.get("html_url") instanceof String)) {
                    throw new IOException("GitHub вернул некорректный список релизов");
                }
                boolean draft = release.getBoolean("draft"), prerelease = release.getBoolean("prerelease");
                if (draft || prerelease) continue;
                String tag = release.getString("tag_name"), url = release.getString("html_url");
                if (!isRepositoryRelease(url) || tag.isEmpty() || tag.length() > 200 || tag.matches(".*[\\p{Cntrl}].*")) {
                    throw new IOException("GitHub вернул неподходящие сведения о релизе");
                }
                JSONArray assets = release.getJSONArray("assets");
                List<AndroidReleasePolicy.Asset> candidates = new ArrayList<>();
                for (int assetIndex = 0; assetIndex < assets.length(); assetIndex++) {
                    JSONObject asset = assets.getJSONObject(assetIndex);
                    if (!(asset.get("name") instanceof String)) throw new IOException("GitHub вернул неверные сведения о файлах релиза");
                    String name = asset.getString("name");
                    if (!name.startsWith("LolzCloud-Android-") || !name.endsWith(".apk")) continue;
                    if (!(asset.get("browser_download_url") instanceof String) || !(asset.get("size") instanceof Number)
                            || asset.has("digest") && !asset.isNull("digest") && !(asset.get("digest") instanceof String)) {
                        throw new IOException("GitHub вернул неверные сведения об Android APK");
                    }
                    candidates.add(new AndroidReleasePolicy.Asset(name, asset.getString("browser_download_url"), integer(asset, "size"),
                            asset.isNull("digest") ? "" : asset.optString("digest", "")));
                }
                result.add(new AndroidReleasePolicy.Release(tag, url, draft, prerelease, candidates));
            }
            return result;
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw new IOException("GitHub вернул некорректный список релизов"); }
    }

    private File download(AndroidReleasePolicy.Selection asset) throws Exception {
        File target = UpdateFileProvider.apkFile(context);
        File directory = target.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Не удалось создать папку обновления");
        if (directory.getUsableSpace() < asset.size + 8L * 1024 * 1024) throw new IOException("Недостаточно места для Android APK");
        File temporary = new File(directory, "download.part");
        clearPending();
        HttpsURLConnection connection = null;
        boolean completed = false;
        try {
            connection = open(asset.url, false);
            if (connection.getResponseCode() != 200) throw new IOException("Сервер не отдал Android APK. Повтори позже.");
            long declared = connection.getContentLengthLong();
            if (declared > MAX_APK || declared > 0 && declared != asset.size) throw new IOException("Размер APK не совпал с релизом");
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            long total = 0;
            int reported = -1;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary, false)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (disposed || Thread.currentThread().isInterrupted()) throw new IOException("Загрузка отменена");
                    total += count;
                    if (total > MAX_APK || total > asset.size) throw new IOException("APK превышает заявленный размер");
                    output.write(buffer, 0, count);
                    hash.update(buffer, 0, count);
                    int percent = (int) (total * 100 / asset.size);
                    if (percent / 10 != reported / 10) { status("Загружаем Android APK: " + percent + "%"); reported = percent; }
                }
                output.getFD().sync();
            }
            if (total != asset.size) throw new IOException("APK загрузился не полностью. Повтори загрузку.");
            if (!asset.sha256.matches("[a-f0-9]{64}") || !asset.sha256.equals(hex(hash.digest()))) throw new IOException("Контрольная сумма APK не совпала");
            validateApk(temporary, asset);
            if (target.exists() && !target.delete()) throw new IOException("Не удалось заменить подготовленный APK");
            if (!temporary.renameTo(target)) throw new IOException("Не удалось сохранить проверенный APK");
            completed = true;
            return target;
        } finally {
            if (connection != null) connection.disconnect();
            if (!completed && temporary.exists()) temporary.delete();
        }
    }

    private void validateApk(File file) throws Exception {
        inspectApk(file);
        pinPreparedFile(file);
    }

    private void validateApk(File file, AndroidReleasePolicy.Selection expected) throws Exception {
        PackageInfo archive = inspectApk(file);
        if (!expected.packageName.equals(archive.packageName) || !expected.version.equals(archive.versionName)
                || expected.versionCode > 0 && expected.versionCode != versionCode(archive))
            throw new IOException("Версия или пакет APK не совпали с опубликованным Android-релизом");
        if (file.length() != expected.size || !expected.sha256.equals(fileSha256(file)))
            throw new IOException("Контрольная сумма APK не совпала");
        if (!expected.certificateSha256.isEmpty() && !Arrays.asList(certificates(archive)).contains(expected.certificateSha256))
            throw new IOException("Сертификат APK не совпал с официальным манифестом");
        pinPreparedFile(file);
    }

    private PackageInfo inspectApk(File file) throws Exception {
        if (!file.isFile() || file.length() <= 0 || file.length() > MAX_APK) throw new IOException("Подготовленный APK не найден или повреждён");
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        PackageInfo installed = installedPackage();
        if (archive == null || !context.getPackageName().equals(archive.packageName)) throw new IOException("APK предназначен для другого приложения");
        long next = versionCode(archive), current = versionCode(installed);
        if (next <= current) throw new IOException("Установлена такая же или более новая Android-версия");
        try {
            if (AndroidReleasePolicy.compareVersions(archive.versionName, installed.versionName) <= 0)
                throw new IOException("Установлена такая же или более новая Android-версия");
        } catch (IllegalArgumentException error) { throw new IOException("APK содержит неподходящую Android-версию"); }
        if (archive.applicationInfo == null || archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT) throw new IOException("Обновление требует более новую версию Android");
        String[] expected = certificates(installed);
        String[] actual = certificates(archive);
        if (expected.length == 0 || !Arrays.equals(expected, actual)) {
            throw new IOException("Подпись APK отличается от установленной версии. Обновление отменено; данные сохранены.");
        }
        return archive;
    }

    private static long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }

    private void pinPreparedFile(File file) throws Exception {
        if (!file.getCanonicalFile().equals(UpdateFileProvider.apkFile(context).getCanonicalFile())) return;
        if (!preferences().edit().putString(PIN_SHA256, fileSha256(file)).putLong(PIN_SIZE, file.length()).commit())
            throw new IOException("Не удалось сохранить проверку APK. Повтори загрузку.");
    }

    private void verifyPreparedFile(File file) throws Exception {
        String expected = preferences().getString(PIN_SHA256, "");
        if (!expected.matches("[a-f0-9]{64}") || file.length() != preferences().getLong(PIN_SIZE, -1)
                || !expected.equals(fileSha256(file))) throw new IOException("Подготовленный APK изменился. Проверь и загрузи обновление ещё раз.");
    }

    private String fileSha256(File file) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        long count = 0;
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] bytes = new byte[32768]; int read;
            while ((read = input.read(bytes)) != -1) {
                if (disposed || Thread.currentThread().isInterrupted()) throw new IOException("Проверка APK отменена");
                count += read; if (count > MAX_APK) throw new IOException("APK превышает допустимый размер");
                hash.update(bytes, 0, read);
            }
        }
        return hex(hash.digest());
    }

    private PackageInfo installedPackage() throws PackageManager.NameNotFoundException {
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        return context.getPackageManager().getPackageInfo(context.getPackageName(), flags);
    }

    private static String[] certificates(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
                ? info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()
                : info.signatures;
        if (signatures == null) return new String[0];
        String[] hashes = new String[signatures.length];
        for (int index = 0; index < signatures.length; index++) hashes[index] = hex(MessageDigest.getInstance("SHA-256").digest(signatures[index].toByteArray()));
        Arrays.sort(hashes);
        return hashes;
    }

    private void requestInstallation(File target) {
        if (!context.getPackageManager().canRequestPackageInstalls()) {
            preferences().edit().putBoolean(PENDING, true).apply();
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            addTaskFlag(settings);
            try {
                context.startActivity(settings);
                status("Разреши установку для LolzCloud и вернись в приложение. Затем Android запросит подтверждение.");
            } catch (ActivityNotFoundException error) {
                clearPending();
                status("Открой разрешение на установку приложений для LolzCloud в настройках Android");
            }
            return;
        }
        clearPending();
        Uri uri = UpdateFileProvider.apkUri(context);
        Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        install.setClipData(ClipData.newRawUri("LolzCloud Android update", uri));
        addTaskFlag(install);
        try {
            context.startActivity(install);
            status("Открыт установщик Android. Установка требует твоего подтверждения.");
        } catch (ActivityNotFoundException | SecurityException error) {
            status("Android не смог открыть установщик. Проверь разрешение на установку приложений.");
        }
    }

    private void addTaskFlag(Intent intent) { if (!(context instanceof Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); }
    private SharedPreferences preferences() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private void clearPending() { preferences().edit().remove(PENDING).apply(); }
    private void status(String text) { main.post(() -> { if (!disposed) listener.onStatus(text); }); }

    private static String message(Exception error, String fallback) {
        return error instanceof IOException && error.getMessage() != null ? error.getMessage() : fallback;
    }

    private static HttpsURLConnection open(String address, boolean metadata) throws IOException {
        String current = address;
        for (int redirect = 0; redirect <= 5; redirect++) {
            if (metadata ? !API.equals(current) && !AndroidReleasePolicy.MIRROR_METADATA.equals(current) : !isDownloadUrl(current)) throw new IOException("Недоверенный адрес обновления");
            HttpsURLConnection connection = (HttpsURLConnection) new URL(current).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "LolzCloud-Android-Updater");
            connection.setRequestProperty("Accept", metadata ? API.equals(address) ? "application/vnd.github+json" : "application/json" : "application/octet-stream");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int code;
            try { code = connection.getResponseCode(); }
            catch (IOException error) { connection.disconnect(); throw error; }
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || metadata) throw new IOException("Неожиданное перенаправление обновления");
                String next = new URL(new URL(current), location).toExternalForm();
                if (!AndroidReleasePolicy.isDownloadRedirectAllowed(address, next)) throw new IOException("Недоверенное перенаправление Android APK");
                current = next;
                continue;
            }
            return connection;
        }
        throw new IOException("Слишком много перенаправлений обновления");
    }

    static boolean isRepositoryRelease(String value) {
        return AndroidReleasePolicy.isRepositoryRelease(value);
    }

    static boolean isRepositoryAsset(String value) {
        return AndroidReleasePolicy.isRepositoryAsset(value);
    }

    private static boolean isDownloadUrl(String value) {
        return AndroidReleasePolicy.isDownloadUrl(value);
    }

    private static String hex(byte[] bytes) {
        char[] symbols = "0123456789abcdef".toCharArray();
        char[] result = new char[bytes.length * 2];
        for (int index = 0; index < bytes.length; index++) {
            result[index * 2] = symbols[(bytes[index] & 255) >>> 4];
            result[index * 2 + 1] = symbols[bytes[index] & 15];
        }
        return new String(result);
    }

    public void dispose() { disposed = true; worker.shutdownNow(); main.removeCallbacksAndMessages(null); }

}
