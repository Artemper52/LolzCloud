package com.lolzcloud.mobile;

import java.util.HashSet;
import java.util.Set;

/** Behavior-level source/session/upload/notification policy, without Android or network. */
public final class SocialPolicyTest {
    private static int checks;
    private static void check(boolean value, String message) { checks++; if (!value) throw new AssertionError(message); }
    public static void main(String[] args) {
        String secret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String cookie = "__Host-lc_session=" + secret;
        check(SocialPolicy.sessionCookie("other=private; " + cookie + "; csrf=not-for-native").equals(cookie), "Only the host session cookie is sent to native API");
        for (String value : new String[]{null, "", "__Host-lc_session=short", "lc_session=" + secret, "__Host-lc_session=" + secret + "\r\nAuthorization: bad"})
            check(SocialPolicy.sessionCookie(value).isEmpty(), "Invalid/header injection credentials are not used");
        for (String value : new String[]{"https://lolzcloud.com/social?tab=profile", "https://lolzcloud.com:443/social?tab=friends&user=42", "https://lolzcloud.com/room/0123456789abcdef0123456789abcdef", "https://lolzcloud.com/room/0123456789abcdef0123456789abcdef/#profile"})
            check(SocialPolicy.ownPage(value), "Only own profile/room can request an image: " + value);
        for (String value : new String[]{null,"http://lolzcloud.com/social","https://evil.test/social","https://lolzcloud.com.evil.test/social","https://lolzcloud.com@evil.test/social","https://evil@lolzcloud.com/social","https://lolzcloud.com:444/social","https://soundcloud.com/social","https://lolzcloud.com/rooms","https://lolzcloud.com/login","https://lolzcloud.com/api/social/me","https://lolzcloud.com/%73ocial","https://lolzcloud.com/room%2f0123456789abcdef0123456789abcdef","file:///android_asset/social.html"})
            check(!SocialPolicy.ownPage(value), "Untrusted or non-profile mainframe cannot upload: " + value);
        for (String value : new String[]{"https://lolzcloud.com/social?tab=friends","https://lolzcloud.com/login","https://lolzcloud.com/remote/0123456789abcdef0123456789abcdef","https://lolzcloud.com/rooms"})
            check(!SocialPolicy.startsPlayback(value), "Browsing social/login/remote keeps native audio");
        check(SocialPolicy.startsPlayback("https://music.youtube.com/watch?v=abcdefghijk"), "An explicit source may take audio focus");
        check(SocialPolicy.startsPlayback("https://soundcloud.com/artist/song"), "SoundCloud source entry pauses native audio");
        check(SocialPolicy.roomPage("https://lolzcloud.com/room/0123456789abcdef0123456789abcdef?from=social"), "A real room entry can hand off native audio");
        check(!SocialPolicy.roomPage("https://lolzcloud.com/social?tab=friends"), "Social browsing does not hand off audio");
        check(!SocialPolicy.roomPage("https://lolzcloud.com.evil.test/room/0123456789abcdef0123456789abcdef"), "Look-alike room URL never controls native playback");
        check(OnlineActivity.imageAcceptTypes(new String[]{"image/jpeg,image/png"}), "Own form JPEG/PNG accept contract");
        check(OnlineActivity.imageAcceptTypes(new String[]{".jpg", ".png"}), "JPEG/PNG file extensions work");
        for (String[] types : new String[][]{null, {}, {""}, {"*/*"}, {"image/*"}, {"image/svg+xml"}, {"image/jpeg", "text/html"}})
            check(!OnlineActivity.imageAcceptTypes(types), "Non-approved upload MIME types rejected");
        long now = 1_800_000_000_000L;
        String id = "00a5bc72-26cc-45e0-9301-4bb8e3d48ed8";
        SocialPolicy.Event event = new SocialPolicy.Event(id, "room_invite", "Ира", now-1000, now+60_000, false, "pending");
        Set<String> seen = new HashSet<>();
        check(!event.shouldNotify(seen,true,true,now), "First successful account snapshot establishes a quiet baseline");
        check(event.shouldNotify(seen,false,true,now), "New unread pending invite can notify");
        seen.add(id);
        check(!event.shouldNotify(seen,false,true,now), "Stable event id never notifies twice");
        seen.clear();
        check(!event.shouldNotify(seen,false,false,now), "Disabled notifications stay silent");
        check(!event.eligible(now+60_001), "Expired invitation stays silent");
        check(!new SocialPolicy.Event(id,"friend_request","Ира",now-1,0,true,"pending").eligible(now), "Read events stay silent");
        check(!new SocialPolicy.Event(id,"room_invite","Ира",now-1,0,false,"declined").eligible(now), "Declined invites stay silent");
        check(!new SocialPolicy.Event(id,"friend_request","Ира",now-1,0,false,"accepted").eligible(now), "Accepted request is no longer actionable");
        check(new SocialPolicy.Event(id,"friend_accept","Ира",now-1,0,false,"accepted").eligible(now), "New friend acceptance is a real event");
        check(!new SocialPolicy.Event(id,"unknown","Ира",now-1,0,false,"pending").eligible(now), "Unknown server event type is not interpreted as native action");
        check(!new SocialPolicy.Event("javascript:alert(1)","room_invite","Ира",now-1,0,false,"pending").eligible(now), "Malformed ids are rejected");
        check(!new SocialPolicy.Event(id,"room_invite","Ира",now+120_000,0,false,"pending").eligible(now), "Far-future events are invalid");
        check(SocialPolicy.NOTIFICATIONS_PAGE.equals("https://lolzcloud.com/social?tab=notifications"), "Click opens review page and never autoaccepts or joins");
        check(SocialPolicy.displayName("\u202eИра\n").equals("Ира"), "Notification labels strip control and bidi override characters");
        System.out.println("Social session/upload/notification policy: " + checks + " behavior checks passed");
    }
}
