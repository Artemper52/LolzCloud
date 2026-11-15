#include "include/LCPCMStream.h"
#include <stdlib.h>
#include <string.h>

struct LCPCMStream {
    LCDSPCore *core;
    float *storage,*input[2],*output[2];
    uint32_t channels,maximum,latency,primeRemaining,ended,pendingStart;
    uint64_t sourceFrames,outputFrames;
};
LCPCMStream *LCPCMStreamCreate(LCDSPCore *core,uint32_t channels,uint32_t maximum){
    if(!core||channels<1||channels>2||!maximum||maximum>65536)return NULL;
    LCPCMStream *s=calloc(1,sizeof *s);if(!s)return NULL;
    s->storage=calloc((size_t)maximum*4,sizeof(float));if(!s->storage){free(s);return NULL;}
    s->core=core;s->channels=channels;s->maximum=maximum;s->latency=LCDSPUsePitchLookahead(core);
    if(!s->latency){LCPCMStreamDestroy(s);return NULL;}
    s->primeRemaining=s->latency;s->pendingStart=1;
    for(unsigned ch=0;ch<2;ch++){s->input[ch]=s->storage+maximum*ch;s->output[ch]=s->storage+maximum*(ch+2);}
    return s;
}
void LCPCMStreamDestroy(LCPCMStream *s){if(s){free(s->storage);free(s);}}
static void discontinuity(LCPCMStream *s){
    LCDSPReset(s->core);s->sourceFrames=s->outputFrames=0;s->primeRemaining=s->latency;s->ended=0;s->pendingStart=1;
}
int LCPCMStreamRender(LCPCMStream *s,LCPCMRead read,void *context,uint32_t requested,uint32_t *count,uint32_t *flags){
    if(!count||!flags)return 0;*count=*flags=0;
    if(!s||!read||!requested||requested>s->maximum)return 0;
    uint32_t produced=0;
    /* A broken/starved source cannot force an unbounded callback loop. Normal
       file pulls need one request plus at most ceil(latency/maximum) priming. */
    for(unsigned attempt=0;attempt<128&&produced<requested;attempt++){
        uint32_t wanted=s->primeRemaining?s->primeRemaining:requested-produced;if(wanted>s->maximum)wanted=s->maximum;
        uint32_t actual=0,sourceFlags=0;
        if(!s->ended){
            if(!read(context,wanted,s->input[0],s->channels==2?s->input[1]:NULL,&actual,&sourceFlags)||actual>wanted)return 0;
            if(sourceFlags&LCPCMStart){discontinuity(s);produced=0;}
            s->sourceFrames+=actual;
            if(sourceFlags&LCPCMEnd)s->ended=1;
            if(!actual&&!s->ended)break;
        }
        if(!actual&&s->ended){
            uint64_t remaining=s->primeRemaining?s->primeRemaining:s->sourceFrames-s->outputFrames;
            actual=(uint32_t)(remaining<wanted?remaining:wanted);
            if(!actual)break;
            for(uint32_t ch=0;ch<s->channels;ch++)memset(s->input[ch],0,actual*sizeof(float));
        }
        /* StartOfStream may arrive on a normal-sized source pull. Split that
           chunk at the new lookahead boundary instead of rejecting valid
           frames or counting the priming portion as audible output. */
        for(uint32_t offset=0;offset<actual;){
            uint32_t part=actual-offset;
            if(s->primeRemaining&&part>s->primeRemaining)part=s->primeRemaining;
            if(!s->primeRemaining&&part>requested-produced)return 0;
            LCDSPProcess(s->core,s->input[0]+offset,s->channels==2?s->input[1]+offset:NULL,part,1);
            if(s->primeRemaining){
                s->primeRemaining-=part;
                if(!s->primeRemaining)LCDSPBeginOutputTimeline(s->core);
            }else{
                for(uint32_t ch=0;ch<s->channels;ch++)memcpy(s->output[ch]+produced,s->input[ch]+offset,part*sizeof(float));
                produced+=part;s->outputFrames+=part;
            }
            offset+=part;
        }
    }
    if(produced&&s->pendingStart){*flags|=LCPCMStart;s->pendingStart=0;}
    if(s->ended&&(!s->sourceFrames||(!s->primeRemaining&&s->outputFrames==s->sourceFrames)))*flags|=LCPCMEnd;
    *count=produced;return 1;
}
const float *LCPCMStreamChannel(const LCPCMStream *s,uint32_t channel){return s&&channel<s->channels?s->output[channel]:NULL;}
