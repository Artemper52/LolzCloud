#include "NativeAudioTap.h"
#include <AudioToolbox/AudioToolbox.h>
#include <stdlib.h>
#include <math.h>
#include <limits.h>

typedef struct {
    LCDSPCore *core;
    AudioStreamBasicDescription format;
    uint32_t frames,channels,bytes,bits,planar,isFloat,valid;
    float *left,*right;
} TapStorage;
static void tap_init(MTAudioProcessingTapRef tap,void *client,void **out){(void)tap;*out=client;}
static void tap_unprepare(MTAudioProcessingTapRef tap){
    TapStorage *s=MTAudioProcessingTapGetStorage(tap);s->valid=0;
    free(s->left);free(s->right);s->left=s->right=NULL;LCDSPUnprepare(s->core);
}
static void tap_finalize(MTAudioProcessingTapRef tap){
    TapStorage *s=MTAudioProcessingTapGetStorage(tap);free(s->left);free(s->right);LCDSPRelease(s->core);free(s);
}
static void tap_prepare(MTAudioProcessingTapRef tap,CMItemCount maximumFrames,const AudioStreamBasicDescription *format){
    TapStorage *s=MTAudioProcessingTapGetStorage(tap);free(s->left);free(s->right);s->left=s->right=NULL;s->valid=0;
    s->format=*format;s->frames=(uint32_t)maximumFrames;s->channels=format->mChannelsPerFrame;s->bits=format->mBitsPerChannel;
    s->planar=(format->mFormatFlags&kAudioFormatFlagIsNonInterleaved)!=0;s->isFloat=(format->mFormatFlags&kAudioFormatFlagIsFloat)!=0;s->bytes=s->bits/8;
#if __BIG_ENDIAN__
    int endian=(format->mFormatFlags&kAudioFormatFlagIsBigEndian)!=0;
#else
    int endian=(format->mFormatFlags&kAudioFormatFlagIsBigEndian)==0;
#endif
    if(format->mFormatID!=kAudioFormatLinearPCM||!endian||maximumFrames<=0||maximumFrames>65536||s->channels<1||s->channels>2||
       format->mBytesPerFrame!=s->bytes*(s->planar?1:s->channels)||
       !(s->isFloat?(s->bits==32||s->bits==64):((format->mFormatFlags&kAudioFormatFlagIsSignedInteger)&&(s->bits==16||s->bits==32)))){LCDSPUnavailable(s->core,1);return;}
    if(!(s->isFloat&&s->bits==32)){
        s->left=calloc(s->frames,sizeof(float));if(s->channels==2)s->right=calloc(s->frames,sizeof(float));
        if(!s->left||(s->channels==2&&!s->right)){free(s->left);free(s->right);s->left=s->right=NULL;LCDSPUnavailable(s->core,2);return;}
    }
    s->valid=(uint32_t)LCDSPPrepare(s->core,format->mSampleRate,s->channels,s->frames);
}
static double read_sample(TapStorage *s,void *p,size_t index){
    if(s->isFloat)return s->bits==32?((float*)p)[index]:((double*)p)[index];
    return s->bits==16?((int16_t*)p)[index]/32768.0:((int32_t*)p)[index]/2147483648.0;
}
static void write_sample(TapStorage *s,void *p,size_t index,float input){
    double v=isfinite(input)?input:0;
    if(s->isFloat){if(s->bits==32)((float*)p)[index]=(float)v;else((double*)p)[index]=v;}
    else if(s->bits==16)((int16_t*)p)[index]=(int16_t)lrint(fmax(-32768,fmin(32767,v*32768)));
    else((int32_t*)p)[index]=(int32_t)llrint(fmax(-2147483648.0,fmin(2147483647.0,v*2147483648.0)));
}
static void tap_process(MTAudioProcessingTapRef tap,CMItemCount requested,MTAudioProcessingTapFlags flags,AudioBufferList *buffers,CMItemCount *framesOut,MTAudioProcessingTapFlags *flagsOut){
    (void)flags;TapStorage *s=MTAudioProcessingTapGetStorage(tap);CMItemCount count=0;MTAudioProcessingTapFlags sourceFlags=0;
    OSStatus result=MTAudioProcessingTapGetSourceAudio(tap,requested,buffers,&sourceFlags,NULL,&count);
    *framesOut=count;*flagsOut=sourceFlags;
    if(result!=noErr){*framesOut=0;return;}
    if(!count||!s->valid)return;
    if(count<0||count>s->frames||buffers->mNumberBuffers!=(s->planar?s->channels:1)){LCDSPUnavailable(s->core,1);return;}
    uint32_t stride=s->planar?1:s->channels;
    for(uint32_t b=0;b<buffers->mNumberBuffers;b++)if(!buffers->mBuffers[b].mData||buffers->mBuffers[b].mDataByteSize<(size_t)count*stride*s->bytes||buffers->mBuffers[b].mNumberChannels!=(s->planar?1:s->channels)){LCDSPUnavailable(s->core,1);return;}
    if(sourceFlags&kMTAudioProcessingTapFlag_StartOfStream)LCDSPReset(s->core);
    if(s->isFloat&&s->bits==32){
        float *left=buffers->mBuffers[0].mData,*right=s->channels==2?(s->planar?buffers->mBuffers[1].mData:left+1):NULL;
        LCDSPProcess(s->core,left,right,(uint32_t)count,stride);
    }else{
        for(CMItemCount f=0;f<count;f++)for(uint32_t ch=0;ch<s->channels;ch++){
            void *p=buffers->mBuffers[s->planar?ch:0].mData;double value=read_sample(s,p,(size_t)f*stride+(s->planar?0:ch));
            (ch?s->right:s->left)[f]=isfinite(value)?(float)fmax(-3.402823466e38,fmin(3.402823466e38,value)):0;
        }
        LCDSPProcess(s->core,s->left,s->right,(uint32_t)count,1);
        for(CMItemCount f=0;f<count;f++)for(uint32_t ch=0;ch<s->channels;ch++)write_sample(s,buffers->mBuffers[s->planar?ch:0].mData,(size_t)f*stride+(s->planar?0:ch),(ch?s->right:s->left)[f]);
    }
}
MTAudioProcessingTapRef LCNativeAudioTapCreate(LCDSPCore *core){
    TapStorage *storage=calloc(1,sizeof *storage);if(!storage)return NULL;storage->core=core;LCDSPRetain(core);
    MTAudioProcessingTapCallbacks callbacks={kMTAudioProcessingTapCallbacksVersion_0,storage,tap_init,tap_finalize,tap_prepare,tap_unprepare,tap_process};
    MTAudioProcessingTapRef tap=NULL;OSStatus status=MTAudioProcessingTapCreate(kCFAllocatorDefault,&callbacks,kMTAudioProcessingTapCreationFlag_PostEffects,&tap);
    if(status!=noErr){LCDSPRelease(core);free(storage);return NULL;}return tap;
}
