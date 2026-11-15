#ifndef LC_PITCH_CORE_H
#define LC_PITCH_CORE_H
#include <stdint.h>
typedef struct LCPitchCore LCPitchCore;
/* Original streaming STFT implementation. All allocation and FFT tables belong
   to prepare/unprepare; frame/configure/reset never allocate or wait. */
LCPitchCore *LCPitchCreate(void);
void LCPitchDestroy(LCPitchCore *pitch);
int LCPitchPrepare(LCPitchCore *pitch,double sampleRate,uint32_t channels);
void LCPitchUnprepare(LCPitchCore *pitch);
void LCPitchReset(LCPitchCore *pitch);
void LCPitchConfigure(LCPitchCore *pitch,double ratio,int immediate);
/* Always returns exactly one stereo/mono frame. dry is delayed by latency;
   shifted uses the same timeline. Ratio one is an exact delayed dry bypass. */
void LCPitchFrame(LCPitchCore *pitch,const double input[2],double dry[2],double shifted[2]);
uint32_t LCPitchLatency(const LCPitchCore *pitch);
int LCPitchReady(const LCPitchCore *pitch);
double LCPitchRatio(const LCPitchCore *pitch);
#endif
