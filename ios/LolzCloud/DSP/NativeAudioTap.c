#include "NativeAudioTap.h"
#include "include/LCPCMStream.h"
#include <AudioToolbox/AudioToolbox.h>
#include <stdlib.h>
#include <math.h>
#include <limits.h>

typedef struct {
    LCDSPCore *core;
    AudioStreamBasicDescription format;
    uint32_t frames,channels,bytes,bits,planar,isFloat,valid;
    LCPCMStream *stream;
    void *output[2];
} TapStorage;
static void tap_init(MTAudioProcessingTapRef tap,void *client,void **out){(void)tap;*out=client;}
static void tap_unprepare(MTAudioProcessingTapRef tap){
    TapStorage *s=MTAudioProcessingTapGetStorage(tap);s->valid=0;
    LCPCMStreamDestroy(s->stream);s->stream=NULL;free(s->output[0]);free(s->output[1]);s->output[0]=s->output[1]=NULL;LCDSPUnprepare(s->core);
}
static void tap_finalize(MTAudioProcessingTapRef tap){
    TapStorage *s=MTAudioProcessingTapGetStorage(tap);LCPCMStreamDestroy(s->stream);free(s->output[0]);free(s->output[1]);LCDSPRelease(s->core);free(s);
}
static void tap_prepare(MTAudioProcessingTapRef tap,CMItemCount maximumFrames,const AudioStreamBasicDescription *format){
    TapStorage *s=MTAudioProcessingTapGetStorage(tap);LCPCMStreamDestroy(s->stream);s->stream=NULL;free(s->output[0]);free(s->output[1]);s->output[0]=s->output[1]=NULL;s->valid=0;
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
    if(!LCDSPPrepare(s->core,format->mSampleRate,s->channels,s->frames))return;
    s->stream=LCPCMStreamCreate(s->core,s->channels,s->frames);
    s->output[0]=calloc((size_t)s->frames*(s->planar?1:s->channels),s->bytes);
    if(s->planar&&s->channels==2)s->output[1]=calloc(s->frames,s->bytes);
    if(!s->stream||!s->output[0]||(s->planar&&s->channels==2&&!s->output[1])){LCPCMStreamDestroy(s->stream);s->stream=NULL;free(s->output[0]);free(s->output[1]);s->output[0]=s->output[1]=NULL;LCDSPUnavailable(s->core,2);return;}
    s->valid=1;
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
typedef struct { UInt32 mNumberBuffers; AudioBuffer mBuffers[2]; } TwoAudioBuffers;
_Static_assert(offsetof(TwoAudioBuffers,mBuffers)==offsetof(AudioBufferList,mBuffers),"Source buffer layout must match Core Audio");
typedef struct { MTAudioProcessingTapRef tap; TapStorage *storage; } SourceContext;
static int tap_read(void *context,uint32_t requested,float *left,float *right,uint32_t *frames,uint32_t *flags){
    SourceContext *source=context;TapStorage *s=source->storage;uint32_t stride=s->planar?1:s->channels;
    TwoAudioBuffers list={0};list.mNumberBuffers=s->planar?s->channels:1;
    for(uint32_t b=0;b<list.mNumberBuffers;b++){list.mBuffers[b].mNumberChannels=s->planar?1:s->channels;list.mBuffers[b].mDataByteSize=requested*stride*s->bytes;}
    CMItemCount count=0;MTAudioProcessingTapFlags sourceFlags=0;
    OSStatus result=MTAudioProcessingTapGetSourceAudio(source->tap,requested,(AudioBufferList*)&list,&sourceFlags,NULL,&count);
    if(result!=noErr||count<0||count>requested)return 0;
    *frames=(uint32_t)count;*flags=0;
    if(sourceFlags&kMTAudioProcessingTapFlag_StartOfStream)*flags|=LCPCMStart;
    if(sourceFlags&kMTAudioProcessingTapFlag_EndOfStream)*flags|=LCPCMEnd;
    if(!count)return 1;
    if(list.mNumberBuffers!=(s->planar?s->channels:1))return 0;
    for(uint32_t b=0;b<list.mNumberBuffers;b++)if(!list.mBuffers[b].mData||list.mBuffers[b].mDataByteSize<(size_t)count*stride*s->bytes||list.mBuffers[b].mNumberChannels!=(s->planar?1:s->channels))return 0;
    for(CMItemCount f=0;f<count;f++)for(uint32_t ch=0;ch<s->channels;ch++){
        double value=read_sample(s,list.mBuffers[s->planar?ch:0].mData,(size_t)f*stride+(s->planar?0:ch));
        (ch?right:left)[f]=isfinite(value)?(float)fmax(-1e6,fmin(1e6,value)):0;
    }
    return 1;
}
static void tap_process(MTAudioProcessingTapRef tap,CMItemCount requested,MTAudioProcessingTapFlags flags,AudioBufferList *buffers,CMItemCount *framesOut,MTAudioProcessingTapFlags *flagsOut){
    (void)flags;TapStorage *s=MTAudioProcessingTapGetStorage(tap);
    if(!s->valid){CMItemCount count=0;MTAudioProcessingTapFlags sourceFlags=0;OSStatus result=MTAudioProcessingTapGetSourceAudio(tap,requested,buffers,&sourceFlags,NULL,&count);*framesOut=result==noErr?count:0;*flagsOut=sourceFlags;return;}
    *framesOut=0;*flagsOut=0;
    if(requested==0)return;
    if(requested<0||requested>s->frames||buffers->mNumberBuffers!=(s->planar?s->channels:1)){LCDSPUnavailable(s->core,1);s->valid=0;return;}
    SourceContext context={tap,s};uint32_t count=0,sourceFlags=0;
    if(!LCPCMStreamRender(s->stream,tap_read,&context,(uint32_t)requested,&count,&sourceFlags)){LCDSPUnavailable(s->core,1);s->valid=0;return;}
    uint32_t stride=s->planar?1:s->channels;
    for(uint32_t ch=0;ch<s->channels;ch++){
        const float *input=LCPCMStreamChannel(s->stream,ch);
        for(uint32_t frame=0;frame<count;frame++)write_sample(s,s->output[s->planar?ch:0],(size_t)frame*stride+(s->planar?0:ch),input[frame]);
    }
    buffers->mNumberBuffers=s->planar?s->channels:1;
    for(uint32_t b=0;b<buffers->mNumberBuffers;b++){buffers->mBuffers[b].mData=s->output[b];buffers->mBuffers[b].mDataByteSize=count*stride*s->bytes;buffers->mBuffers[b].mNumberChannels=s->planar?1:s->channels;}
    *framesOut=count;
    if(sourceFlags&LCPCMStart)*flagsOut|=kMTAudioProcessingTapFlag_StartOfStream;
    if(sourceFlags&LCPCMEnd)*flagsOut|=kMTAudioProcessingTapFlag_EndOfStream;
}
MTAudioProcessingTapRef LCNativeAudioTapCreate(LCDSPCore *core){
    TapStorage *storage=calloc(1,sizeof *storage);if(!storage)return NULL;storage->core=core;LCDSPRetain(core);
    MTAudioProcessingTapCallbacks callbacks={kMTAudioProcessingTapCallbacksVersion_0,storage,tap_init,tap_finalize,tap_prepare,tap_unprepare,tap_process};
    MTAudioProcessingTapRef tap=NULL;OSStatus status=MTAudioProcessingTapCreate(kCFAllocatorDefault,&callbacks,kMTAudioProcessingTapCreationFlag_PostEffects,&tap);
    if(status!=noErr){LCDSPRelease(core);free(storage);return NULL;}return tap;
}
