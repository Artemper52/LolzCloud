#ifndef LC_DSP_CORE_H
#define LC_DSP_CORE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct LCDSPCore LCDSPCore;
typedef struct {
    uint64_t processedFrames;
    uint32_t requestedRevision, appliedRevision;
    uint32_t prepared, unavailableReason, sampleRate, channels, activeBandMask;
    float inputRMS, outputRMS, headroomDb;
} LCDSPMetrics;
LCDSPCore *LCDSPCreate(void);
void LCDSPRetain(LCDSPCore *core);
void LCDSPRelease(LCDSPCore *core);
/* A single control-thread producer. The realtime reader never waits for it. */
int LCDSPConfigure(LCDSPCore *core, int enabled, const float *gains, size_t count, float preampDb, uint32_t revision);
int LCDSPPrepare(LCDSPCore *core, double sampleRate, uint32_t channels, uint32_t maximumFrames);
void LCDSPUnprepare(LCDSPCore *core);
void LCDSPUnavailable(LCDSPCore *core, uint32_t reason);
void LCDSPReset(LCDSPCore *core);
/* Planar: stride=1. Interleaved stereo: right=left+1, stride=2. */
void LCDSPProcess(LCDSPCore *core, float *left, float *right, uint32_t frames, uint32_t stride);
LCDSPMetrics LCDSPReadMetrics(const LCDSPCore *core);
#ifdef __cplusplus
}
#endif
#endif
