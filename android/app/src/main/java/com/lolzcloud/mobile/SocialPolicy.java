package com.lolzcloud.mobile;

import java.net.URI;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Pure policy shared by the native HTTPS client, notifications and image picker. */
public final class SocialPolicy {
    public static final String ORIGIN = "https://lolzcloud.com";
    public static final String NOTIFICATIONS_PAGE = ORIGIN + "/social?tab=notifications";
    private SocialPolicy() { }

    static String sessionCookie(String cookies) {
        if (cookies == null) return "";
        for (String pair : cookies.split(";")) {
            String value = pair.trim();
            if (value.matches("__Host-lc_session=[A-Za-z0-9_-]{43}")) return value;
        }
        return "";
    }

    static boolean ownPage(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"lolzcloud.com".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443) return false;
            String path = uri.getRawPath();
            return "/social".equals(path) || path != null && path.matches("/room/[a-f0-9]{32}/?");
        } catch (Exception invalid) { return false; }
    }

    static String userId(Object value) {
        String id = value == null ? "" : String.valueOf(value);
        return id.matches("[A-Za-z0-9_-]{1,80}") ? id : "";
    }

    static boolean startsPlayback(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            return "https".equalsIgnoreCase(uri.getScheme()) && (host.equals("soundcloud.com") || host.endsWith(".soundcloud.com")
                    || host.equals("music.youtube.com") || host.equals("lolzcloud.com") && uri.getRawPath().matches("/room/[a-f0-9]{32}/?"));
        } catch (Exception invalid) { return false; }
    }

    static boolean roomPage(String value) {
        if (!ownPage(value)) return false;
        try { return new URI(value).getRawPath().matches("/room/[a-f0-9]{32}/?"); }
        catch (Exception invalid) { return false; }
    }

    static boolean eventId(String value) {
        try { return value != null && UUID.fromString(value).toString().equals(value.toLowerCase(Locale.ROOT)); }
        catch (IllegalArgumentException invalid) { return false; }
    }

    static String displayName(String value) {
        if (value == null) return "Слушатель";
        String clean = value.replaceAll("[\\p{Cntrl}\\p{Cf}]", " ").trim();
        return clean.isEmpty() ? "Слушатель" : clean.substring(0, Math.min(80, clean.length()));
    }

    static final class Event {
        final String id, type, actorName, status;
        final long createdAt, expiresAt;
        final boolean read;
        Event(String id, String type, String actorName, long createdAt, long expiresAt, boolean read, String status) {
            this.id = id == null ? null : id.toLowerCase(Locale.ROOT); this.type = type; this.actorName = displayName(actorName);
            this.createdAt = createdAt; this.expiresAt = expiresAt; this.read = read; this.status = status;
        }
        boolean eligible(long now) {
            if (!eventId(id) || read || createdAt <= 0 || createdAt > now + 60_000
                    || expiresAt > 0 && expiresAt <= now) return false;
            if ("friend_accept".equals(type)) return "accepted".equals(status) || "pending".equals(status);
            return ("room_invite".equals(type) || "friend_request".equals(type)) && "pending".equals(status);
        }
        boolean shouldNotify(Set<String> seen, boolean baseline, boolean enabled, long now) {
            return !baseline && enabled && !seen.contains(id) && eligible(now);
        }
        String title() { return "room_invite".equals(type) ? "Приглашение слушать вместе" : "friend_request".equals(type) ? "Запрос в друзья" : "Теперь вы друзья"; }
        String message() { return actorName + ("room_invite".equals(type) ? " приглашает в комнату" : "friend_request".equals(type) ? " хочет добавить тебя в друзья" : " принял запрос в друзья"); }
    }
}
