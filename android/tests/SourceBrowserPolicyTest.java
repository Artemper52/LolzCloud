package com.lolzcloud.mobile;

/** Plain Java checks for whole-source login routing. No account, browser or network is simulated as success. */
public final class SourceBrowserPolicyTest {
    private static int checks;
    private static final String HOME = "https://soundcloud.com/";
    private static final String TRACK = "https://soundcloud.com/artist/recording?si=shared";
    private static final String SEARCH = "https://soundcloud.com/search/sounds?q=%D1%82%D1%91%D0%BC%D0%BD%D1%8B%D0%B9%20%D0%BF%D1%80%D0%B8%D0%BD%D1%86";
    private static final String YTM = "https://music.youtube.com/search?q=quiet%20music";
    private static final String GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth?state=fixture&redirect_uri=https%3A%2F%2Fsecure.soundcloud.com%2Fcallback";
    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    private static void entry(String original, String expected) {
        String actual = SourceBrowser.entryUrl(original);
        check(expected == null ? actual == null : expected.equals(actual), "Safe source entry for " + original);
    }

    public static void main(String[] arguments) {
        entry(HOME, HOME);
        entry(TRACK, TRACK);
        entry(SEARCH, SEARCH);
        entry("https://m.soundcloud.com/artist/recording", "https://m.soundcloud.com/artist/recording");
        entry("https://on.soundcloud.com/short-link", "https://on.soundcloud.com/short-link");
        entry("https://soundcloud.com/artist/recording?secret_token=s-private", "https://soundcloud.com/artist/recording?secret_token=s-private");
        entry("https://secure.soundcloud.com/", HOME);
        entry("https://secure.soundcloud.com/oauth/authorize?client_id=fixture&state=fixture", HOME);
        entry("https://secure.soundcloud.com/callback?code=fixture&state=fixture", HOME);
        entry("https://soundcloud.com/connect?state=fixture", HOME);
        entry("https://soundcloud.com/oauth-callback?code=fixture", HOME);
        entry("https://soundcloud.com/artist/recording?code=fixture", HOME);
        entry("https://soundcloud.com/#access_token=fixture", HOME);
        entry("https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Frecording", "https://soundcloud.com/artist/recording");
        entry("https://w.soundcloud.com/player/?url=javascript%3Aalert(1)", HOME);
        entry("https://api.soundcloud.com/me", HOME);
        entry(GOOGLE, null);
        entry("https://consent.google.com/m?continue=fixture", null);
        entry(YTM, YTM);
        entry("https://music.youtube.com/oauth/callback?code=fixture", "https://music.youtube.com/");
        entry("https://music.youtube.com/watch?v=music-id#access_token=fixture", "https://music.youtube.com/");
        entry("https://lolzcloud.com/rooms", "https://lolzcloud.com/rooms");
        entry("http://soundcloud.com/artist/recording", null);
        entry("https://user@soundcloud.com/artist/recording", null);
        entry("https://soundcloud.com:8443/artist/recording", null);
        entry("file:///sdcard/callback.html", null);
        entry("content://soundcloud.com/callback", null);
        entry("javascript:alert(1)", null);
        entry("intent://callback#Intent;scheme=google;end", null);
        entry(null, null);
        check(SourceBrowser.isSoundCloud("https://soundcloud.com/artist/recording"), "Public source is classified as SoundCloud");
        check(SourceBrowser.isSoundCloud("https://secure.soundcloud.com/callback"), "SoundCloud callback is recognized before restarting the complete source");
        check(!SourceBrowser.isSoundCloud("https://soundcloud.com.attacker.test/callback"), "SoundCloud host suffix spoof is not classified as the source");
        check(!SourceBrowser.isSoundCloud("https://soundcloud.com@attacker.test/callback"), "SoundCloud user-info spoof is rejected");
        check(!SourceBrowser.isSoundCloud("https://attacker.test/soundcloud.com"), "A path does not determine source ownership");
        check(YTM.equals(SourceBrowser.authEntry(YTM, GOOGLE)), "Google authentication restarts the original complete YouTube Music search");
        check(TRACK.equals(SourceBrowser.authEntry(TRACK, GOOGLE)), "SoundCloud recovers the original public track instead of an orphan callback");
        check(HOME.equals(SourceBrowser.authEntry("https://secure.soundcloud.com/callback?code=fixture", GOOGLE)), "An orphan SoundCloud callback starts again from the homepage");
        check("https://lolzcloud.com/rooms".equals(SourceBrowser.authEntry("https://lolzcloud.com/auth/lolz/callback", GOOGLE)), "LolzCloud fallback restarts its own complete flow");
        check(SourceBrowser.authEntry(null, GOOGLE) == null, "Unknown partial Google flow is not forwarded");
        check(!OnlineActivity.isExternalAuth("https://lolz.live/account/authorize?state=fixture"), "Ordinary Lolzteam authorization stays in its existing WebView session");
        check(OnlineActivity.isExternalAuth(GOOGLE), "A restricted Google agent is recognized for whole-source browser handoff");
        check("Вход в LolzCloud".equals(OnlineActivity.pageLabel("https://lolzcloud.com/login?next=/remote/fixture", "Пульт LolzCloud")), "A login redirect updates the native title instead of retaining the remote title");
        check("Пульт LolzCloud".equals(OnlineActivity.pageLabel("https://lolzcloud.com/remote/fixture", "Вход в LolzCloud")), "A completed login navigation can return to the actual remote title");
        check("Слушать вместе".equals(OnlineActivity.pageLabel("https://lolzcloud.com/room/0123456789abcdef0123456789abcdef", "Пульт")), "A room displays its own native title");
        check("Вход через Lolzteam".equals(OnlineActivity.pageLabel("https://lolz.live/account/authorize", "Комнаты")), "Provider redirect is labeled as Lolzteam sign-in");
        check("YouTube Music".equals(OnlineActivity.pageLabel(YTM, "Account")), "YouTube Music label reflects the current source");
        OnlineActivity.NavigationFailureLatch latch = new OnlineActivity.NavigationFailureLatch();
        String missing = "https://lolzcloud.com/missing-test-page";
        check(latch.begin(missing, true), "Initial load begins a navigation attempt");
        latch.failCurrent();
        check(latch.holds(missing), "HTTP failure is latched for the current attempt");
        check(!latch.begin(missing, false) && latch.holds(missing), "A late page-start for the failed URL cannot clear its error");
        check(!latch.begin(missing + "#anchor", false) && latch.holds(missing + "#anchor"), "Fragment-only changes preserve the failed request latch");
        check(latch.current("https://LOLZCLOUD.COM:443/missing-test-page#other"), "Canonical host/default port and fragments identify the same request");
        check(latch.begin(missing, true) && !latch.holds(missing), "Explicit Retry clears the latch before reloading the same URL");
        latch.failCurrent();
        check(latch.holds(missing), "A failed retry receives its own stable error state");
        check(latch.begin("https://lolzcloud.com/login", false) && !latch.holds(missing), "A different destination clears the previous navigation's failure");
        check(!latch.current(missing), "An obsolete error from another URL does not belong to the new navigation");
        check(latch.begin(missing, true), "Explicit Back may start the earlier URL again");
        latch.failCurrent();
        check(latch.holds(missing) && !latch.holds(missing + "?other=1"), "Distinct queries are separate requests, not fragment changes");
        System.out.println("Source browser whole-flow policy: " + checks + " behavior checks passed");
    }

    private SourceBrowserPolicyTest() { }
}
