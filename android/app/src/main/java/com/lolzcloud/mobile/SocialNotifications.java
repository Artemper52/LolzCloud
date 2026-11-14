package com.lolzcloud.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.webkit.CookieManager;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** API-backed social notifications. Periodic background work is best-effort, never a media FGS. */
public final class SocialNotifications {
    private static final String CHANNEL = "lolzcloud_social";
    private static final int JOB_ID = 41203;
    private static SocialNotifications instance;
    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Set<Listener> listeners = new HashSet<>();
    private final List<Runnable> completions = new ArrayList<>();
    private int startedActivities;
    private boolean busy;
    private State state = new State(false, "", 0, false, "Войди через Lolzteam для профиля и друзей");

    public interface Listener { void onSocialState(State state); }
    public static final class State {
        public final boolean signedIn, serverNotificationsEnabled;
        public final String name, status;
        public final int unread;
        State(boolean signedIn, String name, int unread, boolean enabled, String status) {
            this.signedIn = signedIn; this.name = name; this.unread = unread; this.serverNotificationsEnabled = enabled; this.status = status;
        }
    }

    public static synchronized SocialNotifications get(Context context) {
        if (instance == null) instance = new SocialNotifications(context.getApplicationContext());
        return instance;
    }
    private SocialNotifications(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences("lolzcloud_social_v1", Context.MODE_PRIVATE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Друзья и приглашения", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Запросы в друзья и приглашения в комнаты LolzCloud");
        channel.enableVibration(true);
        manager().createNotificationChannel(channel);
    }

    public State state() { return state; }
    public boolean enabled() { return prefs.getBoolean("enabled", true); }
    public void setEnabled(boolean enabled) {
        prefs.edit().putBoolean("enabled", enabled).apply();
        if (!enabled) { cancelSocialNotifications(); scheduler().cancel(JOB_ID); }
        else { scheduleIfSignedIn(); refresh(); }
    }
    public boolean systemAllowed() {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationChannel channel = manager().getNotificationChannel(CHANNEL);
        return manager().areNotificationsEnabled() && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
    }
    public void requestPermissionOrSettings(Activity activity) {
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && (!prefs.getBoolean("permission_asked", false) || activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))) {
            prefs.edit().putBoolean("permission_asked", true).apply();
            activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 52);
        } else {
            Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL);
            try { activity.startActivity(intent); } catch (android.content.ActivityNotFoundException missing) {
                activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName()));
            }
        }
    }
    public void addListener(Listener listener) { listeners.add(listener); listener.onSocialState(state); }
    public void removeListener(Listener listener) { listeners.remove(listener); }

    void activityStarted() {
        startedActivities++;
        if (startedActivities == 1) { main.removeCallbacks(poll); main.post(poll); }
    }
    void activityStopped() {
        startedActivities = Math.max(0, startedActivities - 1);
        if (startedActivities == 0) main.removeCallbacks(poll);
    }
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            refresh();
            if (startedActivities > 0) main.postDelayed(this, 15_000);
        }
    };

    public void refresh() { refresh(null); }
    void refresh(Runnable completion) {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post(() -> refresh(completion)); return; }
        if (completion != null) completions.add(completion);
        if (busy) return;
        String cookie = cookie();
        if (cookie.isEmpty()) {
            cancelSocialNotifications(); scheduler().cancel(JOB_ID);
            publish(new State(false, "", 0, false, "Войди через Lolzteam для профиля и друзей"));
            finishRefresh(); return;
        }
        scheduleIfSignedIn();
        busy = true;
        worker.execute(() -> {
            SocialApi.Snapshot response = null; Exception error = null;
            try { response = SocialApi.fetch(cookie); } catch (Exception failure) { error = failure; }
            final SocialApi.Snapshot result = response; final Exception failure = error;
            main.post(() -> {
                try {
                    // Login/logout can finish while HTTPS is in flight. Never apply another session's result.
                    if (!cookie.equals(cookie())) return;
                    if (result != null) apply(result);
                    else if (failure instanceof SocialApi.Unauthorized) {
                        cancelSocialNotifications();
                        publish(new State(false, "", 0, false, "Сессия закончилась. Войди через Lolzteam"));
                    } else publish(new State(false, "", 0, false, failure == null ? "Не удалось обновить профиль" : failure.getMessage()));
                } finally { busy = false; finishRefresh(); }
            });
        });
    }

    private void apply(SocialApi.Snapshot response) {
        if (!response.userId.equals(prefs.getString("account", ""))) cancelSocialNotifications();
        String key = "seen_" + response.userId;
        boolean baseline = !prefs.contains(key);
        LinkedHashSet<String> seen = new LinkedHashSet<>(prefs.getStringSet(key, new HashSet<String>()));
        boolean notify = enabled() && response.notificationsEnabled && systemAllowed();
        long now = System.currentTimeMillis();
        for (SocialPolicy.Event event : response.events) {
            if (event.shouldNotify(seen, baseline, notify, now)) show(response.userId, event);
            seen.add(event.id);
            if (event.read || !event.eligible(now)) manager().cancel(tag(response.userId, event.id), 1);
        }
        // Bounded per-account dedup; current snapshot remains retained even after a long account history.
        Set<String> currentIds = new HashSet<>();
        for (SocialPolicy.Event event : response.events) currentIds.add(event.id);
        java.util.Iterator<String> older = seen.iterator();
        while (seen.size() > 1000 && older.hasNext()) if (!currentIds.contains(older.next())) older.remove();
        String accountTag = "social:" + response.userId + ":";
        for (StatusBarNotification notification : manager().getActiveNotifications())
            if (notification.getTag() != null && notification.getTag().startsWith(accountTag)
                    && !currentIds.contains(notification.getTag().substring(accountTag.length()))) manager().cancel(notification.getTag(), notification.getId());
        prefs.edit().putStringSet(key, seen).putString("account", response.userId).apply();
        if (!enabled() || !response.notificationsEnabled) cancelSocialNotifications();
        publish(new State(true, response.name, response.unread, response.notificationsEnabled,
                response.name + (response.unread > 0 ? " · непрочитанных: " + response.unread : " · всё прочитано")));
    }
    private void show(String user, SocialPolicy.Event event) {
        Intent intent = new Intent(context, OnlineActivity.class).setData(android.net.Uri.parse(SocialPolicy.NOTIFICATIONS_PAGE))
                .putExtra("url", SocialPolicy.NOTIFICATIONS_PAGE).putExtra("title", "Уведомления LolzCloud")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent open = PendingIntent.getActivity(context, 741, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = new Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(event.title()).setContentText(event.message()).setStyle(new Notification.BigTextStyle().bigText(event.message()))
                .setCategory(Notification.CATEGORY_SOCIAL).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setWhen(event.createdAt);
        if (event.expiresAt > 0) builder.setTimeoutAfter(Math.max(1, event.expiresAt - System.currentTimeMillis()));
        try { manager().notify(tag(user, event.id), 1, builder.build()); } catch (SecurityException denied) { /* User may revoke permission between check and notify. */ }
    }
    private void publish(State next) {
        state = next;
        for (Listener listener : new ArrayList<>(listeners)) listener.onSocialState(next);
    }
    private void finishRefresh() {
        List<Runnable> ready = new ArrayList<>(completions); completions.clear();
        for (Runnable callback : ready) callback.run();
    }
    private String cookie() {
        try { return SocialPolicy.sessionCookie(CookieManager.getInstance().getCookie(SocialPolicy.ORIGIN + "/")); }
        catch (RuntimeException unavailable) { return ""; }
    }
    private void scheduleIfSignedIn() {
        if (!enabled() || cookie().isEmpty()) return;
        JobScheduler jobs = scheduler();
        if (jobs.getPendingJob(JOB_ID) == null) {
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, SocialNotificationJobService.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60_000L)
                    .setPersisted(true).build();
            jobs.schedule(job);
        }
    }
    private void cancelSocialNotifications() {
        for (StatusBarNotification notification : manager().getActiveNotifications())
            if (CHANNEL.equals(notification.getNotification().getChannelId())) manager().cancel(notification.getTag(), notification.getId());
    }
    private static String tag(String user, String id) { return "social:" + user + ":" + id; }
    private NotificationManager manager() { return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE); }
    private JobScheduler scheduler() { return (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE); }
}
