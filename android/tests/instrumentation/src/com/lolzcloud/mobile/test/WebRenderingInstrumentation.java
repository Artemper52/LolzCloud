package com.lolzcloud.mobile.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;
import com.lolzcloud.mobile.OnlineActivity;
import com.lolzcloud.mobile.RoomAssets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;

/** Real production WebView, real public HTTPS. Its WebViewClient is never replaced. */
public final class WebRenderingInstrumentation extends Instrumentation {
    private Bundle args;
    private String label;
    private OnlineActivity activity;
    private WebView web;
    private final JSONArray pages = new JSONArray();
    private final List<String> console = new ArrayList<>();
    private JSONObject errorRetry;
    private interface Condition { boolean value() throws Exception; }

    @Override public void onCreate(Bundle value) { super.onCreate(value); args = value; start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject();
        label = args == null ? "verification" : args.getString("label", "verification");
        if (!label.matches("[a-zA-Z0-9_-]{1,40}")) label = "verification";
        try {
            PackageInfo engine = WebView.getCurrentWebViewPackage();
            PackageInfo installed = getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(), 0);
            report.put("androidApi", Build.VERSION.SDK_INT); report.put("device", Build.MODEL);
            report.put("webView", engine == null ? "unknown" : engine.packageName + " " + engine.versionName);
            report.put("version", installed.versionName); report.put("apkSha256", hash(new File(installed.applicationInfo.sourceDir)));
            report.put("webViewClientReplaced", false); report.put("usesRealPublicHttps", true);
            if (args == null || !"404".equals(args.getString("only"))) {
                render("login", "https://lolzcloud.com/login");
                render("rooms", "https://lolzcloud.com/rooms");
                render("remote", "https://lolzcloud.com/remote/0123456789abcdef0123456789abcdef");
                render("connect", "https://lolzcloud.com/connect?code=TEST-ONLY");
            }
            verifyErrorRetry();
            boolean passed = errorRetry != null && errorRetry.optBoolean("passed");
            for (int i = 0; i < pages.length(); i++) passed &= pages.getJSONObject(i).optBoolean("styledLogin");
            report.put("status", passed ? "passed" : "failed");
        } catch (Throwable error) {
            try { report.put("status", "failed"); report.put("error", error.toString()); } catch (Exception ignored) { }
        } finally {
            try {
                report.put("pages", pages); report.put("console", new JSONArray(console));
                if (errorRetry != null) report.put("errorRetry", errorRetry);
                Bundle output = new Bundle(); output.putString("stream", report.toString(2) + "\n");
                finish("passed".equals(report.optString("status")) ? Activity.RESULT_OK : Activity.RESULT_CANCELED, output);
            } catch (Exception error) { Bundle output = new Bundle(); output.putString("stream", error.toString()); finish(0, output); }
        }
    }

    private void launch(String url, String title) throws Exception {
        activity = (OnlineActivity) startActivitySync(new Intent(getTargetContext(), OnlineActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra("url", url).putExtra("title", title));
        web = (WebView) field(activity, "webView");
    }
    private void render(String name, String url) throws Exception {
        launch(url, "WebView rendering verification");
        JSONObject asset = new JSONObject(); asset.put("listedFiles", new JSONArray(activity.getAssets().list("room-client")));
        try (InputStream input = activity.getAssets().open("room-client/room.css")) {
            byte[] sample = new byte[180]; int count = input.read(sample); asset.put("directOpen", count > 0);
            asset.put("sample", new String(sample, 0, Math.max(0, count), "UTF-8"));
        } catch (Exception error) { asset.put("directOpen", false); asset.put("error", error.toString()); }
        WebResourceResponse intercepted = RoomAssets.intercept(activity, "GET", "https://lolzcloud.com/cloud/room.css");
        if (intercepted != null) { asset.put("interceptMime", intercepted.getMimeType()); asset.put("interceptStatus", intercepted.getStatusCode()); if (intercepted.getData() != null) intercepted.getData().close(); }
        observeChrome(name, null);
        final String ready = "document.readyState==='complete'&&location.pathname==='/login'&&!!document.querySelector('h1')&&!!document.querySelector('#login')";
        await(() -> { if (!"true".equals(eval(ready))) return false; String epoch = eval("String(performance.timeOrigin)"); SystemClock.sleep(250); return "true".equals(eval(ready)) && epoch.equals(eval("String(performance.timeOrigin)")); }, 25000, "Public " + name + " did not reach a stable real login document");
        JSONObject snapshot = object("JSON.stringify({path:location.pathname,title:document.title,ready:document.readyState,bodyColor:getComputedStyle(document.body).color,bodyBackground:getComputedStyle(document.body).backgroundColor,rootBackground:getComputedStyle(document.documentElement).backgroundColor,headingColor:getComputedStyle(document.querySelector('h1')).color,headingSize:getComputedStyle(document.querySelector('h1')).fontSize,linkColor:getComputedStyle(document.querySelector('#login')).color,buttonBackground:getComputedStyle(document.querySelector('#login')).backgroundColor,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,sheets:[...document.styleSheets].map(sheet=>{let rules=-1;try{rules=sheet.cssRules.length}catch(e){}return{href:sheet.href,rules}})})");
        final String[] title = new String[1]; runOnMainSync(() -> { try { title[0] = ((TextView) field(activity, "pageTitle")).getText().toString(); } catch (Exception error) { title[0] = error.toString(); } });
        boolean hasRules = false; JSONArray sheets = snapshot.getJSONArray("sheets");
        for (int i = 0; i < sheets.length(); i++) hasRules |= sheets.getJSONObject(i).optInt("rules") > 0;
        boolean styled = hasRules && asset.optBoolean("directOpen") && asset.optInt("interceptStatus") == 200 && "text/css".equals(asset.optString("interceptMime"))
                && "Вход в LolzCloud".equals(title[0]) && "complete".equals(snapshot.optString("ready"))
                && !"rgb(0, 0, 0)".equals(snapshot.optString("headingColor")) && !"rgba(0, 0, 0, 0)".equals(snapshot.optString("buttonBackground"));
        snapshot.put("assetProbe", asset); snapshot.put("nativeHeading", title[0]); snapshot.put("entry", name); snapshot.put("entryUrl", url); snapshot.put("styledLogin", styled);
        snapshot.put("screenshot", screenshot(name + ".png")); pages.put(snapshot);
        runOnMainSync(() -> activity.finish()); waitForIdleSync();
    }

    private void verifyErrorRetry() throws Throwable {
        String url = "https://lolzcloud.com/__webview_rendering_missing_page_20261112";
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
        int code; try { code = connection.getResponseCode(); } finally { connection.disconnect(); }
        if (code != 404) throw new AssertionError("Real public error endpoint returned " + code + ", expected 404");
        errorRetry = new JSONObject(); errorRetry.put("url", url); errorRetry.put("publicHttpStatus", code);
        launch(url, "WebView 404 verification"); AtomicInteger signals = new AtomicInteger(); observeChrome("404", signals);
        try {
            await(() -> stableErrorState(), 16000, "Real HTTPS 404 did not preserve a readable native error state for 400ms after document completion");
            errorRetry.put("initialState", nativeErrorState());
            final boolean[] restarted = {false}; int before = signals.get();
            runOnMainSync(() -> {
                try { ViewGroup panel = (ViewGroup) field(activity, "errorPanel"); Button retry = findButton(panel, "Повторить");
                    if (retry == null) return; retry.performClick(); restarted[0] = panel.getVisibility() == View.GONE && web.getVisibility() == View.VISIBLE;
                } catch (Exception ignored) { }
            });
            errorRetry.put("retryStartsLoading", restarted[0]);
            await(() -> signals.get() > before && stableErrorState(), 16000, "Retry did not perform a new load and preserve the native error state after document completion");
            errorRetry.put("newProgressSignals", signals.get() - before); errorRetry.put("finalState", nativeErrorState());
            errorRetry.put("passed", restarted[0]); errorRetry.put("screenshot", screenshot("error-404.png"));
            runOnMainSync(() -> activity.finish());
        } catch (Throwable error) {
            errorRetry.put("diagnostics", nativeErrorState());
            try { errorRetry.put("document", object("JSON.stringify({url:location.href,title:document.title,ready:document.readyState,text:document.body?document.body.innerText.slice(0,1000):''})")); }
            catch (Exception diagnosticError) { errorRetry.put("documentError", diagnosticError.toString()); }
            errorRetry.put("failureScreenshot", screenshot("error-404-failed.png")); throw error;
        }
    }
    private boolean stableErrorState() throws Exception {
        JSONObject first = nativeErrorState();
        if (first.optInt("panelVisibility") != View.VISIBLE || !first.optBoolean("pageError") || first.optString("message").isEmpty()
                || !"true".equals(eval("document.readyState==='complete'"))) return false;
        SystemClock.sleep(400);
        JSONObject second = nativeErrorState();
        return second.optInt("panelVisibility") == View.VISIBLE && second.optBoolean("pageError")
                && first.optString("webUrl").equals(second.optString("webUrl")) && first.optString("message").equals(second.optString("message"))
                && "true".equals(eval("document.readyState==='complete'"));
    }
    private JSONObject nativeErrorState() {
        JSONObject state = new JSONObject();
        runOnMainSync(() -> { try {
            ViewGroup panel = (ViewGroup) field(activity, "errorPanel");
            state.put("panelVisibility", panel.getVisibility()); state.put("panelShown", panel.isShown());
            state.put("message", ((TextView) field(activity, "errorText")).getText().toString()); state.put("heading", ((TextView) field(activity, "errorHeading")).getText().toString());
            state.put("webVisibility", web.getVisibility()); state.put("webUrl", web.getUrl()); state.put("webTitle", web.getTitle()); state.put("progress", web.getProgress()); state.put("pageError", field(activity, "pageError"));
        } catch (Exception error) { try { state.put("readError", error.toString()); } catch (Exception ignored) { } } }); return state;
    }
    private void observeChrome(String name, AtomicInteger signals) {
        runOnMainSync(() -> { WebChromeClient original = web.getWebChromeClient(); web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { if (signals != null) signals.incrementAndGet(); original.onProgressChanged(view, value); }
            @Override public void onReceivedTitle(WebView view, String value) { original.onReceivedTitle(view, value); }
            @Override public void onPermissionRequest(PermissionRequest request) { original.onPermissionRequest(request); }
            @Override public boolean onConsoleMessage(ConsoleMessage message) { String text = message.message(); if (text != null && text.matches("(?is).*(csp|style|refused|err_|blocked|typeerror|syntaxerror).*")) synchronized (console) { console.add(name + ": " + text.substring(0, Math.min(1000, text.length()))); } return original.onConsoleMessage(message); }
        }); });
    }
    private String screenshot(String name) throws Exception { File folder = new File(getTargetContext().getExternalFilesDir(null), "webview-" + label); folder.mkdirs(); File target = new File(folder, name); Bitmap image = getUiAutomation().takeScreenshot(); if (image != null) try (FileOutputStream out = new FileOutputStream(target)) { image.compress(Bitmap.CompressFormat.PNG, 100, out); } return target.getAbsolutePath(); }
    private JSONObject object(String source) throws Exception { Object value = new JSONTokener(eval(source)).nextValue(); return value instanceof JSONObject ? (JSONObject) value : new JSONObject(String.valueOf(value)); }
    private String eval(String source) throws Exception { final String[] result = new String[1]; CountDownLatch latch = new CountDownLatch(1); runOnMainSync(() -> web.evaluateJavascript(source, new ValueCallback<String>() { @Override public void onReceiveValue(String value) { result[0] = value; latch.countDown(); } })); if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("WebView observation timeout"); return result[0] == null ? "null" : result[0]; }
    private void await(Condition condition, long timeout, String message) throws Exception { long end = SystemClock.elapsedRealtime() + timeout; do { if (condition.value()) return; SystemClock.sleep(100); } while (SystemClock.elapsedRealtime() < end); throw new AssertionError(message); }
    private static Object field(Object value, String name) throws Exception { Field field = value.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(value); }
    private Button findButton(View view, String label) { if (view instanceof Button && label.contentEquals(((Button) view).getText())) return (Button) view; if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) { Button found = findButton(((ViewGroup) view).getChildAt(i), label); if (found != null) return found; } return null; }
    private String hash(File file) throws Exception { MessageDigest digest = MessageDigest.getInstance("SHA-256"); try (InputStream input = new FileInputStream(file)) { byte[] data = new byte[65536]; int size; while ((size = input.read(data)) != -1) digest.update(data, 0, size); } StringBuilder result = new StringBuilder(); for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 255)); return result.toString(); }
}
