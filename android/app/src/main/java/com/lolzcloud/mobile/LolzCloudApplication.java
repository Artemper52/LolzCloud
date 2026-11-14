package com.lolzcloud.mobile;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

/** Shared social lifecycle; no WebView frame can call native notification APIs. */
public final class LolzCloudApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        SocialNotifications social = SocialNotifications.get(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(Activity activity) { social.activityStarted(); }
            @Override public void onActivityStopped(Activity activity) { social.activityStopped(); }
            @Override public void onActivityCreated(Activity activity, Bundle state) { }
            @Override public void onActivityResumed(Activity activity) { }
            @Override public void onActivityPaused(Activity activity) { }
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
            @Override public void onActivityDestroyed(Activity activity) { }
        });
    }
}
