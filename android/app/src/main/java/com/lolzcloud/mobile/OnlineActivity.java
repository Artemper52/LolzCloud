package com.lolzcloud.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebBackForwardList;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.util.Locale;

/** A visible source page. It does not extract audio, share browser cookies or expose native APIs. */
public final class OnlineActivity extends Activity {
    private static final int BACKGROUND = 0xff111314;
    private static final int FOREGROUND = 0xfff2f2eb;
    private WebView webView;
    private ProgressBar progress;
    private TextView address;
    private TextView pageTitle, errorHeading, errorText;
    private LinearLayout errorPanel;
    private String initialUrl, initialTitle, lastPageUrl;
    private boolean pageError, browserOpening;
    private final NavigationFailureLatch navigationFailure = new NavigationFailureLatch();
    private static final int PICK_PROFILE_IMAGE = 61;
    private ValueCallback<Uri[]> imageCallback;
    private String imagePage;
    private String pausedRoomDocument;
    private int backRequest;
    private static final int ACCOUNT_LOGIN = 62;
    private boolean accountRequired, accountFlowOpen, accountAutoSuppressed;
    private String accountReturnUrl;
    private Button retryButton;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        initialUrl = getIntent().getStringExtra("url");
        if (!isAllowedPage(initialUrl)) {
            Toast.makeText(this, "Этот адрес нельзя открыть внутри приложения", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        boolean accountEntry = AccountPolicy.loginNavigation(initialUrl);
        if (AccountPolicy.provider(initialUrl) && !accountEntry) {
            SourceBrowser.open(this, initialUrl); finish(); return;
        }
        if (accountEntry) {
            accountReturnUrl = AccountPolicy.destination(initialUrl, null, null);
            initialUrl = accountReturnUrl;
            accountRequired = true;
        }
        if (state != null) {
            accountRequired = state.getBoolean("account-required", accountRequired);
            accountFlowOpen = state.getBoolean("account-flow-open", false);
            accountAutoSuppressed = state.getBoolean("account-auto-suppressed", false);
            accountReturnUrl = state.getString("account-return-url", accountReturnUrl);
        }
        if (SourceBrowser.isSoundCloud(initialUrl)) {
            openNativeSoundCloud(initialUrl);
            return;
        }
        lastPageUrl = state == null ? initialUrl : state.getString("last-source-url", initialUrl);
        navigationFailure.begin(initialUrl, true);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        getWindow().getDecorView().setSystemUiVisibility(0);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), 0, dp(4), 0);
        Button back = button("‹", "Назад");
        back.setOnClickListener(view -> onBackPressed());
        bar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(52)));

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.VERTICAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        pageTitle = new TextView(this);
        String label = getIntent().getStringExtra("title");
        initialTitle = TextUtils.isEmpty(label) ? "Онлайн-источник" : label.substring(0, Math.min(100, label.length()));
        pageTitle.setText(pageLabel(initialUrl, initialTitle));
        pageTitle.setTextColor(FOREGROUND);
        pageTitle.setTextSize(16);
        pageTitle.setSingleLine(true);
        pageTitle.setEllipsize(TextUtils.TruncateAt.END);
        address = new TextView(this);
        address.setTextColor(Color.rgb(151, 160, 155));
        address.setTextSize(11);
        address.setSingleLine(true);
        address.setEllipsize(TextUtils.TruncateAt.END);
        heading.addView(pageTitle);
        heading.addView(address);
        bar.addView(heading, new LinearLayout.LayoutParams(0, dp(56), 1));
        Button browser = button("↗", "Открыть в браузере");
        browser.setOnClickListener(view -> openBrowser(browserEntry()));
        bar.addView(browser, new LinearLayout.LayoutParams(dp(48), dp(52)));
        Button more = button("⋮", "Действия страницы");
        more.setOnClickListener(this::showMenu);
        bar.addView(more, new LinearLayout.LayoutParams(dp(48), dp(52)));
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(56)));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(24), dp(28), dp(24));
        errorPanel.setVisibility(View.GONE);
        errorHeading = new TextView(this);
        errorHeading.setText("Не удалось открыть страницу");
        errorHeading.setTextColor(FOREGROUND);
        errorHeading.setTextSize(21);
        errorHeading.setGravity(Gravity.CENTER);
        errorPanel.addView(errorHeading, new LinearLayout.LayoutParams(-1, -2));
        errorText = new TextView(this);
        errorText.setTextColor(0xff97a09b);
        errorText.setTextSize(15);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(14), 0, dp(24));
        errorPanel.addView(errorText, new LinearLayout.LayoutParams(-1, -2));
        retryButton = new Button(this);
        retryButton.setText("Повторить");
        retryButton.setOnClickListener(view -> retryPage());
        errorPanel.addView(retryButton, new LinearLayout.LayoutParams(-1, dp(52)));
        Button browserRetry = new Button(this);
        browserRetry.setText("Открыть в браузере");
        browserRetry.setOnClickListener(view -> openBrowser(browserEntry()));
        errorPanel.addView(browserRetry, new LinearLayout.LayoutParams(-1, dp(52)));
        root.addView(errorPanel, new LinearLayout.LayoutParams(-1, 0, 1));

        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        // Room playback is explicitly enabled by Join/Play in the shared UI.
        // Its claim/SDK/next requests finish after transient touch activation.
        settings.setMediaPlaybackRequiresUserGesture(!SocialPolicy.roomPage(initialUrl));
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // shouldOverrideUrlLoading is not invoked for POST navigation.
                if (request.isForMainFrame() && !isAllowedPage(request.getUrl().toString())) {
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                            java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                return RoomAssets.intercept(OnlineActivity.this, request.getMethod(), request.getUrl().toString());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!request.isForMainFrame()) return !isHttps(url);
                if (AccountPolicy.loginNavigation(url)) { requestAccountLogin(url, false); return true; }
                if (AccountPolicy.provider(url)) { openBrowser(url); return true; }
                if (SourceBrowser.isSoundCloud(url)) { openNativeSoundCloud(url); return true; }
                if (isExternalAuth(url)) {
                    String entry = SourceBrowser.authEntry(initialUrl, view.getUrl());
                    if (entry != null) { showBrowserHandoff(); openBrowser(entry); }
                    else showError("Открой страницу сервиса сначала и повтори вход.");
                    return true;
                }
                if (isAllowedPage(url)) { beginNavigation(url, false); pauseForRoomEntry(url); return false; }
                if (request.hasGesture() && isHttps(url)) openBrowser(url);
                else Toast.makeText(OnlineActivity.this, "Переход вне доверенного источника заблокирован", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                view.getSettings().setMediaPlaybackRequiresUserGesture(!SocialPolicy.roomPage(url));
                if (imageCallback != null && !sameDocument(imagePage, url)) cancelImageChooser();
                if (AccountPolicy.loginNavigation(url)) { view.stopLoading(); requestAccountLogin(url, false); return; }
                if (AccountPolicy.provider(url)) { view.stopLoading(); openBrowser(url); return; }
                if (accountRequired) { view.stopLoading(); return; }
                if (SourceBrowser.isSoundCloud(url)) { view.stopLoading(); openNativeSoundCloud(url); return; }
                if (isExternalAuth(url)) {
                    view.stopLoading();
                    String entry = SourceBrowser.isSoundCloud(url) ? SourceBrowser.entryUrl(url) : SourceBrowser.authEntry(initialUrl, lastPageUrl);
                    if (entry != null) { if (!SourceBrowser.isSoundCloud(url)) showBrowserHandoff(); openBrowser(entry); }
                    else showError("Открой страницу сервиса сначала и повтори вход.");
                    return;
                }
                if (!isAllowedPage(url)) {
                    view.stopLoading();
                    showError("Не удалось открыть этот адрес. Вернись на предыдущую страницу.");
                    return;
                }
                pauseForRoomEntry(url);
                if (navigationFailure.holds(url)) {
                    progress.setVisibility(View.GONE);
                    updateHeading(url, initialTitle);
                    return;
                }
                beginNavigation(url, false);
                pageError = false; hideError();
                if (!authenticationNavigation(url)) lastPageUrl = url;
                progress.setVisibility(View.VISIBLE);
                updateHeading(url, initialTitle);
            }

            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (accountRequired) { CookieManager.getInstance().flush(); updateHeading(AccountPolicy.ORIGIN + "/login", "Вход в LolzCloud"); return; }
                updateHeading(url, view.getTitle());
                CookieManager.getInstance().flush();
                if (SocialPolicy.ownPage(url) || url != null && url.startsWith(SocialPolicy.ORIGIN + "/login")) SocialNotifications.get(OnlineActivity.this).refresh();
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (navigationFailure.current(error.getUrl())) showError("Не удалось подтвердить защищённое соединение. Проверь дату и интернет на телефоне и повтори попытку.");
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (accountRequired) return;
                if (request.isForMainFrame() && navigationFailure.current(request.getUrl().toString())) {
                    showError(error.getErrorCode() == WebViewClient.ERROR_TIMEOUT
                            ? "Сервис долго отвечает. Проверь соединение и попробуй ещё раз."
                            : "Проверь подключение к интернету и повтори попытку.");
                }
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (accountRequired) return;
                if (!request.isForMainFrame() || !navigationFailure.current(request.getUrl().toString())) return;
                if (response.getStatusCode() == 404) showError("Страница не найдена. Комната могла быть закрыта; проверь ссылку.");
                else if (response.getStatusCode() >= 400) showError("Сервис сейчас не отвечает. Попробуй ещё раз немного позже.");
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(pageError || value == 100 ? View.GONE : View.VISIBLE);
            }

            @Override public void onReceivedTitle(WebView view, String title) { updateHeading(view.getUrl(), title); }

            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }

            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                cancelImageChooser();
                String url = view.getUrl();
                if (!SocialPolicy.ownPage(url) || params.getMode() != FileChooserParams.MODE_OPEN || !imageAcceptTypes(params.getAcceptTypes())) {
                    callback.onReceiveValue(null); return true;
                }
                imageCallback = callback; imagePage = url;
                // WebChromeClient omits the requesting frame's origin. A provider iframe's
                // active element in the top document is IFRAME, never this trusted file input.
                view.evaluateJavascript("(function(){var e=document.activeElement;return location.origin==='https://lolzcloud.com'&&!!e&&e.tagName==='INPUT'&&e.type==='file';})()", answer -> {
                    if (imageCallback != callback) return;
                    if (!"true".equals(answer) || webView == null || !sameDocument(imagePage, webView.getUrl()) || !SocialPolicy.ownPage(webView.getUrl())) { cancelImageChooser(); return; }
                    Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("image/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png"})
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivityForResult(picker, PICK_PROFILE_IMAGE); }
                    catch (ActivityNotFoundException unavailable) { cancelImageChooser(); Toast.makeText(OnlineActivity.this, "На телефоне нет приложения для выбора изображения", Toast.LENGTH_LONG).show(); }
                });
                return true;
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (isHttps(url)) openBrowser(url);
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        root.requestApplyInsets();
        Bundle webState = state == null ? null : state.getBundle("source-webview");
        if (accountRequired) {
            showAccountPrompt("Подключи приложение через браузер. Cookies форума остаются в браузере; LolzCloud получит собственную сессию после подтверждения кода.");
            if (state == null && !accountFlowOpen) webView.post(() -> requestAccountLogin(null, false));
        } else if (webState == null || webView.restoreState(webState) == null || !isAllowedPage(webView.getUrl())) {
            webView.loadUrl(initialUrl);
        }
    }

    private Button button(String label, String description) {
        Button button = new Button(this);
        button.setText(label);
        button.setContentDescription(description);
        button.setTextColor(FOREGROUND);
        button.setTextSize(24);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "Обновить страницу");
        menu.getMenu().add(0, 2, 1, "Открыть в браузере");
        menu.getMenu().add(0, 3, 2, "Выйти из онлайн-источников");
        menu.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) retryPage();
            if (item.getItemId() == 2) openBrowser(browserEntry());
            if (item.getItemId() == 3) {
                new AlertDialog.Builder(this).setTitle("Выйти из онлайн-источников?")
                        .setMessage("Будут удалены cookies онлайн-страниц внутри LolzCloud. Библиотека и настройки сохранятся. Сессии системного браузера не изменятся.")
                        .setNegativeButton("Отмена", null).setPositiveButton("Выйти", (dialog, which) -> {
                            AccountLoginController.discard(this);
                            webView.stopLoading();
                            CookieManager.getInstance().removeAllCookies(removed -> {
                                CookieManager.getInstance().flush();
                                SocialNotifications.get(OnlineActivity.this).refresh();
                                android.webkit.WebStorage.getInstance().deleteAllData();
                                if (webView != null && !isFinishing()) {
                                    webView.clearCache(true);
                                    webView.clearHistory();
                                    beginNavigation(initialUrl, true);
                                    webView.loadUrl(initialUrl);
                                }
                            });
                        }).show();
            }
            return true;
        });
        menu.show();
    }

    private String currentUrl() {
        String url = webView == null ? null : webView.getUrl();
        return isAllowedPage(url) ? url : initialUrl;
    }

    private void openBrowser(String value) {
        if (accountRequired) { requestAccountLogin(null, true); return; }
        if (!browserOpening) browserOpening = SourceBrowser.open(this, value);
    }
    private void openNativeSoundCloud(String url) {
        if (isFinishing()) return;
        String entry = SourceBrowser.entryUrl(url);
        if (!SourceBrowser.isSoundCloud(entry)) return;
        if (webView != null) webView.stopLoading();
        startActivity(new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_SOUNDCLOUD_QUERY, entry)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }

    private String browserEntry() {
        String current = currentUrl();
        if (authenticationNavigation(current)) {
            String entry = SourceBrowser.authEntry(initialUrl, current);
            return entry == null ? SourceBrowser.entryUrl(initialUrl) : entry;
        }
        return SourceBrowser.entryUrl(current);
    }

    private void updateHeading(String url, String title) {
        if (pageTitle == null) return;
        String fallback = title == null || title.trim().isEmpty() ? initialTitle : title.trim();
        pageTitle.setText(pageLabel(url, fallback));
        address.setText(hostOf(url));
    }

    private void showError(String description) {
        if (accountRequired) return;
        navigationFailure.failCurrent();
        pageError = true;
        if (errorHeading != null) errorHeading.setText("Не удалось открыть страницу");
        if (progress != null) progress.setVisibility(View.GONE);
        if (errorText != null) errorText.setText(description);
        if (errorPanel != null) errorPanel.setVisibility(View.VISIBLE);
        if (webView != null) webView.setVisibility(View.GONE);
    }

    private void showBrowserHandoff() {
        showError("Продолжи вход там. Музыка и сессия источника останутся в браузере.");
        if (errorHeading != null) errorHeading.setText("Вход открыт в браузере");
    }

    private void hideError() {
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
        if (webView != null) webView.setVisibility(View.VISIBLE);
    }

    private void retryPage() {
        if (accountRequired) { requestAccountLogin(null, false); return; }
        if (webView == null) return;
        String url = authenticationNavigation(currentUrl()) ? initialUrl : lastPageUrl;
        beginNavigation(url, true);
        webView.loadUrl(url);
    }

    private void showAccountPrompt(String message) {
        accountRequired = true; pageError = true;
        if (progress != null) progress.setVisibility(View.GONE);
        if (errorHeading != null) errorHeading.setText("Вход в LolzCloud");
        if (errorText != null) errorText.setText(message);
        if (retryButton != null) retryButton.setText("Войти через браузер");
        if (errorPanel != null) errorPanel.setVisibility(View.VISIBLE);
        if (webView != null) webView.setVisibility(View.GONE);
        updateHeading(AccountPolicy.ORIGIN + "/login", "Вход в LolzCloud");
    }
    private void requestAccountLogin(String navigation, boolean openBrowser) {
        if (accountFlowOpen || isFinishing()) return;
        if (navigation != null && accountAutoSuppressed) return;
        if (navigation == null) accountAutoSuppressed = false;
        accountReturnUrl = AccountPolicy.destination(navigation, lastPageUrl, initialUrl);
        if (webView != null) webView.stopLoading();
        showAccountPrompt("Войди через Lolzteam в браузере и подтверди код телефона. После подтверждения приложение само проверит аккаунт.");
        accountFlowOpen = true;
        try { startActivityForResult(AccountLoginActivity.intent(this, accountReturnUrl, openBrowser), ACCOUNT_LOGIN); }
        catch (ActivityNotFoundException unavailable) { accountFlowOpen = false; showAccountPrompt("Не удалось открыть вход. Перезапусти LolzCloud и повтори."); }
    }

    private void beginNavigation(String url, boolean explicit) {
        if (navigationFailure.begin(url, explicit)) { pageError = false; hideError(); }
    }

    private void pauseForRoomEntry(String url) {
        if (!SocialPolicy.roomPage(url)) { pausedRoomDocument = null; return; }
        String document = NavigationFailureLatch.key(url);
        if (!document.equals(pausedRoomDocument)) {
            pausedRoomDocument = document;
            PlaybackService.pauseForOnlineRoom();
        }
    }

    /** WebView may deliver HTTP failure before a late page-start callback. */
    static final class NavigationFailureLatch {
        private String active = "", failed = "";
        private long attempt, failedAttempt = -1;

        boolean begin(String url, boolean explicit) {
            String next = key(url);
            if (!explicit && next.equals(active)) return false;
            active = next; attempt++; failed = ""; failedAttempt = -1;
            return true;
        }
        boolean current(String url) { return active.equals(key(url)); }
        void failCurrent() { failed = active; failedAttempt = attempt; }
        boolean holds(String url) { return failedAttempt == attempt && failed.equals(key(url)); }

        private static String key(String value) {
            if (value == null) return "";
            try {
                URI uri = new URI(value);
                if (uri.getHost() != null && uri.getScheme() != null) {
                    String scheme = uri.getScheme().toLowerCase(Locale.ROOT), host = uri.getHost().toLowerCase(Locale.ROOT);
                    int port = uri.getPort();
                    String authority = (uri.getRawUserInfo() == null ? "" : uri.getRawUserInfo() + "@") + host
                            + (port < 0 || scheme.equals("https") && port == 443 || scheme.equals("http") && port == 80 ? "" : ":" + port);
                    String path = uri.getRawPath();
                    return scheme + "://" + authority + (path == null || path.isEmpty() ? "/" : path)
                            + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
                }
            } catch (Exception invalidUrl) { }
            int fragment = value.indexOf('#');
            return fragment < 0 ? value : value.substring(0, fragment);
        }
    }

    static String pageLabel(String value, String fallback) {
        String host = hostOf(value), path;
        try { String parsed = new URI(value).getPath(); path = parsed == null ? "" : parsed; }
        catch (Exception invalidUrl) { return fallback; }
        if (host.equals("lolzcloud.com") || host.equals("www.lolzcloud.com")) {
            if (path.equals("/login") || path.startsWith("/auth/")) return "Вход в LolzCloud";
            if (path.equals("/rooms")) return "Комнаты LolzCloud";
            if (path.startsWith("/room/")) return "Слушать вместе";
            if (path.startsWith("/remote/")) return "Пульт LolzCloud";
            if (path.equals("/connect")) return "Подключение LolzCloud";
            if (path.equals("/social")) return "Профиль и друзья LolzCloud";
        }
        if (domain(host, "lolz.live") || domain(host, "lolz.team") || domain(host, "zelenka.guru")) return "Вход через Lolzteam";
        if (host.equals("music.youtube.com")) return "YouTube Music";
        return fallback == null ? "Онлайн-источник" : fallback.substring(0, Math.min(100, fallback.length()));
    }

    private static boolean authenticationNavigation(String value) {
        if (SourceBrowser.isSourceAuth(value)) return true;
        String host = hostOf(value);
        if (domain(host, "lolz.live") || domain(host, "lolz.team") || domain(host, "zelenka.guru")) return true;
        try {
            String path = new URI(value).getPath();
            return (host.equals("lolzcloud.com") || host.equals("www.lolzcloud.com")) && path != null
                    && (path.equals("/login") || path.startsWith("/auth/"));
        } catch (Exception invalidUrl) { return false; }
    }

    static boolean isAllowedPage(String value) {
        if (!isHttps(value)) return false;
        String host = hostOf(value);
        return domain(host, "soundcloud.com") || domain(host, "youtube.com")
                || host.equals("lolzcloud.com") || host.equals("www.lolzcloud.com")
                || host.equals("accounts.google.com") || host.equals("consent.google.com")
                || domain(host, "googleusercontent.com") || domain(host, "gstatic.com")
                || domain(host, "lolz.live") || domain(host, "lolz.team") || domain(host, "zelenka.guru");
    }

    static boolean isExternalAuth(String value) {
        return SourceBrowser.isSourceAuth(value);
    }

    private static boolean domain(String host, String domain) { return host.equals(domain) || host.endsWith("." + domain); }

    private static String hostOf(String value) {
        try { return new URI(value).getHost().toLowerCase(Locale.ROOT); }
        catch (Exception error) { return ""; }
    }

    private static boolean isHttps(String value) {
        if (value == null || value.length() > 8192) return false;
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception error) { return false; }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    static boolean imageAcceptTypes(String[] types) {
        if (types == null || types.length == 0) return false;
        boolean image = false;
        for (String group : types) { if (group == null) return false; for (String value : group.toLowerCase(Locale.ROOT).split(",")) {
            String type = value.trim();
            if (type.isEmpty()) continue;
            if (!type.equals("image/jpeg") && !type.equals("image/png") && !type.equals(".jpg") && !type.equals(".jpeg") && !type.equals(".png")) return false;
            image = true;
        } }
        return image;
    }
    private static boolean sameDocument(String one, String two) { return NavigationFailureLatch.key(one).equals(NavigationFailureLatch.key(two)); }
    private void cancelImageChooser() {
        ValueCallback<Uri[]> callback = imageCallback; imageCallback = null; imagePage = null;
        if (callback != null) callback.onReceiveValue(null);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == ACCOUNT_LOGIN) {
            accountFlowOpen = false;
            if (result == RESULT_OK && data != null) {
                String target = AccountPolicy.target(data.getStringExtra(AccountLoginActivity.RETURN_URL));
                if (target.isEmpty()) target = AccountPolicy.target(accountReturnUrl);
                if (target.isEmpty()) target = AccountPolicy.PROFILE;
                accountRequired = false; accountAutoSuppressed = false; pageError = false;
                retryButton.setText("Повторить"); lastPageUrl = target;
                beginNavigation(target, true); webView.loadUrl(target);
            } else { accountAutoSuppressed = true; showAccountPrompt("Подключение отменено. Войди через браузер, когда будешь готов."); }
            return;
        }
        if (request != PICK_PROFILE_IMAGE) return;
        ValueCallback<Uri[]> callback = imageCallback;
        String page = imagePage; imageCallback = null; imagePage = null;
        if (callback == null) return;
        Uri uri = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() == null) uri = data.getData();
            else if (data.getClipData().getItemCount() == 1) uri = data.getClipData().getItemAt(0).getUri();
        }
        boolean allowed = uri != null && "content".equals(uri.getScheme()) && webView != null
                && SocialPolicy.ownPage(webView.getUrl()) && sameDocument(page, webView.getUrl());
        if (allowed) {
            try {
                String type = getContentResolver().getType(uri);
                allowed = "image/jpeg".equalsIgnoreCase(type) || "image/png".equalsIgnoreCase(type);
            } catch (RuntimeException unavailable) { allowed = false; }
        }
        callback.onReceiveValue(allowed ? new Uri[]{uri} : null);
        if (uri != null && !allowed) Toast.makeText(this, "Выбери изображение JPEG или PNG", Toast.LENGTH_SHORT).show();
    }

    @Override public void onBackPressed() {
        final int request = ++backRequest;
        final WebView current = webView;
        final String url = current == null ? null : current.getUrl();
        if (current != null && !accountRequired && SocialPolicy.roomPage(url)) {
            // A drawer is DOM state, not WebView history. Ask only our own top document.
            Runnable fallback = () -> {
                if (request != backRequest) return;
                backRequest++;
                if (!isFinishing() && webView == current && sameDocument(url, current.getUrl())) nativeBack();
            };
            current.postDelayed(fallback, 800);
            current.evaluateJavascript("(function(){try{var s=window.LolzCloudSocial;if(document.body&&document.body.dataset.page!=='social'&&s&&typeof s.isOpen==='function'&&typeof s.close==='function'&&s.isOpen()){s.close();return true;}}catch(e){}return false;})()", consumed -> {
                if (request != backRequest) return;
                backRequest++;
                current.removeCallbacks(fallback);
                if (!isFinishing() && webView == current && sameDocument(url, current.getUrl()) && !"true".equals(consumed)) nativeBack();
            });
            return;
        }
        nativeBack();
    }

    private void nativeBack() {
        if (webView != null && webView.canGoBack()) {
            WebBackForwardList history = webView.copyBackForwardList();
            int previous = history.getCurrentIndex() - 1;
            beginNavigation(previous >= 0 ? history.getItemAtIndex(previous).getUrl() : initialUrl, true);
            webView.goBack();
        }
        else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("account-required", accountRequired);
        state.putBoolean("account-flow-open", accountFlowOpen);
        state.putBoolean("account-auto-suppressed", accountAutoSuppressed);
        state.putString("account-return-url", accountReturnUrl);
        if (webView != null) {
            Bundle webState = new Bundle();
            webView.saveState(webState);
            state.putBundle("source-webview", webState);
            state.putString("last-source-url", lastPageUrl);
        }
        super.onSaveInstanceState(state);
    }

    @Override protected void onResume() { super.onResume(); browserOpening = false; if (webView != null) webView.onResume(); }
    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        if (webView != null) CookieManager.getInstance().flush();
        super.onPause();
    }
    @Override protected void onDestroy() {
        backRequest++;
        cancelImageChooser();
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
