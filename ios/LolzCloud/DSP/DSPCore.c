#include "include/LCDSPCore.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Realtime parameter words must be lock-free");
_Static_assert(ATOMIC_LLONG_LOCK_FREE == 2, "Realtime counters must be lock-free");
enum { BANDS=5, COEFFICIENTS=5, COMBS=4, ALLPASSES=2, LOUDNESS_BLOCKS=1500, ENERGY_WINDOWS=256 };
typedef struct { int enabled,normalization; float gains[BANDS],preamp,reverb,echo; uint32_t revision; } Settings;
/* Epoch tags make seek/disable resets O(1), without clearing delay memory on
   the audio thread. All storage is allocated in prepare, freed in unprepare. */
typedef struct { float *samples; uint64_t *tags,epoch; uint32_t length,position; double damping; } Delay;
struct LCDSPCore {
    atomic_uint references, sequence, enabled, gains[BANDS], preamp, reverb, echo, normalization, revision;
    atomic_uint prepared, unavailable, rate, channels, bandMask, appliedRevision;
    atomic_uint inputRMS, outputRMS, headroom;
    atomic_uint normMeasured,normFrames,loudness,normGain,normTarget,peak,reduction,windowFrames;
    atomic_uint windowInput[ENERGY_WINDOWS],windowOutput[ENERGY_WINDOWS],windowCount[ENERGY_WINDOWS];
    atomic_ullong frames;
    /* Only prepare/process/unprepare touch render state; Apple serializes it. */
    Settings current;
    double sampleRate, coefficients[BANDS][COEFFICIENTS], target[BANDS][COEFFICIENTS];
    double steps[BANDS][COEFFICIENTS], history[2][BANDS][2];
    double gain, targetGain, gainStep, wet, targetWet, wetStep;
    double reverbAmount,targetReverb,reverbStep,echoAmount,targetEcho,echoStep;
    double reverbDry,reverbWet;
    Delay echoDelay[2],comb[2][COMBS],allpass[2][ALLPASSES];
    double combFeedback[2][COMBS];
    double kCoefficients[2][COEFFICIENTS],kHistory[2][2][2];
    double blockEnergy,loudnessEnergy[LOUDNESS_BLOCKS],loudnessDb,normGainDb,normTargetDb,normLinear,normUp,normDown,normOffUp,normOffDown;
    uint32_t blockFrames,loudnessCount,loudnessPosition,normalizationBlockFrames;
    uint64_t normalizationFrames;
    double limiterGain,limiterRelease,maximumPeak,minimumLimiterGain;
    double windowInputEnergy[ENERGY_WINDOWS],windowOutputEnergy[ENERGY_WINDOWS];
    uint32_t windowSampleCount[ENERGY_WINDOWS],meterWindowFrames;
    uint64_t meterFrames;
    double inputEnergy, outputEnergy;
    uint64_t energySamples;
    uint32_t maximumFrames, renderChannels, rampRemaining;
};
static uint32_t bits(float value){uint32_t result;memcpy(&result,&value,sizeof result);return result;}
static float number(uint32_t value){float result;memcpy(&result,&value,sizeof result);return result;}
static double finite_sample(double value){return isfinite(value)?value:0;}
static void identity(double c[COEFFICIENTS]){c[0]=1;c[1]=c[2]=c[3]=c[4]=0;}
static void reset_energy(LCDSPCore *s){
    s->inputEnergy=s->outputEnergy=0;s->energySamples=0;s->meterFrames=0;s->maximumPeak=0;s->minimumLimiterGain=1;
    atomic_store(&s->inputRMS,bits(0));atomic_store(&s->outputRMS,bits(0));atomic_store(&s->peak,bits(-120));atomic_store(&s->reduction,bits(0));
    /* A fixed small diagnostic array, independent of sample rate/delay length. */
    for(unsigned i=0;i<ENERGY_WINDOWS;i++){
        s->windowInputEnergy[i]=s->windowOutputEnergy[i]=0;s->windowSampleCount[i]=0;
        atomic_store(&s->windowInput[i],bits(0));atomic_store(&s->windowOutput[i],bits(0));atomic_store(&s->windowCount[i],0);
    }
}
static int read_settings(LCDSPCore *s,Settings *out){
    /* Atomic words prevent a C data race. SC ordering makes the sequence check
       a coherent bounded snapshot. A preempted producer cannot stall audio. */
    for(unsigned attempt=0;attempt<3;attempt++){
        unsigned before=atomic_load(&s->sequence);if(before&1)continue;
        Settings next;next.enabled=(int)atomic_load(&s->enabled);
        for(unsigned b=0;b<BANDS;b++)next.gains[b]=number(atomic_load(&s->gains[b]));
        next.preamp=number(atomic_load(&s->preamp));next.reverb=number(atomic_load(&s->reverb));next.echo=number(atomic_load(&s->echo));
        next.normalization=(int)atomic_load(&s->normalization);next.revision=atomic_load(&s->revision);
        unsigned after=atomic_load(&s->sequence);
        if(before==after&&!(after&1)){*out=next;return 1;}
    }
    return 0;
}
static void delay_free(Delay *d){free(d->samples);free(d->tags);memset(d,0,sizeof *d);}
static int delay_prepare(Delay *d,uint32_t length){
    delay_free(d);d->samples=calloc(length,sizeof(float));d->tags=calloc(length,sizeof(uint64_t));
    if(!d->samples||!d->tags){delay_free(d);return 0;}d->length=length;d->epoch=1;return 1;
}
static void delay_reset(Delay *d){d->position=0;d->damping=0;d->epoch++;if(!d->epoch)d->epoch=1;}
static double delay_read(const Delay *d){return d->length&&d->tags[d->position]==d->epoch?d->samples[d->position]:0;}
static void delay_write(Delay *d,double value){
    /* Bound feedback state as well as output, including malicious nonfinite PCM. */
    d->samples[d->position]=(float)fmax(-16,fmin(16,finite_sample(value)));d->tags[d->position]=d->epoch;
    if(++d->position==d->length)d->position=0;
}
static void delays_free(LCDSPCore *s){for(unsigned ch=0;ch<2;ch++){delay_free(&s->echoDelay[ch]);for(unsigned i=0;i<COMBS;i++)delay_free(&s->comb[ch][i]);for(unsigned i=0;i<ALLPASSES;i++)delay_free(&s->allpass[ch][i]);}}
static void echo_reset(LCDSPCore *s){for(unsigned ch=0;ch<2;ch++)delay_reset(&s->echoDelay[ch]);}
static void reverb_reset(LCDSPCore *s){for(unsigned ch=0;ch<2;ch++){for(unsigned i=0;i<COMBS;i++)delay_reset(&s->comb[ch][i]);for(unsigned i=0;i<ALLPASSES;i++)delay_reset(&s->allpass[ch][i]);}}
static void normalization_reset(LCDSPCore *s){
    memset(s->kHistory,0,sizeof s->kHistory);s->blockEnergy=0;s->blockFrames=s->loudnessCount=s->loudnessPosition=0;
    s->normalizationFrames=0;s->loudnessDb=-120;s->normGainDb=s->normTargetDb=0;s->normLinear=1;
    atomic_store(&s->normMeasured,0);atomic_store(&s->normFrames,0);atomic_store(&s->loudness,bits(-120));atomic_store(&s->normGain,bits(0));atomic_store(&s->normTarget,bits(0));
}
LCDSPCore *LCDSPCreate(void){
    LCDSPCore *s=calloc(1,sizeof *s);if(!s)return NULL;
    atomic_init(&s->references,1);atomic_init(&s->sequence,0);atomic_init(&s->enabled,0);
    for(unsigned b=0;b<BANDS;b++)atomic_init(&s->gains[b],bits(0));
    atomic_init(&s->preamp,bits(0));atomic_init(&s->reverb,bits(0));atomic_init(&s->echo,bits(0));atomic_init(&s->normalization,0);atomic_init(&s->revision,1);
    atomic_init(&s->prepared,0);atomic_init(&s->unavailable,0);atomic_init(&s->rate,0);atomic_init(&s->channels,0);
    atomic_init(&s->bandMask,0);atomic_init(&s->appliedRevision,0);atomic_init(&s->frames,0);
    atomic_init(&s->inputRMS,bits(0));atomic_init(&s->outputRMS,bits(0));atomic_init(&s->headroom,bits(0));
    atomic_init(&s->normMeasured,0);atomic_init(&s->normFrames,0);atomic_init(&s->loudness,bits(-120));atomic_init(&s->normGain,bits(0));atomic_init(&s->normTarget,bits(0));
    atomic_init(&s->peak,bits(-120));atomic_init(&s->reduction,bits(0));atomic_init(&s->windowFrames,0);
    for(unsigned i=0;i<ENERGY_WINDOWS;i++){atomic_init(&s->windowInput[i],bits(0));atomic_init(&s->windowOutput[i],bits(0));atomic_init(&s->windowCount[i],0);}
    s->normLinear=s->limiterGain=1;
    s->gain=s->targetGain=1;for(unsigned b=0;b<BANDS;b++)identity(s->coefficients[b]);
    return s;
}
void LCDSPRetain(LCDSPCore *s){if(s)atomic_fetch_add_explicit(&s->references,1,memory_order_relaxed);}
void LCDSPRelease(LCDSPCore *s){if(s&&atomic_fetch_sub_explicit(&s->references,1,memory_order_acq_rel)==1){delays_free(s);free(s);}}
int LCDSPConfigure(LCDSPCore *s,int enabled,const float *gains,size_t count,float preamp,uint32_t revision){
    return LCDSPConfigureAdvanced(s,enabled,gains,count,preamp,0,0,0,revision);
}
int LCDSPConfigureAdvanced(LCDSPCore *s,int enabled,const float *gains,size_t count,float preamp,float reverb,float echo,int normalization,uint32_t revision){
    if(!s||!gains||count!=BANDS||!revision||(enabled!=0&&enabled!=1)||!isfinite(preamp)||preamp < -12||preamp>0||
       !isfinite(reverb)||reverb<0||reverb>0.8f||!isfinite(echo)||echo<0||echo>0.8f||(normalization!=0&&normalization!=1))return 0;
    for(unsigned b=0;b<BANDS;b++)if(!isfinite(gains[b])||gains[b]<-12||gains[b]>12)return 0;
    atomic_fetch_add(&s->sequence,1);
    atomic_store(&s->enabled,(unsigned)enabled);
    for(unsigned b=0;b<BANDS;b++)atomic_store(&s->gains[b],bits(gains[b]));
    atomic_store(&s->preamp,bits(preamp));atomic_store(&s->reverb,bits(reverb));atomic_store(&s->echo,bits(echo));atomic_store(&s->normalization,(unsigned)normalization);atomic_store(&s->revision,revision);
    atomic_fetch_add(&s->sequence,1);return 1;
}
static void coefficients(unsigned band,double hz,double rate,double gain,double out[COEFFICIENTS]){
    if(fabs(gain)<1e-8){identity(out);return;}
    const double pi=3.14159265358979323846,A=pow(10,gain/40),w=2*pi*hz/rate,c=cos(w),sn=sin(w);
    double b0,b1,b2,a0,a1,a2;
    if(band==0||band==BANDS-1){
        double alpha=sn*0.7071067811865475244,t=2*sqrt(A)*alpha;
        if(band==0){b0=A*((A+1)-(A-1)*c+t);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-t);a0=(A+1)+(A-1)*c+t;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-t;}
        else{b0=A*((A+1)+(A-1)*c+t);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-t);a0=(A+1)-(A-1)*c+t;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-t;}
    }else{double alpha=sn/2;b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A;}
    out[0]=b0/a0;out[1]=b1/a0;out[2]=b2/a0;out[3]=a1/a0;out[4]=a2/a0;
}
static void k_coefficients(LCDSPCore *s){
    double k=tan(3.14159265358979323846*1681.974450955533/s->sampleRate),q=.7071752369554196,a0=1+k/q+k*k;
    double vh=pow(10,3.999843853973347/20),vb=pow(vh,.4996667741545416),*c=s->kCoefficients[0];
    c[0]=(vh+vb*k/q+k*k)/a0;c[1]=2*(k*k-vh)/a0;c[2]=(vh-vb*k/q+k*k)/a0;c[3]=2*(k*k-1)/a0;c[4]=(1-k/q+k*k)/a0;
    k=tan(3.14159265358979323846*38.13547087602444/s->sampleRate);q=.5003270373238773;a0=1+k/q+k*k;c=s->kCoefficients[1];
    c[0]=1;c[1]=-2;c[2]=1;c[3]=2*(k*k-1)/a0;c[4]=(1-k/q+k*k)/a0;
}
static double filter(double value,const double c[COEFFICIENTS],double z[2]){
    double out=finite_sample(c[0]*value+z[0]);z[0]=finite_sample(c[1]*value-c[3]*out+z[1]);z[1]=finite_sample(c[2]*value-c[4]*out);return out;
}
static void loudness_block(LCDSPCore *s){
    double energy=s->blockEnergy/s->blockFrames,loudness=-.691+10*log10(fmax(energy,1e-12));
    if(loudness>-70&&isfinite(energy)){
        s->loudnessEnergy[s->loudnessPosition]=energy;if(++s->loudnessPosition==LOUDNESS_BLOCKS)s->loudnessPosition=0;
        if(s->loudnessCount<LOUDNESS_BLOCKS)s->loudnessCount++;
        double sum=0;for(uint32_t i=0;i<s->loudnessCount;i++)sum+=s->loudnessEnergy[i];
        double gate=sum/s->loudnessCount/10;sum=0;uint32_t count=0;
        for(uint32_t i=0;i<s->loudnessCount;i++)if(s->loudnessEnergy[i]>=gate){sum+=s->loudnessEnergy[i];count++;}
        s->loudnessDb=-.691+10*log10(fmax(sum/fmax(1,count),1e-12));
        if(s->normalizationFrames>=s->sampleRate*3)s->normTargetDb=fmax(-8,fmin(8,-14-s->loudnessDb));
    }
    s->blockEnergy=0;s->blockFrames=0;
}
static double normalize_frame(LCDSPCore *s,const double input[2]){
    int enabled=s->current.normalization&&s->current.enabled;
    if(enabled){
        for(uint32_t ch=0;ch<s->renderChannels;ch++){
            double value=fmax(-1e6,fmin(1e6,input[ch]));
            value=filter(filter(value,s->kCoefficients[0],s->kHistory[ch][0]),s->kCoefficients[1],s->kHistory[ch][1]);
            s->blockEnergy+=value*value;
        }
        s->blockFrames++;s->normalizationFrames++;
        if(s->blockFrames>=s->normalizationBlockFrames)loudness_block(s);
    }else{
        s->normTargetDb=0;
        if(s->normGainDb==0){if(s->normalizationFrames)normalization_reset(s);return 1;}
    }
    double distance=s->normTargetDb-s->normGainDb,step=(enabled?1:160)/s->sampleRate;
    if(distance==0)return s->normLinear;
    if(fabs(distance)<=step){s->normGainDb=s->normTargetDb;s->normLinear=pow(10,s->normGainDb/20);}
    else if(distance>0){s->normGainDb+=step;s->normLinear*=enabled?s->normUp:s->normOffUp;}
    else{s->normGainDb-=step;s->normLinear*=enabled?s->normDown:s->normOffDown;}
    return s->normLinear;
}
static double reverberate(LCDSPCore *s,uint32_t ch,double input){
    double sum=0;
    for(unsigned i=0;i<COMBS;i++){
        Delay *d=&s->comb[ch][i];double delayed=delay_read(d);
        d->damping=delayed*.65+d->damping*.35;delay_write(d,input*.25+d->damping*s->combFeedback[ch][i]);sum+=delayed;
    }
    for(unsigned i=0;i<ALLPASSES;i++){
        Delay *d=&s->allpass[ch][i];double delayed=delay_read(d),out=delayed-.5*sum;delay_write(d,sum+.5*out);sum=out;
    }
    return finite_sample(sum);
}
static void apply_settings(LCDSPCore *s,Settings next,int immediate){
    static const double hz[BANDS]={60,230,910,3600,14000};
    uint32_t mask=0,missing=0;double boost=0;
    for(unsigned b=0;b<BANDS;b++){
        if(hz[b]<s->sampleRate*0.49){mask|=1u<<b;coefficients(b,hz[b],s->sampleRate,next.gains[b],s->target[b]);}
        else{identity(s->target[b]);if(fabs(next.gains[b])>1e-6)missing=1;}
        if(next.gains[b]>boost)boost=next.gains[b];
    }
    /* Conservative automatic headroom plus a last finite peak guard. This is
       not advertised as true-peak loudness normalization or a LUFS limiter. */
    s->targetGain=pow(10,((double)next.preamp-boost)/20);
    s->targetWet=next.enabled&&!missing?1:0;
    if((next.enabled&&!s->current.enabled)||(next.normalization&&!s->current.normalization))normalization_reset(s);
    if(next.enabled!=s->current.enabled||(next.echo>0&&s->current.echo==0))echo_reset(s);
    if(next.enabled!=s->current.enabled||(next.reverb>0&&s->current.reverb==0))reverb_reset(s);
    s->targetReverb=next.reverb;s->targetEcho=next.echo;
    atomic_store(&s->bandMask,mask);atomic_store(&s->unavailable,missing?3:0);
    atomic_store(&s->headroom,bits((float)-boost));
    s->current=next;
    reset_energy(s);
    if(immediate){memcpy(s->coefficients,s->target,sizeof s->target);s->gain=s->targetGain;s->wet=s->targetWet;s->reverbAmount=s->targetReverb;s->echoAmount=s->targetEcho;s->rampRemaining=0;}
    else{
        s->rampRemaining=(uint32_t)fmax(64,s->sampleRate*0.025);
        for(unsigned b=0;b<BANDS;b++)for(unsigned c=0;c<COEFFICIENTS;c++)s->steps[b][c]=(s->target[b][c]-s->coefficients[b][c])/s->rampRemaining;
        s->gainStep=(s->targetGain-s->gain)/s->rampRemaining;s->wetStep=(s->targetWet-s->wet)/s->rampRemaining;
        s->reverbStep=(s->targetReverb-s->reverbAmount)/s->rampRemaining;s->echoStep=(s->targetEcho-s->echoAmount)/s->rampRemaining;
    }
    s->reverbDry=cos(s->reverbAmount*1.57079632679489661923);s->reverbWet=sin(s->reverbAmount*1.57079632679489661923)*.7;
}
int LCDSPPrepare(LCDSPCore *s,double sampleRate,uint32_t channels,uint32_t maximumFrames){
    if(!s)return 0;
    if(!isfinite(sampleRate)||sampleRate<8000||sampleRate>384000||channels<1||channels>2||!maximumFrames||maximumFrames>65536){LCDSPUnavailable(s,1);return 0;}
    atomic_store(&s->prepared,0);delays_free(s);
    s->sampleRate=sampleRate;s->renderChannels=channels;s->maximumFrames=maximumFrames;memset(s->history,0,sizeof s->history);
    static const double combTime[COMBS]={.0297,.0371,.0411,.0437},allpassTime[ALLPASSES]={.005,.0017};
    for(uint32_t ch=0;ch<channels;ch++){
        if(!delay_prepare(&s->echoDelay[ch],(uint32_t)llround(sampleRate*.28)))goto allocation_failed;
        for(unsigned i=0;i<COMBS;i++){
            double seconds=combTime[i]*(ch?1.011:1);uint32_t length=(uint32_t)llround(sampleRate*seconds);
            if(!delay_prepare(&s->comb[ch][i],length))goto allocation_failed;
            s->combFeedback[ch][i]=pow(.001,seconds/1.2);
        }
        for(unsigned i=0;i<ALLPASSES;i++)if(!delay_prepare(&s->allpass[ch][i],(uint32_t)llround(sampleRate*allpassTime[i]*(ch?1.017:1))))goto allocation_failed;
    }
    k_coefficients(s);normalization_reset(s);s->limiterGain=1;s->limiterRelease=exp(-1/(sampleRate*.16));
    s->normUp=pow(10,1/(20*sampleRate));s->normDown=1/s->normUp;
    s->normOffUp=pow(10,160/(20*sampleRate));s->normOffDown=1/s->normOffUp;
    s->normalizationBlockFrames=(uint32_t)llround(sampleRate*.4);
    s->meterWindowFrames=(uint32_t)llround(sampleRate*.01);atomic_store(&s->windowFrames,s->meterWindowFrames);
    Settings cfg=s->current;read_settings(s,&cfg);apply_settings(s,cfg,1);
    atomic_store(&s->rate,(uint32_t)llround(sampleRate));atomic_store(&s->channels,channels);atomic_store(&s->appliedRevision,0);atomic_store(&s->prepared,1);
    return 1;
allocation_failed:
    delays_free(s);LCDSPUnavailable(s,2);return 0;
}
void LCDSPUnprepare(LCDSPCore *s){if(s){atomic_store(&s->prepared,0);s->rampRemaining=0;memset(s->history,0,sizeof s->history);delays_free(s);}}
void LCDSPUnavailable(LCDSPCore *s,uint32_t reason){if(s){atomic_store(&s->prepared,0);atomic_store(&s->unavailable,reason?reason:1);}}
void LCDSPReset(LCDSPCore *s){if(s){memset(s->history,0,sizeof s->history);echo_reset(s);reverb_reset(s);normalization_reset(s);s->limiterGain=1;reset_energy(s);}}
void LCDSPProcess(LCDSPCore *s,float *left,float *right,uint32_t frames,uint32_t stride){
    if(!s||!left||!frames||!stride||stride>2||frames>s->maximumFrames||!atomic_load(&s->prepared)||(s->renderChannels==2&&!right))return;
    Settings cfg;if(read_settings(s,&cfg)&&cfg.revision!=s->current.revision)apply_settings(s,cfg,0);
    double inSquares=0,outSquares=0;uint64_t measuredSamples=0;uint32_t firstWindow=(uint32_t)fmin(ENERGY_WINDOWS,s->meterFrames/s->meterWindowFrames);
    for(uint32_t f=0;f<frames;f++){
        if(s->rampRemaining){
            for(unsigned b=0;b<BANDS;b++)for(unsigned c=0;c<COEFFICIENTS;c++)s->coefficients[b][c]+=s->steps[b][c];
            s->gain+=s->gainStep;s->wet+=s->wetStep;
            s->reverbAmount+=s->reverbStep;s->echoAmount+=s->echoStep;
            if(!--s->rampRemaining){memcpy(s->coefficients,s->target,sizeof s->target);s->gain=s->targetGain;s->wet=s->targetWet;s->reverbAmount=s->targetReverb;s->echoAmount=s->targetEcho;if(s->wet==0)normalization_reset(s);}
            s->reverbDry=cos(s->reverbAmount*1.57079632679489661923);s->reverbWet=sin(s->reverbAmount*1.57079632679489661923)*.7;
        }
        double input[2]={finite_sample(left[(size_t)f*stride]),s->renderChannels==2?finite_sample(right[(size_t)f*stride]):0},processed[2]={input[0],input[1]};
        if(s->wet>0.000001){
            double normalization=normalize_frame(s,input),peak=0;
            for(uint32_t ch=0;ch<s->renderChannels;ch++){
                double filtered=input[ch]*normalization;
                for(unsigned b=0;b<BANDS;b++)filtered=filter(filtered,s->coefficients[b],s->history[ch][b]);
                double base=finite_sample(filtered*s->gain),value=base;
                if(s->reverbAmount>0.000001)value=base*s->reverbDry+reverberate(s,ch,base)*s->reverbWet;
                if(s->echoAmount>0.000001){Delay *d=&s->echoDelay[ch];double delayed=delay_read(d);delay_write(d,base+delayed*s->echoAmount*.55);value+=delayed*s->echoAmount*.6;}
                processed[ch]=finite_sample(value);peak=fmax(peak,fabs(processed[ch]));
            }
            /* Stereo-linked zero-lookahead limiter: instantaneous finite
               attack, 160 ms release, -3 dBFS ceiling. Not a true-peak claim. */
            double desired=peak>.7079457843841379?.7079457843841379/peak:1;
            s->limiterGain=desired<s->limiterGain?desired:desired+(s->limiterGain-desired)*s->limiterRelease;
            s->minimumLimiterGain=fmin(s->minimumLimiterGain,s->limiterGain);
            for(uint32_t ch=0;ch<s->renderChannels;ch++)processed[ch]=fmax(-.98,fmin(.98,finite_sample(input[ch]+(processed[ch]*s->limiterGain-input[ch])*s->wet)));
        }
        uint64_t window=s->meterFrames/s->meterWindowFrames;
        for(uint32_t ch=0;ch<s->renderChannels;ch++){
            float *p=(ch?right:left)+(size_t)f*stride;double output=processed[ch];
            *p=(float)output;
            s->maximumPeak=fmax(s->maximumPeak,fabs(output));
            if(!s->rampRemaining){inSquares+=input[ch]*input[ch];outSquares+=output*output;measuredSamples++;}
            if(window<ENERGY_WINDOWS){s->windowInputEnergy[window]+=input[ch]*input[ch];s->windowOutputEnergy[window]+=output*output;s->windowSampleCount[window]++;}
        }
        s->meterFrames++;
    }
    uint32_t lastWindow=(uint32_t)fmin(ENERGY_WINDOWS,(s->meterFrames+s->meterWindowFrames-1)/s->meterWindowFrames);
    for(uint32_t i=firstWindow;i<lastWindow;i++){
        atomic_store(&s->windowInput[i],bits((float)fmin(3.402823466e38,s->windowInputEnergy[i])));atomic_store(&s->windowOutput[i],bits((float)fmin(3.402823466e38,s->windowOutputEnergy[i])));atomic_store(&s->windowCount[i],s->windowSampleCount[i]);
    }
    atomic_store(&s->normMeasured,s->loudnessCount>=8);atomic_store(&s->normFrames,(uint32_t)fmin(UINT32_MAX,s->normalizationFrames));
    atomic_store(&s->loudness,bits((float)s->loudnessDb));atomic_store(&s->normGain,bits((float)s->normGainDb));atomic_store(&s->normTarget,bits((float)s->normTargetDb));
    atomic_store(&s->peak,bits((float)(20*log10(fmax(1e-6,s->maximumPeak)))));atomic_store(&s->reduction,bits((float)(-20*log10(fmax(s->minimumLimiterGain,1e-38)))));
    s->inputEnergy+=inSquares;s->outputEnergy+=outSquares;s->energySamples+=measuredSamples;
    if(s->energySamples){
        atomic_store(&s->inputRMS,bits((float)fmin(3.402823466e38,sqrt(s->inputEnergy/s->energySamples))));
        atomic_store(&s->outputRMS,bits((float)fmin(3.402823466e38,sqrt(s->outputEnergy/s->energySamples))));
    }
    atomic_fetch_add(&s->frames,frames);
    if(!s->rampRemaining)atomic_store(&s->appliedRevision,s->current.revision);
}
LCDSPMetrics LCDSPReadMetrics(const LCDSPCore *s){
    LCDSPMetrics m={0};if(!s)return m;
    m.processedFrames=atomic_load(&s->frames);m.requestedRevision=atomic_load(&s->revision);m.appliedRevision=atomic_load(&s->appliedRevision);
    m.prepared=atomic_load(&s->prepared);m.unavailableReason=atomic_load(&s->unavailable);m.sampleRate=atomic_load(&s->rate);m.channels=atomic_load(&s->channels);m.activeBandMask=atomic_load(&s->bandMask);
    m.inputRMS=number(atomic_load(&s->inputRMS));m.outputRMS=number(atomic_load(&s->outputRMS));m.headroomDb=number(atomic_load(&s->headroom));
    m.normalizationMeasured=atomic_load(&s->normMeasured);m.normalizationFrames=atomic_load(&s->normFrames);m.energyWindowFrames=atomic_load(&s->windowFrames);
    m.loudnessDb=number(atomic_load(&s->loudness));m.normalizationGainDb=number(atomic_load(&s->normGain));m.normalizationTargetDb=number(atomic_load(&s->normTarget));m.peakDb=number(atomic_load(&s->peak));m.limiterReductionDb=number(atomic_load(&s->reduction));return m;
}
LCDSPEnergyWindow LCDSPReadEnergyWindow(const LCDSPCore *s,uint32_t index){
    LCDSPEnergyWindow value={0};if(!s||index>=ENERGY_WINDOWS)return value;
    value.frames=atomic_load(&s->windowCount[index]);value.inputEnergy=number(atomic_load(&s->windowInput[index]));value.outputEnergy=number(atomic_load(&s->windowOutput[index]));return value;
}
