package com.lolzcloud.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;
import java.net.URI;
import java.net.URLDecoder;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Opens an entire source in one ordinary browser cookie context. No credentials enter the app. */
public final class SourceBrowser {
    private static final String SOUND_CLOUD = "https://soundcloud.com/";
    private static final String YOUTUBE_MUSIC = "https://music.youtube.com/";
    private static final String CUSTOM_TABS_SERVICE = "android.support.customtabs.action.CustomTabsService";
    private static final String CUSTOM_TABS_SESSION = "android.support.customtabs.extra.SESSION";

    public static boolean open(Context context, String url) {
        String entry = entryUrl(url);
        if (context == null) return false;
        if (entry == null) {
            Toast.makeText(context, "Открой страницу сервиса сначала, чтобы начать вход заново", Toast.LENGTH_LONG).show();
            return false;
        }
        Browser browser = browser(context.getPackageManager());
        if (browser == null) {
            Toast.makeText(context, "Не найден браузер. Установи браузер и попробуй снова.", Toast.LENGTH_LONG).show();
            return false;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(entry));
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setPackage(browser.packageName);
        if (browser.customTabs) {
            // These are the standard Custom Tabs intent extras. A null session is
            // also used by CustomTabsIntent.Builder without a bound service.
            // No ephemeral mode is requested: the browser keeps its own login.
            Bundle extras = new Bundle();
            extras.putBinder(CUSTOM_TABS_SESSION, null);
            intent.putExtras(extras);
            intent.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
            intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", 0xff101613);
        }
        if (!(context instanceof Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { context.startActivity(intent); return true; }
        catch (ActivityNotFoundException | SecurityException unavailable) {
            Toast.makeText(context, "Не удалось открыть браузер. Проверь браузер по умолчанию.", Toast.LENGTH_LONG).show();
            return false;
        }
    }

    /** Public homepage/search/track URLs are retained; incomplete login callbacks are restarted. */
    public static String entryUrl(String value) { return entryUrl(value, 0); }

    private static String entryUrl(String value, int depth) {
        URI uri = https(value);
        if (uri == null || isGoogleAuth(value)) return null;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (isSoundCloud(value)) {
            if (host.equals("w.soundcloud.com")) {
                String track = queryValue(uri.getRawQuery(), "url");
                return depth == 0 && isSoundCloud(track) ? entryUrl(track, depth + 1) : SOUND_CLOUD;
            }
            if (!host.equals("soundcloud.com") && !host.equals("www.soundcloud.com")
                    && !host.equals("m.soundcloud.com") && !host.equals("on.soundcloud.com")) return SOUND_CLOUD;
            if (authenticationPath(uri.getPath()) || authenticationParameters(uri)) return SOUND_CLOUD;
        } else if (isYouTubeMusic(value) && (authenticationPath(uri.getPath()) || authenticationParameters(uri))) return YOUTUBE_MUSIC;
        return uri.toASCIIString();
    }

    /** Recover a complete source instead of handing an isolated Google/OAuth URL to another browser. */
    static String authEntry(String initial, String current) {
        for (String value : new String[] { initial, current }) {
            URI uri = https(value);
            if (uri == null) continue;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            if (isSoundCloud(value) || isYouTubeMusic(value)) return entryUrl(value);
            if (host.equals("lolzcloud.com") || host.equals("www.lolzcloud.com")) {
                return authenticationPath(uri.getPath()) ? "https://lolzcloud.com/rooms" : uri.toASCIIString();
            }
        }
        return null;
    }

    public static boolean isSoundCloud(String value) {
        URI uri = https(value);
        if (uri == null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return host.equals("soundcloud.com") || host.endsWith(".soundcloud.com");
    }

    public static boolean isYouTubeMusic(String value) {
        URI uri = https(value);
        return uri != null && "music.youtube.com".equalsIgnoreCase(uri.getHost());
    }

    static boolean isGoogleAuth(String value) {
        URI uri = https(value);
        return uri != null && ("accounts.google.com".equalsIgnoreCase(uri.getHost()) || "consent.google.com".equalsIgnoreCase(uri.getHost()));
    }

    static boolean isSourceAuth(String value) {
        URI uri = https(value);
        return uri != null && (isGoogleAuth(value) || isSoundCloud(value)
                && ("secure.soundcloud.com".equalsIgnoreCase(uri.getHost()) || authenticationPath(uri.getPath()) || authenticationParameters(uri)));
    }

    private static boolean authenticationPath(String path) {
        String value = path == null ? "" : path.toLowerCase(Locale.ROOT);
        return value.matches("^/(?:oauth|auth|connect|callback|sign-in|signin)(?:/.*)?$")
                || value.endsWith("/callback") || value.endsWith("/oauth-callback");
    }

    private static boolean authenticationParameters(URI uri) {
        String[] keys = { "client_id", "redirect_uri", "code", "code_verifier", "code_challenge", "access_token", "oauth_token", "id_token" };
        for (String key : keys) if (queryValue(uri.getRawQuery(), key) != null || queryValue(uri.getRawFragment(), key) != null) return true;
        return false;
    }

    private static String queryValue(String query, String wanted) {
        if (query == null) return null;
        try {
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                String key = URLDecoder.decode(separator < 0 ? part : part.substring(0, separator), "UTF-8");
                if (wanted.equalsIgnoreCase(key)) return URLDecoder.decode(separator < 0 ? "" : part.substring(separator + 1), "UTF-8");
            }
        } catch (Exception malformedQuery) { return null; }
        return null;
    }

    private static URI https(String value) {
        try {
            if (value == null || value.length() > 8192) return null;
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443) ? uri : null;
        } catch (Exception invalidUrl) { return null; }
    }

    private static Browser browser(PackageManager manager) {
        // Resolve a neutral web link, not the source URL: installed music apps
        // may handle their own app links and would bypass the browser session.
        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"));
        web.addCategory(Intent.CATEGORY_BROWSABLE);
        Set<String> tabs = new LinkedHashSet<>();
        List<ResolveInfo> services = manager.queryIntentServices(new Intent(CUSTOM_TABS_SERVICE), 0);
        for (ResolveInfo service : services) if (service.serviceInfo != null) tabs.add(service.serviceInfo.packageName);
        ResolveInfo preferred = manager.resolveActivity(web, PackageManager.MATCH_DEFAULT_ONLY);
        if (preferred != null && preferred.activityInfo != null && !"android".equals(preferred.activityInfo.packageName)) {
            String name = preferred.activityInfo.packageName;
            return new Browser(name, tabs.contains(name));
        }
        if (!tabs.isEmpty()) return new Browser(tabs.iterator().next(), true);
        for (ResolveInfo candidate : manager.queryIntentActivities(web, PackageManager.MATCH_DEFAULT_ONLY)) {
            if (candidate.activityInfo != null && !"android".equals(candidate.activityInfo.packageName)) return new Browser(candidate.activityInfo.packageName, false);
        }
        return null;
    }

    private static final class Browser {
        final String packageName;
        final boolean customTabs;
        Browser(String packageName, boolean customTabs) { this.packageName = packageName; this.customTabs = customTabs; }
    }

    private SourceBrowser() { }
}
