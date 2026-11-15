package com.lolzcloud.mobile;

/** Desired portable transport and its audible native tuple. Independent of the Android FX engine. */
public final class PitchPolicy {
    public static final int SCHEMA=1;
    public static final String SCHEMA_KEY="native_transport_schema",RATE_KEY="native_transport_rate",
            PITCH_KEY="native_independent_pitch",PRESERVES_KEY="native_preserves_pitch",ENABLED_KEY="native_transport_enabled";
    private PitchPolicy() { }

    public static final class State {
        public final double rate,pitch;
        public final boolean preservesPitch,effectsEnabled,transportEnabled;
        public State(double rate,double pitch,boolean preservesPitch,boolean effectsEnabled,boolean transportEnabled){
            requireRatio(rate);requireRatio(pitch);this.rate=rate;this.pitch=pitch;this.preservesPitch=preservesPitch;this.effectsEnabled=effectsEnabled;this.transportEnabled=transportEnabled;
        }
        public boolean active(){return effectsEnabled||transportEnabled;}
        public double outputRate(){return active()?rate:1;}
        public double outputPitch(){return active()?(preservesPitch?pitch:rate):1;}
        public State withRate(double value){return new State(value,pitch,preservesPitch,effectsEnabled,true);}
        public State withPitch(double value){return new State(rate,value,true,effectsEnabled,true);}
        public State preserving(boolean value){return new State(rate,pitch,value,effectsEnabled,true);}
        public State effects(boolean value){return new State(rate,pitch,preservesPitch,value,transportEnabled);}
    }

    public static State fresh(){return new State(1,1,false,false,false);}
    /** Older Android speed edits kept absolute pitch, including when pitch happened to equal speed. */
    public static State migrateLocal(double rate,double actualPitch,boolean effectsEnabled){
        return new State(storedRatio(rate),storedRatio(actualPitch),true,effectsEnabled,true);
    }
    public static double storedRatio(double value){return Double.isFinite(value)?Math.max(.5,Math.min(2,value)):1;}
    public static void requireRatio(double value){if(!Double.isFinite(value)||value<.5||value>2)throw new IllegalArgumentException("Скорость и тон должны быть от 0.5× до 2×");}
}
