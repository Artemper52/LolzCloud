package com.lolzcloud.mobile;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Android schedules this opportunistically; it is not instant push delivery. */
public final class SocialNotificationJobService extends JobService {
    private JobParameters active;
    @Override public boolean onStartJob(JobParameters parameters) {
        active = parameters;
        SocialNotifications.get(this).refresh(() -> {
            if (active == parameters) { active = null; jobFinished(parameters, false); }
        });
        return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) { active = null; return true; }
}
