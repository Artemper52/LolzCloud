package com.lolzcloud.mobile;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Device readback is separate from the user's saved request. No Android dependency. */
final class AudioEffectsPolicy {
    interface BassDriver {
        boolean hasControl();
        boolean strengthSupported();
        int roundedStrength();
        boolean enabled();
        void strength(int value);
        boolean enable(boolean enabled);
    }

    static final class BassState {
        final boolean available, controllable, adjustable, enabled;
        final int strength;
        BassState(boolean available, boolean controllable, boolean adjustable, boolean enabled, int strength) {
            this.available = available; this.controllable = controllable; this.adjustable = adjustable;
            this.enabled = enabled; this.strength = strength;
        }
        boolean editable() { return available && controllable; }
    }

    private AudioEffectsPolicy() { }
    static int bassRequest(int value) { return Math.max(0, Math.min(1000, value)); }

    static BassState readBass(BassDriver driver) {
        if (driver != null) try {
            boolean control = driver.hasControl(), adjustable = driver.strengthSupported(), enabled = driver.enabled();
            int strength = driver.roundedStrength();
            if (strength < 0 || strength > 1000) throw new IllegalStateException("Invalid effect readback");
            return new BassState(true, control, adjustable, enabled, enabled ? strength : 0);
        } catch (RuntimeException unavailable) { /* Unsupported/released effects never appear applied. */ }
        return new BassState(false, false, false, false, 0);
    }

    static boolean applyBass(BassDriver driver, int request) {
        BassState before = readBass(driver);
        if (!before.editable()) return false;
        int value = bassRequest(request);
        try {
            // A fixed-strength engine supports a switch, not a fictitious slider.
            if (before.adjustable) driver.strength(value);
            if (!driver.enable(value > 0)) return false;
            BassState after = readBass(driver);
            return after.editable() && after.enabled == (value > 0);
        } catch (RuntimeException unavailable) { return false; }
    }

    /** Reset must clear old device bands even when no audio session exists. */
    static List<String> storedEqBands(Set<String> keys) {
        List<String> result = new ArrayList<>();
        for (String key : keys) if (key.matches("eq_[0-9]+")) result.add(key);
        return result;
    }
}
