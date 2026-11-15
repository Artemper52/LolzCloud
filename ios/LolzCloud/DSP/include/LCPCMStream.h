#ifndef LC_PCM_STREAM_H
#define LC_PCM_STREAM_H
#include "LCDSPCore.h"
typedef struct LCPCMStream LCPCMStream;
enum { LCPCMStart=1, LCPCMEnd=2 };
/* The C-only source callback writes at most requested planar float frames.
   All pointers are supplied by the prepared stream; no render allocation. */
typedef int (*LCPCMRead)(void *context,uint32_t requested,float *left,float *right,uint32_t *count,uint32_t *flags);
LCPCMStream *LCPCMStreamCreate(LCDSPCore *borrowedCore,uint32_t channels,uint32_t maximumFrames);
void LCPCMStreamDestroy(LCPCMStream *stream);
int LCPCMStreamRender(LCPCMStream *stream,LCPCMRead read,void *context,uint32_t requested,uint32_t *count,uint32_t *flags);
const float *LCPCMStreamChannel(const LCPCMStream *stream,uint32_t channel);
#endif
