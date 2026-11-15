#include "../LolzCloud/DSP/include/LCPitchCore.h"
#include "../LolzCloud/DSP/include/LCPCMStream.h"
#include <assert.h>
#include <stdio.h>
#include <math.h>
#include <time.h>
#include <stdlib.h>

static const double PI=3.14159265358979323846;
static unsigned renderScope,renderAllocations;
void *__real_malloc(size_t size);void *__real_calloc(size_t count,size_t size);void *__real_realloc(void *p,size_t size);void __real_free(void *p);
void *__wrap_malloc(size_t size){if(renderScope)renderAllocations++;return __real_malloc(size);}
void *__wrap_calloc(size_t count,size_t size){if(renderScope)renderAllocations++;return __real_calloc(count,size);}
void *__wrap_realloc(void *p,size_t size){if(renderScope)renderAllocations++;return __real_realloc(p,size);}
void __wrap_free(void *p){if(renderScope)renderAllocations++;__real_free(p);}
typedef struct { uint32_t position,total; } ToneSource;
static int read_tone(void *context,uint32_t wanted,float *left,float *right,uint32_t *count,uint32_t *flags){
    ToneSource *s=context;*count=s->total-s->position;if(*count>wanted)*count=wanted;*flags=s->position==0?LCPCMStart:0;
    for(uint32_t i=0;i<*count;i++){left[i]=(float)(sin(2*PI*910*(s->position+i)/48000)*.1);if(right)right[i]=-left[i]*.5;}
    s->position+=*count;if(s->position==s->total)*flags|=LCPCMEnd;return 1;
}
int main(void){
    const double ratios[]={.5,.75,1.25,1.5,2},frequencies[]={60,220,910,3000,12000};
    printf("{\"scope\":\"Real Linux C PCM; not Apple SDK or physical output\",\"observations\":[");
    unsigned count=0;double maximumError=0,start=(double)clock()/CLOCKS_PER_SEC;
    for(unsigned f=0;f<5;f++)for(unsigned r=0;r<5;r++){
        if(frequencies[f]*ratios[r]>=22000)continue;
        LCPitchCore *p=LCPitchCreate();assert(p&&LCPitchPrepare(p,48000,2));LCPitchConfigure(p,ratios[r],1);
        unsigned crossings=0,armed=0,samples=0;double energy=0,stereoError=0,peak=0;
        double expected=frequencies[f]*ratios[r],targetCo=2*cos(2*PI*expected/48000),oldCo=2*cos(2*PI*frequencies[f]/48000),a1=0,a2=0,b1=0,b2=0;
        for(unsigned i=0;i<48000*3;i++){
            double x[2]={sin(2*PI*frequencies[f]*i/48000)*.1,0},dry[2],out[2];x[1]=-x[0]*.5;renderScope=1;LCPitchFrame(p,x,dry,out);renderScope=0;
            assert(isfinite(out[0])&&isfinite(out[1]));
            if(i>=48000){
                if(out[0]<-.0001)armed=1;else if(out[0]>.0001&&armed){crossings++;armed=0;}
                energy+=out[0]*out[0];samples++;stereoError=fmax(stereoError,fabs(out[1]+out[0]*.5));peak=fmax(peak,fabs(out[0]));
                double a=out[0]+targetCo*a1-a2,b=out[0]+oldCo*b1-b2;a2=a1;a1=a;b2=b1;b1=b;
            }
        }
        double hz=(double)crossings*48000/samples,error=fabs(hz-expected)/expected,rms=sqrt(energy/samples);
        double amplitude=2*sqrt(fmax(0,a1*a1+a2*a2-targetCo*a1*a2))/samples,oldAmplitude=2*sqrt(fmax(0,b1*b1+b2*b2-oldCo*b1*b2))/samples;
        maximumError=fmax(maximumError,error);assert(stereoError<1e-7&&energy>1e-7&&peak<1&&rms>.05&&rms<.1&&amplitude/rms>1.2&&oldAmplitude/rms<.2);
        printf("%s{\"inputHz\":%.4f,\"ratio\":%.4f,\"expectedHz\":%.4f,\"measuredCrossingHz\":%.4f,\"relativeError\":%.6f,\"rms\":%.6f,\"targetSpectralAmplitude\":%.6f,\"oldToneAmplitude\":%.6f,\"stereoError\":%.9f,\"latencyFrames\":%u}",count++?",":"",frequencies[f],ratios[r],expected,hz,error,rms,amplitude,oldAmplitude,stereoError,LCPitchLatency(p));
        LCPitchDestroy(p);
    }
    LCDSPCore *core=LCDSPCreate();assert(core);float gains[5]={0};assert(LCDSPConfigurePitch(core,0,gains,5,0,0,0,0,1.5f,2));assert(LCDSPPrepare(core,48000,2,256));
    LCPCMStream *stream=LCPCMStreamCreate(core,2,256);assert(stream);ToneSource tone={0,48000};uint32_t output=0,calls=0,flags=0;
    while(!(flags&LCPCMEnd)){
        uint32_t frames=0;if(calls==10)assert(LCDSPConfigurePitch(core,0,gains,5,0,0,0,0,.75f,3));
        renderScope=1;int result=LCPCMStreamRender(stream,read_tone,&tone,256,&frames,&flags);renderScope=0;
        assert(result&&frames<=256);output+=frames;calls++;assert(calls<210);
    }
    assert(output==48000&&LCDSPReadMetrics(core).processedFrames==48000&&LCDSPReadMetrics(core).appliedRevision==3);
    LCPCMStreamDestroy(stream);LCDSPRelease(core);assert(renderAllocations==0);
    printf("],\"cases\":%u,\"maximumRelativeFrequencyError\":%.9f,\"renderHeapCalls\":%u,\"fullPipelineTimelineFrames\":%u,\"cpuSeconds\":%.4f}\n",count,maximumError,renderAllocations,output,(double)clock()/CLOCKS_PER_SEC-start);
    return maximumError<=.025?0:1;
}
