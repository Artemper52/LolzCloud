package com.lolzcloud.mobile;

import android.content.Context;
import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Bundled UI at the real HTTPS origin. Authentication and every API request remain server-owned. */
public final class RoomAssets {
    private static final Pattern ROOM = Pattern.compile("^/room/[a-f0-9]{32}/?$");
    private static final Map<String, Route> STATIC;
    private static final String CSP = "default-src 'none'; script-src 'self' https://w.soundcloud.com https://www.youtube.com https://s.ytimg.com; "
            + "style-src 'self'; img-src 'self' https: data:; connect-src 'self'; "
            + "frame-src https://w.soundcloud.com https://www.youtube.com https://www.youtube-nocookie.com; "
            + "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

    static {
        Map<String, Route> routes = new LinkedHashMap<>();
        routes.put("/cloud/room.css", new Route("room.css", "text/css"));
        routes.put("/cloud/site.js", new Route("site.js", "text/javascript"));
        routes.put("/cloud/room-sync.js", new Route("room-sync.js", "text/javascript"));
        routes.put("/cloud/room-players.js", new Route("room-players.js", "text/javascript"));
        routes.put("/cloud/media-source.js", new Route("media-source.js", "text/javascript"));
        routes.put("/cloud/room.js", new Route("room.js", "text/javascript"));
        routes.put("/cloud/social.js", new Route("social.js", "text/javascript"));
        routes.put("/cloud/social.css", new Route("social.css", "text/css"));
        routes.put("/assets/logo.svg", new Route("logo.svg", "image/svg+xml"));
        STATIC = Collections.unmodifiableMap(routes);
    }

    static final class Route {
        final String assetPath, mime;
        Route(String filename, String mime) { this.assetPath = "room-client/" + filename; this.mime = mime; }
    }

    /** Null means the WebView must use the genuine network, including its cookies and TLS checks. */
    static Route route(String method, String value) {
        if (!"GET".equals(method) || value == null || value.length() > 8192) return null;
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"lolzcloud.com".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443) return null;
            // Match raw paths so encoded separators, traversal and look-alike routes
            // never acquire a local response or reinterpret an API/authentication URL.
            String path = uri.getRawPath();
            if (path == null) return null;
            if (ROOM.matcher(path).matches()) return new Route("room.html", "text/html");
            if ("/social".equals(path)) return new Route("social.html", "text/html");
            return STATIC.get(path);
        } catch (Exception invalidUrl) { return null; }
    }

    public static WebResourceResponse intercept(Context context, String method, String url) {
        Route route = route(method, url);
        if (route == null) return null;
        try {
            InputStream input = context.getAssets().open(route.assetPath, AssetManager.ACCESS_STREAMING);
            return new WebResourceResponse(route.mime, "UTF-8", 200, "OK", headers(route.mime), input);
        } catch (IOException missingAsset) {
            byte[] body = "Не удалось открыть комнату. Обнови LolzCloud и попробуй снова.".getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("text/plain", "UTF-8", 503, "Bundled interface unavailable", headers("text/plain"),
                    new ByteArrayInputStream(body));
        }
    }

    static Map<String, String> headers(String mime) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", mime + "; charset=utf-8");
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Referrer-Policy", "no-referrer");
        headers.put("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        headers.put("Content-Security-Policy", CSP);
        return headers;
    }

    private RoomAssets() { }
}
