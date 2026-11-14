package com.lolzcloud.mobile;

import java.io.IOException;
import java.io.InterruptedIOException;

/** Bounded polling for the app-owned MP3 preparation endpoint; never touches playback state. */
final class AudioPreparation {
    static final long BUDGET_MS = 125_000;
    static final int REQUEST_MS = 10_000;

    interface Probe { Reply request(int timeoutMillis) throws IOException; }
    interface Timing {
        long nowMillis();
        void sleep(long millis) throws InterruptedException;
    }
    static final class Reply {
        final boolean ready;
        final long retryAfterMillis;
        Reply(boolean ready, long retryAfterMillis) {
            this.ready = ready; this.retryAfterMillis = retryAfterMillis;
        }
    }
    static final Timing SYSTEM = new Timing() {
        @Override public long nowMillis() { return System.nanoTime() / 1_000_000L; }
        @Override public void sleep(long millis) throws InterruptedException { Thread.sleep(millis); }
    };

    static void await(Probe probe, Timing timing) throws IOException {
        long deadline = timing.nowMillis() + BUDGET_MS;
        for (;;) {
            cancelled();
            long remaining = deadline - timing.nowMillis();
            if (remaining <= 0) throw timeout();
            Reply reply = probe.request((int) Math.min(REQUEST_MS, remaining));
            cancelled();
            if (timing.nowMillis() >= deadline) throw timeout();
            if (reply.ready) return;
            long delay = Math.max(500, Math.min(2500, reply.retryAfterMillis));
            remaining = deadline - timing.nowMillis();
            try { timing.sleep(Math.min(delay, remaining)); }
            catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new InterruptedIOException("Подготовка трека отменена");
            }
        }
    }
    private static void cancelled() throws InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Подготовка трека отменена");
    }
    private static IOException timeout() {
        return new IOException("Подготовка трека заняла слишком много времени. Нажми «Повторить»");
    }
    private AudioPreparation() { }
}
