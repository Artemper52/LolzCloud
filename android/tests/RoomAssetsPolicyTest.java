package com.lolzcloud.mobile;

import java.util.Map;

/** Pure routing/auth policy checks; compilation needs android.jar, execution uses no device or network. */
public final class RoomAssetsPolicyTest {
    private static final String ID = "0123456789abcdef0123456789abcdef";
    private static int checks;
    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    private static void matches(String url, String file, String mime) {
        RoomAssets.Route route = RoomAssets.route("GET", url);
        check(route != null && route.assetPath.equals("room-client/" + file) && route.mime.equals(mime), "Bundled route: " + url);
    }
    private static void network(String method, String url) {
        check(RoomAssets.route(method, url) == null, "Must remain genuine network: " + method + " " + url);
    }

    public static void main(String[] arguments) {
        matches("https://lolzcloud.com/room/" + ID, "room.html", "text/html");
        matches("https://lolzcloud.com/room/" + ID + "/", "room.html", "text/html");
        matches("https://lolzcloud.com:443/room/" + ID + "?source=invite", "room.html", "text/html");
        matches("https://LOLZCLOUD.COM/room/" + ID, "room.html", "text/html");
        matches("https://lolzcloud.com/cloud/room.css", "room.css", "text/css");
        matches("https://lolzcloud.com/cloud/site.js", "site.js", "text/javascript");
        matches("https://lolzcloud.com/cloud/room.js", "room.js", "text/javascript");
        matches("https://lolzcloud.com/cloud/room-sync.js", "room-sync.js", "text/javascript");
        matches("https://lolzcloud.com/cloud/room-players.js", "room-players.js", "text/javascript");
        matches("https://lolzcloud.com/cloud/media-source.js", "media-source.js", "text/javascript");
        matches("https://lolzcloud.com/assets/logo.svg", "logo.svg", "image/svg+xml");
        matches("https://lolzcloud.com/social?tab=friends&user=42", "social.html", "text/html");
        matches("https://lolzcloud.com/cloud/social.js", "social.js", "text/javascript");
        matches("https://lolzcloud.com/cloud/social.css", "social.css", "text/css");
        network("POST", "https://lolzcloud.com/social");
        network("GET", "https://lolzcloud.com/api/social/me");
        network("GET", "https://lolzcloud.com/api/social/notifications");
        network("GET", "https://lolzcloud.com/social/../api/social/me");
        network("POST", "https://lolzcloud.com/room/" + ID);
        network("HEAD", "https://lolzcloud.com/cloud/room.js");
        network("get", "https://lolzcloud.com/cloud/room.js");
        network("GET", "https://lolzcloud.com/api/session");
        network("GET", "https://lolzcloud.com/api/rooms/" + ID + "/events");
        network("POST", "https://lolzcloud.com/api/rooms/" + ID + "/queue");
        network("GET", "https://lolzcloud.com/auth/lolz?next=%2Froom%2F" + ID);
        network("GET", "https://lolzcloud.com/auth/lolz/callback#access_token=fixture");
        network("GET", "https://lolzcloud.com/cloud/callback.js");
        network("GET", "https://lolzcloud.com/login?next=%2Froom%2F" + ID);
        network("GET", "https://lolzcloud.com/rooms");
        network("GET", "https://lolzcloud.com/cloud/remote.js");
        network("GET", "https://lolzcloud.com/cloud/unknown.js");
        network("GET", "https://lolzcloud.com/room/short");
        network("GET", "https://lolzcloud.com/room/" + ID.toUpperCase());
        network("GET", "https://lolzcloud.com/room/" + ID + "/other");
        network("GET", "https://lolzcloud.com/room%2f" + ID);
        network("GET", "https://lolzcloud.com/cloud/%72oom.js");
        network("GET", "https://lolzcloud.com/cloud/../cloud/room.js");
        network("GET", "https://lolzcloud.com/cloud/%2e%2e/cloud/room.js");
        network("GET", "http://lolzcloud.com/room/" + ID);
        network("GET", "https://www.lolzcloud.com/room/" + ID);
        network("GET", "https://api.lolzcloud.com/room/" + ID);
        network("GET", "https://lolzcloud.com.attacker.test/room/" + ID);
        network("GET", "https://attacker@lolzcloud.com/room/" + ID);
        network("GET", "https://lolzcloud.com@attacker.test/room/" + ID);
        network("GET", "https://lolzcloud.com:8443/room/" + ID);
        network("GET", "https://soundcloud.com/cloud/room.js");
        network("GET", "https://www.youtube.com/iframe_api");
        network("GET", "file:///android_asset/room-client/room.html");
        network("GET", "content://lolzcloud.com/room/" + ID);
        network("GET", "/room/" + ID);
        network("GET", "javascript:alert(1)");
        network("GET", null);

        Map<String, String> headers = RoomAssets.headers("text/html");
        check(headers.get("Content-Type").equals("text/html; charset=utf-8"), "Explicit UTF-8 HTML content type");
        check(headers.get("Content-Security-Policy").contains("connect-src 'self'"), "Backend remains limited to the real same origin");
        check(headers.get("Content-Security-Policy").contains("frame-src https://w.soundcloud.com https://www.youtube.com https://www.youtube-nocookie.com"), "Only official media frames are enabled");
        check(!headers.get("Content-Security-Policy").contains("unsafe-inline"), "No inline script bypass");
        check(headers.get("Cache-Control").equals("no-store") && headers.get("X-Content-Type-Options").equals("nosniff"), "No stale cache or MIME sniffing");
        check(!headers.containsKey("Set-Cookie") && !headers.containsKey("Access-Control-Allow-Origin"), "Bundled responses do not grant authentication or CORS access");

        check(OnlineActivity.isAllowedPage("https://lolz.live/account/authorize?state=fixture"), "Lolz OAuth provider remains an allowed HTTPS navigation");
        check(AccountPolicy.loginNavigation("https://lolz.live/account/authorize?state=fixture"), "Lolz provider now enters native browser device pairing");
        check(AccountPolicy.loginNavigation("https://lolzcloud.com/auth/lolz?next=/rooms"), "LolzCloud OAuth entry now enters native device pairing");
        check(AccountPolicy.loginNavigation("https://lolzcloud.com/auth/lolz/callback#state=fixture"), "A partial Lolz callback cannot be mistaken for app authorization");
        check(OnlineActivity.isExternalAuth("https://accounts.google.com/signin/v2/identifier"), "Google restricted authentication may open externally");
        check(OnlineActivity.isExternalAuth("https://secure.soundcloud.com/oauth/authorize"), "SoundCloud OAuth may open externally");
        check(!OnlineActivity.isAllowedPage("https://lolz.live.attacker.test/account/authorize"), "Look-alike OAuth host is blocked");
        check(!OnlineActivity.isAllowedPage("http://lolz.live/account/authorize"), "OAuth never downgrades to HTTP");
        System.out.println("Bundled room routing/auth policy: " + checks + " behavior checks passed");
    }

    private RoomAssetsPolicyTest() { }
}
