package com.lolzcloud.mobile;

public final class SleepTimerPolicyTest {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    public static void main(String[] args) {
        long wall = 1_800_000_000_000L, elapsed = 1000;
        SleepTimerPolicy.Deadline first = SleepTimerPolicy.minutes(15, wall, elapsed);
        check(first.wall == wall + 900000 && first.elapsed == elapsed + 900000, "One selection has both wall and monotonic deadlines");
        SleepTimerPolicy.Deadline resumed = SleepTimerPolicy.restore(first.wall, wall + 10000, 200);
        check(resumed.wall == first.wall && resumed.elapsed == 890200, "A recreated process preserves the remaining deadline, not the old monotonic clock");
        check(SleepTimerPolicy.restore(first.wall, first.wall, 200).elapsed == 0, "An already elapsed timer restores disabled");
        check(SleepTimerPolicy.restore(first.wall, first.wall + 1, 200).wall == 0, "A past deadline is not rearmed");
        check(SleepTimerPolicy.minutes(0, wall, elapsed).wall == 0, "Explicit cancel removes the deadline");
        check(SleepTimerPolicy.minutes(-1, wall, elapsed).wall == 0, "Negative selection cancels");
        check(SleepTimerPolicy.minutes(Integer.MAX_VALUE, wall, elapsed).wall == wall + SleepTimerPolicy.MAX_MILLIS, "Public service requests are bounded to a day");
        check(SleepTimerPolicy.restore(wall + SleepTimerPolicy.MAX_MILLIS + 1, wall, elapsed).wall == 0, "An invalid far-future saved value is rejected");
        check(SleepTimerPolicy.restore(Long.MAX_VALUE, wall, elapsed).wall == 0, "Corrupt long deadline cannot become an endless timer");
        check(SleepTimerPolicy.minutes(60, Long.MAX_VALUE - 10, elapsed).wall == 0, "Wall-clock addition cannot overflow");
        check(SleepTimerPolicy.restore(wall + 1000, wall, Long.MAX_VALUE - 10).elapsed == 0, "Monotonic addition cannot overflow");
        check(SleepTimerPolicy.restore(wall + 1000, wall, -1).wall == 0, "Invalid monotonic clock is rejected");
        check(SleepTimerPolicy.minutesRemaining(15 * 60000) == 15, "An exact fifteen-minute selection does not briefly display sixteen");
        check(SleepTimerPolicy.minutesRemaining(60001) == 2 && SleepTimerPolicy.minutesRemaining(0) == 0, "Remaining UI minutes round upward and clear at expiry");
        System.out.println(checks + " sleep timer behavior checks passed");
    }
}
