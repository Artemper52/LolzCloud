package com.lolzcloud.mobile;

/** Streaming PCM processing. Own implementation; no media leaves the device. */
public final class PcmDsp {
    public static final class Config {
        public final long revision;public final boolean enabled,normalization;public final double[] gains;public final double preampDb,echo,reverb;
        public Config(long revision,boolean enabled,double[] gains,double preampDb,double echo,double reverb,boolean normalization){
            if(revision<1||gains==null||gains.length!=5||!finite(preampDb,-12,0)||!finite(echo,0,.8)||!finite(reverb,0,.8))throw new IllegalArgumentException("Invalid PCM configuration");
            for(double gain:gains)if(!finite(gain,-12,12))throw new IllegalArgumentException("Invalid PCM gain");
            this.revision=revision;this.enabled=enabled;this.gains=gains.clone();this.preampDb=preampDb;this.echo=echo;this.reverb=reverb;this.normalization=normalization;
        }
        public boolean processing(){return enabled||normalization;}
        private static boolean finite(double value,double min,double max){return Double.isFinite(value)&&value>=min&&value<=max;}
    }
    private static final class Filter {
        final double b0,b1,b2,a1,a2;double z1,z2;
        Filter(double b0,double b1,double b2,double a0,double a1,double a2){this.b0=b0/a0;this.b1=b1/a0;this.b2=b2/a0;this.a1=a1/a0;this.a2=a2/a0;}
        double sample(double input){double out=b0*input+z1;z1=b1*input-a1*out+z2;z2=b2*input-a2*out;return out;}
    }
    private static final class Comb {
        final double[] delay;int at;double damped;
        Comb(int length){delay=new double[Math.max(1,length)];}
        void clear(){java.util.Arrays.fill(delay,0);at=0;damped=0;}
        double sample(double value){double out=delay[at];damped=out*.8+damped*.2;delay[at]=value+damped*.78;if(++at==delay.length)at=0;return out;}
    }
    private static final class Allpass {
        final double[] delay;int at;Allpass(int length){delay=new double[Math.max(1,length)];}
        void clear(){java.util.Arrays.fill(delay,0);at=0;}
        double sample(double value){double delayed=delay[at],out=delayed-value;delay[at]=value+delayed*.5;if(++at==delay.length)at=0;return out;}
    }
    public final int sampleRate,channels;
    private Config config;private Filter[][] equalizer,kWeight;private double[][] echo;private int echoAt;
    private Comb[][] comb;private Allpass[][] diffusion;private double normalizationDb,targetDb,energy,loudness=Double.NaN,limiterGain=1;
    private long blockFrames,totalFrames;private final double[] blocks=new double[1500];private int blockCount,blockAt;
    private double headroom,dry,wet,echoWet,echoFeedback;private final double limiterRelease;private final double[] frame=new double[2];
    public PcmDsp(int sampleRate,int channels,Config config){
        if(sampleRate<8000||sampleRate>192000||channels<1||channels>2)throw new IllegalArgumentException("Only mono/stereo PCM 8–192kHz is supported");
        this.sampleRate=sampleRate;this.channels=channels;limiterRelease=Math.exp(-1d/(sampleRate*.1));reset(config);
    }
    public Config config(){return config;}
    public void configure(Config value){configure(value,false);}
    public void reset(Config value){configure(value,true);}
    /** Revisions clear effect history; only source/seek or normalizer changes reset loudness. */
    private void configure(Config value,boolean discontinuity){
        boolean keepLoudness=!discontinuity&&config!=null&&config.normalization&&value.normalization;
        config=value;equalizer=new Filter[channels][5];if(!keepLoudness)kWeight=new Filter[channels][2];
        if(echo==null)echo=new double[channels][Math.max(1,(int)Math.round(sampleRate*.28))];else for(double[] line:echo)java.util.Arrays.fill(line,0);echoAt=0;
        if(comb==null)comb=new Comb[channels][4];if(diffusion==null)diffusion=new Allpass[channels][2];double[] delays={.0297,.0371,.0411,.0437};
        for(int channel=0;channel<channels;channel++){
            for(int band=0;band<5;band++)equalizer[channel][band]=eq(sampleRate,Math.min(PortableAudioCurve.FREQUENCIES[band],sampleRate*.49),value.gains[band],band);
            if(!keepLoudness){kWeight[channel][0]=kShelf(sampleRate);kWeight[channel][1]=kHighpass(sampleRate);}
            for(int i=0;i<4;i++)if(comb[channel][i]==null)comb[channel][i]=new Comb((int)Math.round((delays[i]+channel*.0007)*sampleRate));else comb[channel][i].clear();
            if(diffusion[channel][0]==null)diffusion[channel][0]=new Allpass((int)Math.round(sampleRate*.005));else diffusion[channel][0].clear();if(diffusion[channel][1]==null)diffusion[channel][1]=new Allpass((int)Math.round(sampleRate*.0017));else diffusion[channel][1].clear();
        }
        double maximum=0;for(double gain:value.gains)maximum=Math.max(maximum,gain);
        headroom=Math.pow(10,(value.preampDb-maximum)/20);dry=Math.cos(value.reverb*Math.PI/2);wet=Math.sin(value.reverb*Math.PI/2)*.7;echoWet=value.echo*.6;echoFeedback=value.echo*.55;
        if(!keepLoudness){normalizationDb=targetDb=energy=0;blockFrames=totalFrames=0;blockCount=blockAt=0;loudness=Double.NaN;}limiterGain=1;
    }
    public double normalizationDb(){return normalizationDb;}public double targetDb(){return targetDb;}public double loudness(){return loudness;}public boolean measured(){return blockCount>=8;}
    public double reductionDb(){return -20*Math.log10(Math.max(limiterGain,1e-9));}
    public int tailFrames(){return config.enabled&&(config.reverb>0||config.echo>0)?(int)Math.round(sampleRate*1.5):0;}
    public void process(float[] input,float[] output,int frames){
        if(frames<0||input.length<frames*channels||output.length<frames*channels)throw new IllegalArgumentException("Invalid PCM block");
        if(!config.processing()){System.arraycopy(input,0,output,0,frames*channels);return;}
        final double ceiling=Math.pow(10,-3d/20);
        for(int index=0;index<frames;index++){
            if(config.normalization){double maximumStep=1d/sampleRate;normalizationDb+=Math.max(-maximumStep,Math.min(maximumStep,targetDb-normalizationDb));}
            double normalGain=config.normalization?Math.pow(10,normalizationDb/20):1,peak=0;
            for(int channel=0;channel<channels;channel++){
                double raw=input[index*channels+channel];if(!Double.isFinite(raw))raw=0;
                if(config.normalization){double weighted=kWeight[channel][1].sample(kWeight[channel][0].sample(raw));energy+=weighted*weighted;}
                double value=raw*normalGain;
                if(config.enabled){
                    for(Filter filter:equalizer[channel])value=filter.sample(value);value*=headroom;
                    double reflected=0;for(Comb filter:comb[channel])reflected+=filter.sample(value);reflected*=.25;for(Allpass filter:diffusion[channel])reflected=filter.sample(reflected);
                    double delayed=echo[channel][echoAt];echo[channel][echoAt]=value+delayed*echoFeedback;
                    value=value*dry+reflected*wet+delayed*echoWet;
                }
                frame[channel]=Double.isFinite(value)?value:0;peak=Math.max(peak,Math.abs(frame[channel]));
            }
            if(config.enabled&&++echoAt==echo[0].length)echoAt=0;
            double wanted=peak>ceiling?ceiling/peak:1;limiterGain=wanted<limiterGain?wanted:1-(1-limiterGain)*limiterRelease;
            for(int channel=0;channel<channels;channel++)output[index*channels+channel]=(float)Math.max(-ceiling,Math.min(ceiling,frame[channel]*limiterGain));
            if(config.normalization){blockFrames++;totalFrames++;if(blockFrames>=Math.round(sampleRate*.4))integrate();}
        }
    }
    private void integrate(){
        double average=energy/blockFrames,at=-.691+10*Math.log10(Math.max(average,1e-12));
        if(at>-70){blocks[blockAt]=average;blockAt=(blockAt+1)%blocks.length;blockCount=Math.min(blocks.length,blockCount+1);double mean=0;for(int i=0;i<blockCount;i++)mean+=blocks[i];mean/=blockCount;double gated=0;int count=0;for(int i=0;i<blockCount;i++)if(blocks[i]>=mean/10){gated+=blocks[i];count++;}loudness=-.691+10*Math.log10(Math.max(1e-12,gated/Math.max(1,count)));if(totalFrames>=sampleRate*3L)targetDb=Math.max(-8,Math.min(8,-14-loudness));}
        energy=0;blockFrames=0;
    }
    private static Filter eq(int rate,double frequency,double gain,int band){
        double w=2*Math.PI*frequency/rate,c=Math.cos(w),s=Math.sin(w),a=Math.pow(10,gain/40),alpha=s/2*Math.sqrt(2),beta=2*Math.sqrt(a)*alpha;
        if(band==0)return new Filter(a*((a+1)-(a-1)*c+beta),2*a*((a-1)-(a+1)*c),a*((a+1)-(a-1)*c-beta),(a+1)+(a-1)*c+beta,-2*((a-1)+(a+1)*c),(a+1)+(a-1)*c-beta);
        if(band==4)return new Filter(a*((a+1)+(a-1)*c+beta),-2*a*((a-1)+(a+1)*c),a*((a+1)+(a-1)*c-beta),(a+1)-(a-1)*c+beta,2*((a-1)-(a+1)*c),(a+1)-(a-1)*c-beta);
        alpha=s/2;return new Filter(1+alpha*a,-2*c,1-alpha*a,1+alpha/a,-2*c,1-alpha/a);
    }
    private static Filter kShelf(int rate){double k=Math.tan(Math.PI*1681.974450955533/rate),q=.7071752369554196,vh=Math.pow(10,3.999843853973347/20),vb=Math.pow(vh,.4996667741545416),a0=1+k/q+k*k;return new Filter(vh+vb*k/q+k*k,2*(k*k-vh),vh-vb*k/q+k*k,a0,2*(k*k-1),1-k/q+k*k);}
    private static Filter kHighpass(int rate){double k=Math.tan(Math.PI*38.13547087602444/rate),q=.5003270373238773,a0=1+k/q+k*k;return new Filter(a0,-2*a0,a0,a0,2*(k*k-1),1-k/q+k*k);}

    /** Only the real render path calls accepted(), after AudioTrack.write returned a positive count. */
    public static final class Meter {
        public long revision,acceptedFrames,steadyFrames,silentSamples;public double inputEnergy,outputEnergy,steadyInputEnergy,steadyOutputEnergy,peak,silentOutputEnergy;
        public final double[] outputBuckets=new double[40];private int channels,rate;
        public void reset(long revision,int rate,int channels){this.revision=revision;this.rate=rate;this.channels=channels;acceptedFrames=steadyFrames=silentSamples=0;inputEnergy=outputEnergy=steadyInputEnergy=steadyOutputEnergy=peak=silentOutputEnergy=0;java.util.Arrays.fill(outputBuckets,0);}
        public void accepted(float[] input,float[] output,int offset,int samples){
            for(int sample=offset;sample<offset+samples;sample++){
                double in=input[sample],out=output[sample];inputEnergy+=in*in;outputEnergy+=out*out;peak=Math.max(peak,Math.abs(out));
                long frame=acceptedFrames+(sample-offset)/channels;int bucket=(int)(frame/(rate/10));if(bucket<outputBuckets.length)outputBuckets[bucket]+=out*out;
                if(frame>=rate/4){steadyInputEnergy+=in*in;steadyOutputEnergy+=out*out;}
                if(Math.abs(in)<1e-8){silentSamples++;silentOutputEnergy+=out*out;}
            }
            long frames=samples/channels,previous=acceptedFrames;acceptedFrames+=frames;steadyFrames+=Math.max(0,acceptedFrames-Math.max(previous,rate/4));
        }
    }
}
