#include "include/LCDSPCore.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Realtime parameter words must be lock-free");
_Static_assert(ATOMIC_LLONG_LOCK_FREE == 2, "Realtime counters must be lock-free");
enum { BANDS=5, COEFFICIENTS=5 };
typedef struct { int enabled; float gains[BANDS],preamp; uint32_t revision; } Settings;
struct LCDSPCore {
    atomic_uint references, sequence, enabled, gains[BANDS], preamp, revision;
    atomic_uint prepared, unavailable, rate, channels, bandMask, appliedRevision;
    atomic_uint inputRMS, outputRMS, headroom;
    atomic_ullong frames;
    /* Only prepare/process/unprepare touch render state; Apple serializes it. */
    Settings current;
    double sampleRate, coefficients[BANDS][COEFFICIENTS], target[BANDS][COEFFICIENTS];
    double steps[BANDS][COEFFICIENTS], history[2][BANDS][2];
    double gain, targetGain, gainStep, wet, targetWet, wetStep;
    double inputEnergy, outputEnergy;
    uint64_t energySamples;
    uint32_t maximumFrames, renderChannels, rampRemaining;
};
static uint32_t bits(float value){uint32_t result;memcpy(&result,&value,sizeof result);return result;}
static float number(uint32_t value){float result;memcpy(&result,&value,sizeof result);return result;}
static double finite_sample(double value){return isfinite(value)?value:0;}
static void identity(double c[COEFFICIENTS]){c[0]=1;c[1]=c[2]=c[3]=c[4]=0;}
static void reset_energy(LCDSPCore *s){s->inputEnergy=s->outputEnergy=0;s->energySamples=0;atomic_store(&s->inputRMS,bits(0));atomic_store(&s->outputRMS,bits(0));}
static int read_settings(LCDSPCore *s,Settings *out){
    /* Atomic words prevent a C data race. SC ordering makes the sequence check
       a coherent bounded snapshot. A preempted producer cannot stall audio. */
    for(unsigned attempt=0;attempt<3;attempt++){
        unsigned before=atomic_load(&s->sequence);if(before&1)continue;
        Settings next;next.enabled=(int)atomic_load(&s->enabled);
        for(unsigned b=0;b<BANDS;b++)next.gains[b]=number(atomic_load(&s->gains[b]));
        next.preamp=number(atomic_load(&s->preamp));next.revision=atomic_load(&s->revision);
        unsigned after=atomic_load(&s->sequence);
        if(before==after&&!(after&1)){*out=next;return 1;}
    }
    return 0;
}
LCDSPCore *LCDSPCreate(void){
    LCDSPCore *s=calloc(1,sizeof *s);if(!s)return NULL;
    atomic_init(&s->references,1);atomic_init(&s->sequence,0);atomic_init(&s->enabled,0);
    for(unsigned b=0;b<BANDS;b++)atomic_init(&s->gains[b],bits(0));
    atomic_init(&s->preamp,bits(0));atomic_init(&s->revision,1);
    atomic_init(&s->prepared,0);atomic_init(&s->unavailable,0);atomic_init(&s->rate,0);atomic_init(&s->channels,0);
    atomic_init(&s->bandMask,0);atomic_init(&s->appliedRevision,0);atomic_init(&s->frames,0);
    atomic_init(&s->inputRMS,bits(0));atomic_init(&s->outputRMS,bits(0));atomic_init(&s->headroom,bits(0));
    s->gain=s->targetGain=1;for(unsigned b=0;b<BANDS;b++)identity(s->coefficients[b]);
    return s;
}
void LCDSPRetain(LCDSPCore *s){if(s)atomic_fetch_add_explicit(&s->references,1,memory_order_relaxed);}
void LCDSPRelease(LCDSPCore *s){if(s&&atomic_fetch_sub_explicit(&s->references,1,memory_order_acq_rel)==1)free(s);}
int LCDSPConfigure(LCDSPCore *s,int enabled,const float *gains,size_t count,float preamp,uint32_t revision){
    if(!s||!gains||count!=BANDS||!revision||(enabled!=0&&enabled!=1)||!isfinite(preamp)||preamp < -12||preamp>0)return 0;
    for(unsigned b=0;b<BANDS;b++)if(!isfinite(gains[b])||gains[b]<-12||gains[b]>12)return 0;
    atomic_fetch_add(&s->sequence,1);
    atomic_store(&s->enabled,(unsigned)enabled);
    for(unsigned b=0;b<BANDS;b++)atomic_store(&s->gains[b],bits(gains[b]));
    atomic_store(&s->preamp,bits(preamp));atomic_store(&s->revision,revision);
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
    atomic_store(&s->bandMask,mask);atomic_store(&s->unavailable,missing?3:0);
    atomic_store(&s->headroom,bits((float)-boost));
    s->current=next;
    reset_energy(s);
    if(immediate){memcpy(s->coefficients,s->target,sizeof s->target);s->gain=s->targetGain;s->wet=s->targetWet;s->rampRemaining=0;}
    else{
        s->rampRemaining=(uint32_t)fmax(64,s->sampleRate*0.025);
        for(unsigned b=0;b<BANDS;b++)for(unsigned c=0;c<COEFFICIENTS;c++)s->steps[b][c]=(s->target[b][c]-s->coefficients[b][c])/s->rampRemaining;
        s->gainStep=(s->targetGain-s->gain)/s->rampRemaining;s->wetStep=(s->targetWet-s->wet)/s->rampRemaining;
    }
}
int LCDSPPrepare(LCDSPCore *s,double sampleRate,uint32_t channels,uint32_t maximumFrames){
    if(!s)return 0;
    if(!isfinite(sampleRate)||sampleRate<8000||sampleRate>384000||channels<1||channels>2||!maximumFrames||maximumFrames>65536){LCDSPUnavailable(s,1);return 0;}
    s->sampleRate=sampleRate;s->renderChannels=channels;s->maximumFrames=maximumFrames;memset(s->history,0,sizeof s->history);
    Settings cfg=s->current;read_settings(s,&cfg);apply_settings(s,cfg,1);
    atomic_store(&s->rate,(uint32_t)llround(sampleRate));atomic_store(&s->channels,channels);atomic_store(&s->appliedRevision,0);atomic_store(&s->prepared,1);
    return 1;
}
void LCDSPUnprepare(LCDSPCore *s){if(s){atomic_store(&s->prepared,0);s->rampRemaining=0;memset(s->history,0,sizeof s->history);}}
void LCDSPUnavailable(LCDSPCore *s,uint32_t reason){if(s){atomic_store(&s->prepared,0);atomic_store(&s->unavailable,reason?reason:1);}}
void LCDSPReset(LCDSPCore *s){if(s){memset(s->history,0,sizeof s->history);reset_energy(s);}}
void LCDSPProcess(LCDSPCore *s,float *left,float *right,uint32_t frames,uint32_t stride){
    if(!s||!left||!frames||!stride||stride>2||frames>s->maximumFrames||!atomic_load(&s->prepared)||(s->renderChannels==2&&!right))return;
    Settings cfg;if(read_settings(s,&cfg)&&cfg.revision!=s->current.revision)apply_settings(s,cfg,0);
    double inSquares=0,outSquares=0;uint64_t measuredSamples=0;
    for(uint32_t f=0;f<frames;f++){
        if(s->rampRemaining){
            for(unsigned b=0;b<BANDS;b++)for(unsigned c=0;c<COEFFICIENTS;c++)s->coefficients[b][c]+=s->steps[b][c];
            s->gain+=s->gainStep;s->wet+=s->wetStep;
            if(!--s->rampRemaining){memcpy(s->coefficients,s->target,sizeof s->target);s->gain=s->targetGain;s->wet=s->targetWet;}
        }
        for(uint32_t ch=0;ch<s->renderChannels;ch++){
            float *p=(ch?right:left)+(size_t)f*stride;double input=finite_sample(*p),output=input;
            if(s->wet>0.000001){
                double filtered=input;
                for(unsigned b=0;b<BANDS;b++){
                    double *c=s->coefficients[b],*z=s->history[ch][b],v=c[0]*filtered+z[0];
                    z[0]=finite_sample(c[1]*filtered-c[3]*v+z[1]);z[1]=finite_sample(c[2]*filtered-c[4]*v);filtered=finite_sample(v);
                }
                output=input+(filtered*s->gain-input)*s->wet;
                output=fmax(-0.98,fmin(0.98,finite_sample(output)));
            }
            *p=(float)output;
            if(!s->rampRemaining){inSquares+=input*input;outSquares+=output*output;measuredSamples++;}
        }
    }
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
    m.inputRMS=number(atomic_load(&s->inputRMS));m.outputRMS=number(atomic_load(&s->outputRMS));m.headroomDb=number(atomic_load(&s->headroom));return m;
}
