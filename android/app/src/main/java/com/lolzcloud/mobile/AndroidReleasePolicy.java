package com.lolzcloud.mobile;

import java.math.BigInteger;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Platform-independent release selection; desktop release tags never determine the Android version. */
final class AndroidReleasePolicy {
    static final long MAX_APK = 150L * 1024 * 1024;
    static final String PACKAGE_NAME = "com.lolzcloud.mobile";
    static final String MIRROR = "https://lolzcloud.com/downloads/";
    static final String MIRROR_METADATA = MIRROR + "android-update.json";
    private static final Pattern APK = Pattern.compile("^LolzCloud-Android-(.+)\\.apk$");
    private static final Pattern STABLE = Pattern.compile("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$");
    private static final Pattern SEMVER = Pattern.compile("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$");

    static final class Release {
        final String tag, url;
        final boolean draft, prerelease;
        final List<Asset> assets;
        Release(String tag, String url, boolean draft, boolean prerelease, List<Asset> assets) {
            this.tag = tag; this.url = url; this.draft = draft; this.prerelease = prerelease; this.assets = assets;
        }
    }

    static final class Asset {
        final String name, url, digest;
        final long size;
        Asset(String name, String url, long size, String digest) {
            this.name = name; this.url = url; this.size = size; this.digest = digest;
        }
    }

    static final class Selection {
        final String version, releaseUrl, url, sha256, packageName, certificateSha256;
        final long size, versionCode;
        Selection(String version, String releaseUrl, Asset asset) {
            this(version, 0, releaseUrl, asset.url, asset.size, asset.digest.substring(7), "");
        }
        Selection(String version, long versionCode, String releaseUrl, String url, long size, String sha256, String certificateSha256) {
            this.version = version; this.versionCode = versionCode; this.releaseUrl = releaseUrl;
            this.url = url; this.size = size; this.packageName = PACKAGE_NAME;
            this.sha256 = sha256.toLowerCase(Locale.ROOT);
            this.certificateSha256 = certificateSha256.toLowerCase(Locale.ROOT);
        }
    }

    static Selection selectNewestStable(List<Release> releases) {
        Selection selected = null;
        if (releases == null) return null;
        for (Release release : releases) {
            if (release == null || release.draft || release.prerelease || !isRepositoryRelease(release.url) || release.assets == null) continue;
            for (Asset asset : release.assets) {
                if (asset == null || !isRepositoryAsset(asset.url) || asset.size <= 0 || asset.size > MAX_APK) continue;
                String filename = https(asset.url).getPath();
                filename = filename.substring(filename.lastIndexOf('/') + 1);
                if (!filename.equals(asset.name)) continue;
                if (!validDigest(asset.digest)) continue;
                String version = versionFor(release.tag, asset.name);
                if (version == null) continue;
                if (selected == null || compareVersions(version, selected.version) > 0) selected = new Selection(version, release.url, asset);
            }
        }
        return selected;
    }

    /** An APK without a published checksum must not be presented as a current release. */
    static String newestUnverifiedStableVersion(List<Release> releases) {
        String selected = null;
        if (releases == null) return null;
        for (Release release : releases) {
            if (release == null || release.draft || release.prerelease || !isRepositoryRelease(release.url) || release.assets == null) continue;
            for (Asset asset : release.assets) {
                if (asset == null || !isRepositoryAsset(asset.url) || asset.size <= 0 || asset.size > MAX_APK || validDigest(asset.digest)) continue;
                String path = https(asset.url).getPath();
                if (!path.substring(path.lastIndexOf('/') + 1).equals(asset.name)) continue;
                String version = versionFor(release.tag, asset.name);
                if (version != null && (selected == null || compareVersions(version, selected) > 0)) selected = version;
            }
        }
        return selected;
    }

    private static boolean validDigest(String value) { return value != null && value.matches("sha256:[a-fA-F0-9]{64}"); }

    static Selection selectMirror(String version, long versionCode, String packageName, String url, long size, String sha256, String certificateSha256) {
        if (version == null || version.length() > 128 || !STABLE.matcher(version).matches()
                || versionCode <= 0 || versionCode > Integer.MAX_VALUE || !PACKAGE_NAME.equals(packageName)
                || !isMirrorAsset(url) || !url.equals(MIRROR + "LolzCloud-Android-" + version + ".apk")
                || size <= 0 || size > MAX_APK || sha256 == null || !sha256.matches("[a-fA-F0-9]{64}")
                || certificateSha256 == null || !certificateSha256.isEmpty() && !certificateSha256.matches("[a-fA-F0-9]{64}")) return null;
        return new Selection(version, versionCode, "https://lolzcloud.com/", url, size, sha256, certificateSha256);
    }

    /** Prefer the mirror on a version tie: it supplies the Android versionCode before download. */
    static Selection newest(Selection first, Selection second) {
        if (first == null) return second;
        if (second == null) return first;
        int compared = compareVersions(first.version, second.version);
        if (compared != 0) return compared > 0 ? first : second;
        return second.versionCode > first.versionCode ? second : first;
    }

    static boolean isNewer(Selection selection, String installedVersion, long installedCode) {
        return selection != null && compareVersions(selection.version, installedVersion) > 0
                && (selection.versionCode == 0 || selection.versionCode > installedCode);
    }

    static Selection selectUpdate(Selection first, Selection second, String installedVersion, long installedCode) {
        // Validate even with no candidates; an unknown installed version is never guessed.
        compareVersions(installedVersion, installedVersion);
        return newest(isNewer(first, installedVersion, installedCode) ? first : null,
                isNewer(second, installedVersion, installedCode) ? second : null);
    }

    /** Canonical versioned APKs may live in a desktop release; generic APKs require the Android lane. */
    static String versionFor(String tag, String filename) {
        if (filename == null) return null;
        Matcher matcher = APK.matcher(filename);
        if (!matcher.matches()) return null;
        String suffix = matcher.group(1);
        Version assetVersion = Version.parse(suffix);
        Version lane = tag != null && tag.startsWith("android-v") ? Version.parse(tag.substring("android-v".length())) : null;
        if (tag != null && tag.startsWith("android-v") && (lane == null || !lane.isStable())) return null;
        if (assetVersion != null) {
            if (!assetVersion.isStable() || lane != null && assetVersion.compareTo(lane) != 0) return null;
            return suffix;
        }
        if (lane != null && (suffix.equals("universal") || suffix.equals("release"))) return tag.substring("android-v".length());
        return null;
    }

    static int compareVersions(String left, String right) {
        Version first = Version.parse(left), second = Version.parse(right);
        if (first == null || second == null) throw new IllegalArgumentException("Invalid Android version");
        return first.compareTo(second);
    }

    static boolean isRepositoryRelease(String value) {
        URI uri = https(value);
        String prefix = "/Artemper52/LolzCloud/releases/tag/";
        return uri != null && "github.com".equalsIgnoreCase(uri.getHost()) && cleanPath(uri)
                && uri.getQuery() == null && uri.getFragment() == null && uri.getPath().startsWith(prefix)
                && uri.getPath().length() > prefix.length();
    }

    static boolean isRepositoryAsset(String value) {
        URI uri = https(value);
        if (uri == null || !"github.com".equalsIgnoreCase(uri.getHost()) || !cleanPath(uri)
                || uri.getQuery() != null || uri.getFragment() != null
                || !uri.getPath().startsWith("/Artemper52/LolzCloud/releases/download/")) return false;
        String path = uri.getPath();
        return APK.matcher(path.substring(path.lastIndexOf('/') + 1)).matches();
    }

    static boolean isDownloadUrl(String value) {
        URI uri = https(value);
        if (uri == null || uri.getFragment() != null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return isMirrorAsset(value) || isRepositoryAsset(value) || host.equals("release-assets.githubusercontent.com")
                || host.equals("objects.githubusercontent.com") || host.equals("github-releases.githubusercontent.com");
    }

    static boolean isMirrorAsset(String value) {
        if (value == null || !value.startsWith(MIRROR)) return false;
        URI uri = https(value);
        if (uri == null || !cleanPath(uri) || uri.getQuery() != null || uri.getFragment() != null
                || !uri.getRawPath().equals(uri.getPath())) return false;
        String name = value.substring(MIRROR.length());
        Matcher apk = APK.matcher(name);
        return apk.matches() && apk.group(1).length() <= 128 && STABLE.matcher(apk.group(1)).matches();
    }

    static boolean isDownloadRedirectAllowed(String original, String target) {
        // The website serves a fixed immutable APK directly. GitHub alone uses its known CDN.
        return isRepositoryAsset(original) && !isMirrorAsset(target) && isDownloadUrl(target);
    }

    private static boolean cleanPath(URI uri) {
        if (!uri.normalize().equals(uri) || uri.getPath() == null || uri.getPath().contains("\\")) return false;
        for (String segment : uri.getPath().split("/")) if (segment.equals(".") || segment.equals("..")) return false;
        return true;
    }

    private static URI https(String value) {
        try {
            if (value == null || value.length() > 16384) return null;
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443) ? uri : null;
        } catch (Exception error) { return null; }
    }

    private static final class Version implements Comparable<Version> {
        final BigInteger major, minor, patch;
        final String[] prerelease;
        Version(Matcher matcher) {
            major = new BigInteger(matcher.group(1)); minor = new BigInteger(matcher.group(2)); patch = new BigInteger(matcher.group(3));
            prerelease = matcher.group(4) == null ? new String[0] : matcher.group(4).split("\\.");
        }
        static Version parse(String value) {
            if (value == null || value.length() > 128) return null;
            Matcher matcher = SEMVER.matcher(value);
            if (!matcher.matches()) return null;
            Version result = new Version(matcher);
            for (String part : result.prerelease) if (part.matches("[0-9]+") && part.length() > 1 && part.startsWith("0")) return null;
            return result;
        }
        boolean isStable() { return prerelease.length == 0; }
        @Override public int compareTo(Version other) {
            int result = major.compareTo(other.major);
            if (result == 0) result = minor.compareTo(other.minor);
            if (result == 0) result = patch.compareTo(other.patch);
            if (result != 0) return result;
            if (prerelease.length == 0 || other.prerelease.length == 0) return Integer.compare(other.prerelease.length, prerelease.length);
            for (int index = 0; index < Math.min(prerelease.length, other.prerelease.length); index++) {
                String left = prerelease[index], right = other.prerelease[index];
                boolean leftNumber = left.matches("[0-9]+"), rightNumber = right.matches("[0-9]+");
                result = leftNumber && rightNumber ? new BigInteger(left).compareTo(new BigInteger(right))
                        : leftNumber != rightNumber ? (leftNumber ? -1 : 1) : left.compareTo(right);
                if (result != 0) return result;
            }
            return Integer.compare(prerelease.length, other.prerelease.length);
        }
    }
}
