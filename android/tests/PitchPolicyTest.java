package com.lolzcloud.mobile;

import java.util.ArrayList;
import java.util.List;

public final class PitchPolicyTest {
    private static final List<String> checks=new ArrayList<>();
    private static void check(boolean actual,String label){if(!actual)throw new AssertionError(label);checks.add(label);}
    private static void near(double actual,double expected,String label){check(Math.abs(actual-expected)<1e-7,label);}
    private static void denied(Runnable test,String label){boolean invalid=false;try{test.run();}catch(IllegalArgumentException expected){invalid=true;}check(invalid,label);}
    public static void main(String[]args){
        PitchPolicy.State fresh=PitchPolicy.fresh();near(fresh.outputRate(),1,"Fresh output rate is neutral");near(fresh.outputPitch(),1,"Fresh output pitch is neutral");check(!fresh.active(),"Fresh optional enable flags default false");
        PitchPolicy.State disabled=new PitchPolicy.State(1.6,.75,true,false,false);near(disabled.outputRate(),1,"Disabled common profile cannot apply its latent rate");near(disabled.outputPitch(),1,"Disabled common profile cannot apply its latent independent tone");near(disabled.pitch,.75,"Disabled desired pitch is retained");
        PitchPolicy.State nativeOnly=new PitchPolicy.State(1.2,.8,true,false,true);near(nativeOnly.outputRate(),1.2,"Transport flag applies tempo with EQ disabled");near(nativeOnly.outputPitch(),.8,"Transport flag applies absolute independent pitch with EQ disabled");check(!nativeOnly.effectsEnabled,"Native transport does not turn on EQ/effects");
        PitchPolicy.State fxOnly=new PitchPolicy.State(.85,1.1,true,true,false);near(fxOnly.outputRate(),.85,"Legacy common FX enabled also activates tempo");near(fxOnly.outputPitch(),1.1,"Common FX enabled honors independent tone");
        PitchPolicy.State varispeed=nativeOnly.preserving(false);near(varispeed.outputPitch(),1.2,"Disabled preserve mode uses rate as actual pitch");near(varispeed.pitch,.8,"Varispeed keeps the independent value for a later toggle");near(varispeed.withRate(.65).outputPitch(),.65,"Varispeed follows later tempo edits");near(varispeed.preserving(true).outputPitch(),.8,"Preserve re-enable restores the remembered independent value");
        PitchPolicy.State edited=fresh.withPitch(1.4);check(edited.preservesPitch&&edited.transportEnabled&&!edited.effectsEnabled,"Tone edit enables only independent transport");near(edited.withRate(.7).outputPitch(),1.4,"Independent tone stays absolute across tempo edits");near(edited.withRate(.7).outputRate(),.7,"Independent tempo still changes");
        PitchPolicy.State old=PitchPolicy.migrateLocal(1.2,.9,false);near(old.outputRate(),1.2,"Legacy local tempo is preserved at migration");near(old.outputPitch(),.9,"Legacy local absolute tone is preserved at migration");near(old.withRate(.8).outputPitch(),.9,"Migration keeps old tempo-edit behavior");
        PitchPolicy.State equal=PitchPolicy.migrateLocal(1.2,1.2,false);check(equal.preservesPitch,"Equal legacy values still migrate to independent mode");near(equal.withRate(.6).outputPitch(),1.2,"Equal legacy tone does not unexpectedly follow the next tempo edit");
        near(PitchPolicy.migrateLocal(Double.NaN,Double.POSITIVE_INFINITY,false).outputPitch(),1,"Corrupt legacy pitch falls back to neutral");near(PitchPolicy.migrateLocal(.1,9,false).outputRate(),.5,"Old finite rate is bounded safely");near(PitchPolicy.migrateLocal(.1,9,false).outputPitch(),2,"Old finite pitch is bounded safely");
        near(new PitchPolicy.State(1.5,.7,false,false,false).effects(true).outputPitch(),1.5,"FX activation uses the shared transport gate without forgetting desired pitch");near(new PitchPolicy.State(1.5,.7,true,true,false).effects(false).outputRate(),1,"Disabling the only active common gate bypasses tempo");
        for(double invalid:new double[]{Double.NaN,Double.POSITIVE_INFINITY,Double.NEGATIVE_INFINITY,.499,2.001,0}){denied(()->new PitchPolicy.State(1,invalid,true,false,true),"Reject invalid portable pitch "+checks.size());denied(()->new PitchPolicy.State(invalid,1,true,false,true),"Reject invalid portable rate "+checks.size());}
        near(new PitchPolicy.State(.5,2,true,false,true).outputPitch(),2,"Upper tone bound is independent at the lower tempo bound");near(new PitchPolicy.State(2,.5,true,false,true).outputPitch(),.5,"Lower tone bound is independent at the upper tempo bound");
        StringBuilder json=new StringBuilder("{\"status\":\"passed\",\"checks\":[");for(int i=0;i<checks.size();i++){if(i>0)json.append(',');json.append('"').append(checks.get(i)).append('"');}System.out.println(json.append("]}"));
    }
}
