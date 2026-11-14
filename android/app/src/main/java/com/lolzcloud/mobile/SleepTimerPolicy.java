package com.lolzcloud.mobile;

/** Persist a bounded wall-clock deadline; use monotonic time while the process lives. */
final class SleepTimerPolicy {
    static final long MAX_MILLIS = 24 * 60 * 60_000L;
    static final class Deadline {
        final long wall, elapsed;
        Deadline(long wall, long elapsed) { this.wall = wall; this.elapsed = elapsed; }
    }
    private SleepTimerPolicy() { }
    static int minutesRemaining(long millis) { return (int) ((Math.max(0, Math.min(MAX_MILLIS, millis)) + 59_999) / 60_000); }
    static Deadline restore(long wallDeadline, long wallNow, long elapsedNow) {
        if (wallNow < 0 || elapsedNow < 0 || wallDeadline <= wallNow) return new Deadline(0, 0);
        long remaining = wallDeadline - wallNow;
        if (remaining > MAX_MILLIS || elapsedNow > Long.MAX_VALUE - remaining) return new Deadline(0, 0);
        return new Deadline(wallDeadline, elapsedNow + remaining);
    }
    static Deadline minutes(int minutes, long wallNow, long elapsedNow) {
        long duration = Math.max(0, Math.min(24 * 60, minutes)) * 60_000L;
        if (duration == 0 || wallNow < 0 || wallNow > Long.MAX_VALUE - duration) return new Deadline(0, 0);
        return restore(wallNow + duration, wallNow, elapsedNow);
    }
}
