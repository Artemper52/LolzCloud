package com.lolzcloud.mobile;

import java.io.IOException;
import java.io.InterruptedIOException;

/** Deterministic time/probe checks: no Android, real network or waiting is needed. */
public final class AudioPreparationPolicyTest {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    private static final class Clock implements AudioPreparation.Timing {
        long now, lastSleep;
        @Override public long nowMillis() { return now; }
        @Override public void sleep(long millis) { lastSleep = millis; now += millis; }
    }
    public static void main(String[] args) throws Exception {
        Clock cold = new Clock(); final int[] polls = {0};
        AudioPreparation.await(timeout -> {
            check(timeout <= 10_000 && timeout > 0, "Each cold request has a bounded transport deadline");
            return new AudioPreparation.Reply(++polls[0] == 26, 1000);
        }, cold);
        check(cold.now == 25_000 && polls[0] == 26, "Cold preparation longer than the old 20-second header timeout succeeds");

        Clock endless = new Clock(); final int[] calls = {0}; boolean expired = false;
        try {
            AudioPreparation.await(timeout -> { calls[0]++; return new AudioPreparation.Reply(false, 1000); }, endless);
        } catch (IOException expected) { expired = expected.getMessage().contains("Повторить"); }
        check(expired && endless.now == 125_000 && calls[0] == 125, "An endlessly preparing server stops at 125 seconds with an actionable error");

        Clock backoff = new Clock(); final int[] delayed = {0};
        AudioPreparation.await(timeout -> new AudioPreparation.Reply(++delayed[0] == 2, Long.MAX_VALUE), backoff);
        check(backoff.lastSleep == 2500, "A server cannot request an unbounded polling sleep");
        Clock fast = new Clock(); final int[] fastCalls = {0};
        AudioPreparation.await(timeout -> new AudioPreparation.Reply(++fastCalls[0] == 2, -10), fast);
        check(fast.lastSleep == 500, "Malformed backoff cannot cause a busy loop");

        final int[] failures = {0}; boolean preserved = false;
        try { AudioPreparation.await(timeout -> { failures[0]++; throw new IOException("Источник не отдал поддерживаемый полный поток"); }, new Clock()); }
        catch (IOException expected) { preserved = expected.getMessage().contains("поддерживаемый полный поток"); }
        check(preserved && failures[0] == 1, "A confirmed unsupported source is surfaced without blind retry or error rewriting");

        Clock late = new Clock(); boolean lateRejected = false;
        try { AudioPreparation.await(timeout -> { late.now = 125_001; return new AudioPreparation.Reply(true, 0); }, late); }
        catch (IOException expected) { lateRejected = true; }
        check(lateRejected, "A late ready response cannot bypass the total preparation budget");

        final int[] cancelledCalls = {0}; boolean cancelled = false;
        Thread.currentThread().interrupt();
        try { AudioPreparation.await(timeout -> { cancelledCalls[0]++; return new AudioPreparation.Reply(true, 0); }, new Clock()); }
        catch (InterruptedIOException expected) { cancelled = true; }
        finally { Thread.interrupted(); }
        check(cancelled && cancelledCalls[0] == 0, "Cancellation before a request does not touch the service");

        boolean sleepCancelled = false;
        try {
            AudioPreparation.await(timeout -> new AudioPreparation.Reply(false, 1000), new AudioPreparation.Timing() {
                @Override public long nowMillis() { return 0; }
                @Override public void sleep(long millis) throws InterruptedException { throw new InterruptedException(); }
            });
        } catch (InterruptedIOException expected) { sleepCancelled = Thread.currentThread().isInterrupted(); }
        finally { Thread.interrupted(); }
        check(sleepCancelled, "Cancellation during backoff preserves the worker interruption");
        System.out.println("PASS: " + checks + " audio preparation deadline/cancellation checks");
    }
}
