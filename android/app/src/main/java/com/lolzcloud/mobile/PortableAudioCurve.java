package com.lolzcloud.mobile;

/** Log-frequency approximation only: native Equalizer filters are device-specific. */
public final class PortableAudioCurve {
    public static final double[] FREQUENCIES = {60, 230, 910, 3600, 14000};
    private PortableAudioCurve() { }
    public static double at(double[] frequencies, double[] gains, double frequency) {
        if (frequencies == null || gains == null || frequencies.length == 0 || frequencies.length != gains.length
                || !Double.isFinite(frequency) || frequency <= 0) throw new IllegalArgumentException("Invalid EQ curve");
        for (int i = 0; i < frequencies.length; i++) if (!Double.isFinite(frequencies[i]) || frequencies[i] <= 0
                || !Double.isFinite(gains[i]) || i > 0 && frequencies[i] <= frequencies[i - 1]) throw new IllegalArgumentException("Invalid EQ bands");
        if (frequency <= frequencies[0]) return gains[0];
        for (int i = 1; i < frequencies.length; i++) if (frequency <= frequencies[i]) {
            double ratio = Math.log(frequency / frequencies[i - 1]) / Math.log(frequencies[i] / frequencies[i - 1]);
            return gains[i - 1] + ratio * (gains[i] - gains[i - 1]);
        }
        return gains[gains.length - 1];
    }
    public static short nativeLevel(double[] gains, double frequency, short minimum, short maximum) {
        if (gains == null || gains.length != 5 || minimum > maximum) throw new IllegalArgumentException("Invalid portable EQ");
        for (double gain : gains) if (!Double.isFinite(gain) || gain < -12 || gain > 12) throw new IllegalArgumentException("Invalid portable gain");
        return (short) Math.max(minimum, Math.min(maximum, Math.round(at(FREQUENCIES, gains, frequency) * 100)));
    }
}
