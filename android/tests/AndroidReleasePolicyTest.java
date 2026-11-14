package com.lolzcloud.mobile;

import java.util.Arrays;
import java.util.Collections;

/** Run with plain javac/java; no Android runtime or network is required. */
public final class AndroidReleasePolicyTest {
    private static final String REPO = "https://github.com/Artemper52/LolzCloud/releases/";
    private static final String HASH = String.join("", Collections.nCopies(64, "a"));
    private static int checks;

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    private static AndroidReleasePolicy.Asset apk(String tag, String version) {
        String name = "LolzCloud-Android-" + version + ".apk";
        return new AndroidReleasePolicy.Asset(name, REPO + "download/" + tag + "/" + name, 2048, "sha256:" + HASH);
    }

    private static AndroidReleasePolicy.Release release(String tag, boolean draft, boolean prerelease, AndroidReleasePolicy.Asset... assets) {
        return new AndroidReleasePolicy.Release(tag, REPO + "tag/" + tag, draft, prerelease, Arrays.asList(assets));
    }

    private static AndroidReleasePolicy.Selection choose(AndroidReleasePolicy.Release... releases) {
        return AndroidReleasePolicy.selectNewestStable(Arrays.asList(releases));
    }

    private static void sameVersion(String expected, AndroidReleasePolicy.Selection selected, String message) {
        check(selected != null && expected.equals(selected.version), message);
    }

    private static AndroidReleasePolicy.Selection mirror(String version, long code) {
        return AndroidReleasePolicy.selectMirror(version, code, AndroidReleasePolicy.PACKAGE_NAME,
                AndroidReleasePolicy.MIRROR + "LolzCloud-Android-" + version + ".apk", 2048, HASH, "");
    }

    public static void main(String[] arguments) {
        sameVersion("0.2.0", choose(release("v99.0.0", false, false),
                release("android-v0.2.0", false, false, apk("android-v0.2.0", "0.2.0"))),
                "A newer desktop-only release must not hide an earlier Android release");
        sameVersion("0.10.0", choose(release("v0.9.0", false, false, apk("v0.9.0", "0.9.0")),
                release("v0.1.0", false, false, apk("v0.1.0", "0.10.0"))),
                "Select Android semver numerically, independently of desktop tag and list order");
        sameVersion("2.1.0", choose(release("v100.0.0", false, false,
                apk("v100.0.0", "1.99.0"), apk("v100.0.0", "2.1.0"), apk("v100.0.0", "0.99.0"))),
                "Select the greatest matching asset rather than the first one");
        sameVersion("0.3.0", choose(release("android-v9.0.0", true, false, apk("android-v9.0.0", "9.0.0")),
                release("android-v8.0.0", false, true, apk("android-v8.0.0", "8.0.0")),
                release("android-v0.3.0", false, false, apk("android-v0.3.0", "0.3.0"))),
                "Drafts and prereleases never replace the stable Android channel");
        check(choose(release("v1.0.0", false, false, apk("v1.0.0", "1.0.0-beta.1"))) == null,
                "A beta filename is rejected even if the release's prerelease flag is false");
        sameVersion("0.5.0", choose(release("android-v0.5.0", false, false, apk("android-v0.5.0", "universal"))),
                "An Android release lane can version a generic universal APK");
        check(choose(release("v99.0.0", false, false, apk("v99.0.0", "universal"))) == null,
                "A desktop tag cannot supply the version of an unversioned Android APK");
        check(choose(release("android-v0.6.0", false, false, apk("android-v0.6.0", "0.5.0"))) == null,
                "An Android lane and versioned asset must agree");
        check(choose(release("android-v1.0.0-rc.1", false, false, apk("android-v1.0.0-rc.1", "release"))) == null,
                "An Android prerelease tag never enters the stable lane");
        check(AndroidReleasePolicy.compareVersions("1.10.0", "1.9.9") > 0, "Numeric minor version order");
        check(AndroidReleasePolicy.compareVersions("10.0.0", "9.99.99") > 0, "Numeric major version order");
        check(AndroidReleasePolicy.compareVersions("1.0.10", "1.0.9") > 0, "Numeric patch version order");
        check(AndroidReleasePolicy.compareVersions("1.0.0", "1.0.0") == 0, "Equal Android version is current");
        check(AndroidReleasePolicy.compareVersions("0.9.0", "1.0.0") < 0, "Older Android APK is not offered");
        check(AndroidReleasePolicy.compareVersions("1.0.0+build.2", "1.0.0+build.1") == 0, "Build metadata does not change semver order");
        check(AndroidReleasePolicy.compareVersions("1.0.0", "1.0.0-rc.1") > 0, "Stable is newer than an installed prerelease");
        check(AndroidReleasePolicy.compareVersions("1.0.0-rc.10", "1.0.0-rc.2") > 0, "Numeric prerelease identifiers are compared numerically");
        check(AndroidReleasePolicy.compareVersions("999999999999999999999.0.0", "10.0.0") > 0, "Large versions cannot overflow integer comparison");
        check(AndroidReleasePolicy.versionFor("v1.0.0", "LolzCloud-Android-01.0.0.apk") == null, "Invalid leading zero version is rejected");
        check(AndroidReleasePolicy.versionFor("v100.0.0", "LolzCloud-Windows-100.0.0.exe") == null, "Desktop asset is not an Android update");
        boolean invalidVersionRejected = false;
        try { AndroidReleasePolicy.compareVersions("1.0", "1.0.0"); }
        catch (IllegalArgumentException expected) { invalidVersionRejected = true; }
        check(invalidVersionRejected, "Malformed installed version fails instead of offering an assumed update");

        String name = "LolzCloud-Android-0.2.0.apk";
        String url = REPO + "download/android-v0.2.0/" + name;
        check(AndroidReleasePolicy.isRepositoryAsset(url), "Official HTTPS Android asset is allowed");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("https:", "http:")), "HTTP updates are blocked");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("github.com", "github.com.attacker.test")), "Host suffix spoof is blocked");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("github.com", "user@github.com")), "URL credentials are blocked");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("github.com", "github.com:8443")), "Unexpected update port is blocked");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("Artemper52/LolzCloud", "other/repo")), "Other repositories are blocked");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("android-v0.2.0/", "../android-v0.2.0/")), "Dot traversal is blocked");
        check(!AndroidReleasePolicy.isRepositoryAsset(url.replace("android-v0.2.0/", "%2e%2e/android-v0.2.0/")), "Encoded dot traversal is blocked");
        check(AndroidReleasePolicy.isDownloadUrl("https://release-assets.githubusercontent.com/path?signature=example"), "Official signed CDN redirect is allowed");
        check(!AndroidReleasePolicy.isDownloadUrl("https://release-assets.githubusercontent.com.attacker.test/path"), "CDN spoof is blocked");
        check(!AndroidReleasePolicy.isDownloadUrl("file:///tmp/LolzCloud.apk"), "Local file update URL is blocked");
        check(!AndroidReleasePolicy.isDownloadUrl("https://attacker.test/file.apk"), "Unknown download host is blocked");

        check(choose(release("android-v0.2.0", false, false,
                new AndroidReleasePolicy.Asset(name, url, AndroidReleasePolicy.MAX_APK + 1, ""))) == null,
                "Oversized APK metadata is not offered");
        check(choose(release("android-v0.2.0", false, false,
                new AndroidReleasePolicy.Asset(name, url, 0, ""))) == null, "Empty APK is not offered");
        check(choose(release("android-v0.2.0", false, false,
                new AndroidReleasePolicy.Asset(name, url, 2048, "sha256:invalid"))) == null,
                "Malformed official digest fails closed");
        check(choose(release("android-v0.2.0", false, false,
                new AndroidReleasePolicy.Asset(name, url.replace(name, "LolzCloud-Android-0.9.0.apk"), 2048, ""))) == null,
                "Metadata filename and download filename must match");
        sameVersion("0.2.0", choose(release("android-v0.2.0", false, false,
                new AndroidReleasePolicy.Asset(name, url, 2048, "sha256:" + String.join("", Collections.nCopies(64, "A"))))),
                "A valid GitHub SHA-256 digest is accepted");
        check(AndroidReleasePolicy.selectNewestStable(Collections.emptyList()) == null, "Empty release list has no fabricated update");
        check(AndroidReleasePolicy.selectNewestStable(null) == null, "Missing list has no fabricated update");
        check(choose((AndroidReleasePolicy.Release) null) == null, "Invalid release entry has no fabricated update");

        AndroidReleasePolicy.Selection website = mirror("0.1.3", 4);
        sameVersion("0.1.3", website, "Fixed official mirror supplies the Android version independently of desktop releases");
        check(website.versionCode == 4 && website.packageName.equals("com.lolzcloud.mobile"), "Mirror retains the exact Android versionCode and package");
        check(website.sha256.equals(HASH) && website.releaseUrl.equals("https://lolzcloud.com/"), "Mirror retains its checksum and an official details page");
        String mirrorUrl = AndroidReleasePolicy.MIRROR + "LolzCloud-Android-0.1.3.apk";
        check(AndroidReleasePolicy.isMirrorAsset(mirrorUrl), "Canonical HTTPS mirror APK is accepted");
        check(AndroidReleasePolicy.isDownloadUrl(mirrorUrl), "Canonical mirror APK can be downloaded");
        for (String invalid : Arrays.asList(mirrorUrl.replace("https:", "http:"), mirrorUrl.replace("lolzcloud.com", "lolzcloud.com.attacker.test"),
                mirrorUrl.replace("lolzcloud.com", "name@lolzcloud.com"), mirrorUrl.replace("lolzcloud.com", "lolzcloud.com:443"),
                mirrorUrl + "?file=other", mirrorUrl + "#fragment", mirrorUrl.replace("/downloads/", "/downloads/../downloads/"),
                mirrorUrl.replace("/downloads/", "/downloads/%2e%2e/downloads/"), mirrorUrl.replace("/downloads/", "/downloads%2f"),
                mirrorUrl.replace("0.1.3", "0.1.3-beta.1"), mirrorUrl.replace("0.1.3", "0.1.3+build"), mirrorUrl.replace("0.1.3", "00.1.3"),
                mirrorUrl.replace(".apk", ".apk/other"), mirrorUrl.replace("/downloads/", "/other/")))
            check(!AndroidReleasePolicy.isMirrorAsset(invalid), "Mirror rejects spoofed, ambiguous or noncanonical URL: " + invalid);
        check(AndroidReleasePolicy.selectMirror("0.1.3", 4, "other.package", mirrorUrl, 2048, HASH, "") == null, "Another package is never offered");
        check(AndroidReleasePolicy.selectMirror("0.1.4", 4, AndroidReleasePolicy.PACKAGE_NAME, mirrorUrl, 2048, HASH, "") == null, "Mirror APK filename must agree with versionName");
        for (long code : new long[] { -1, 0, ((long) Integer.MAX_VALUE) + 1 })
            check(mirror("0.1.3", code) == null, "Invalid Android versionCode is rejected");
        for (long size : new long[] { -1, 0, AndroidReleasePolicy.MAX_APK + 1 })
            check(AndroidReleasePolicy.selectMirror("0.1.3", 4, AndroidReleasePolicy.PACKAGE_NAME, mirrorUrl, size, HASH, "") == null, "APK size is strictly bounded");
        for (String hash : Arrays.asList("", "a", HASH + "a", HASH.replace('a', 'g'), " " + HASH))
            check(AndroidReleasePolicy.selectMirror("0.1.3", 4, AndroidReleasePolicy.PACKAGE_NAME, mirrorUrl, 2048, hash, "") == null, "Mirror requires an exact SHA-256 checksum");
        check(AndroidReleasePolicy.selectMirror("0.1.3", 4, AndroidReleasePolicy.PACKAGE_NAME, mirrorUrl, 2048, HASH.toUpperCase(), HASH.toUpperCase()).certificateSha256.equals(HASH), "Optional certificate pin is normalized");
        check(AndroidReleasePolicy.selectMirror("0.1.3", 4, AndroidReleasePolicy.PACKAGE_NAME, mirrorUrl, 2048, HASH, "invalid") == null, "Malformed certificate pin is rejected");

        AndroidReleasePolicy.Selection github = choose(release("android-v0.1.4", false, false, apk("android-v0.1.4", "0.1.4")));
        sameVersion("0.1.4", AndroidReleasePolicy.newest(website, github), "A newer validated GitHub release wins over the mirror");
        sameVersion("0.1.5", AndroidReleasePolicy.newest(github, mirror("0.1.5", 6)), "A newer validated mirror wins over GitHub");
        check(AndroidReleasePolicy.newest(choose(release("android-v0.1.3", false, false, apk("android-v0.1.3", "0.1.3"))), website) == website, "Same-version mirror is preferred because it binds versionCode");
        check(AndroidReleasePolicy.newest(website, null) == website && AndroidReleasePolicy.newest(null, github) == github, "One unavailable source does not hide the working source");
        check(AndroidReleasePolicy.selectUpdate(null, website, "0.1.2", 3) == website, "0.1.2 code3 can discover mirror0.1.3 code4 in the new updater");
        check(AndroidReleasePolicy.selectUpdate(null, website, "0.1.3", 4) == null, "Equal mirror version is not offered");
        check(AndroidReleasePolicy.selectUpdate(null, website, "0.1.4", 5) == null, "Old mirror cannot downgrade an installed app");
        check(AndroidReleasePolicy.selectUpdate(null, mirror("0.2.0", 3), "0.1.3", 4) == null, "Higher versionName with old versionCode cannot be offered");
        check(AndroidReleasePolicy.selectUpdate(github, mirror("0.2.0", 3), "0.1.3", 4) == github, "Invalid mirror versionCode does not hide a valid fallback");
        check(AndroidReleasePolicy.selectUpdate(null, mirror("0.1.2", 20), "0.1.3", 4) == null, "Higher code cannot bypass a lower versionName");
        boolean unknownInstalledRejected = false;
        try { AndroidReleasePolicy.selectUpdate(null, null, "unknown", 3); }
        catch (IllegalArgumentException expected) { unknownInstalledRejected = true; }
        check(unknownInstalledRejected, "Missing installed semver fails closed even without candidates");

        AndroidReleasePolicy.Release unsigned = release("android-v0.1.5", false, false,
                new AndroidReleasePolicy.Asset("LolzCloud-Android-0.1.5.apk", REPO + "download/android-v0.1.5/LolzCloud-Android-0.1.5.apk", 2048, ""));
        check(choose(unsigned) == null, "GitHub APKs without a published digest are not installable candidates");
        check("0.1.5".equals(AndroidReleasePolicy.newestUnverifiedStableVersion(Arrays.asList(unsigned))), "Unverified new version is retained for an honest checksum error");
        check(AndroidReleasePolicy.newestUnverifiedStableVersion(Arrays.asList(release("android-v0.1.4", false, false, apk("android-v0.1.4", "0.1.4")))) == null, "Checksummed GitHub candidate does not produce an unverified warning");
        check(!AndroidReleasePolicy.isDownloadRedirectAllowed(mirrorUrl, "https://attacker.test/update.apk"), "Mirror cannot redirect to another origin");
        check(!AndroidReleasePolicy.isDownloadRedirectAllowed(mirrorUrl, mirrorUrl), "Mirror serves immutable APKs directly without redirects");
        check(!AndroidReleasePolicy.isDownloadRedirectAllowed(mirrorUrl, "https://release-assets.githubusercontent.com/file"), "Mirror cannot switch into the GitHub CDN trust lane");
        check(AndroidReleasePolicy.isDownloadRedirectAllowed(url, "https://release-assets.githubusercontent.com/path?signature=example"), "GitHub retains its official CDN redirect support");
        check(!AndroidReleasePolicy.isDownloadRedirectAllowed(url, mirrorUrl), "GitHub cannot redirect into the mirror trust lane");
        check(!AndroidReleasePolicy.isDownloadRedirectAllowed(url, "https://release-assets.githubusercontent.com.attacker.test/path"), "CDN redirect host spoof remains blocked");
        System.out.println("Android release policy: " + checks + " behavior checks passed");
    }

    private AndroidReleasePolicyTest() { }
}
