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
    /* Cumulative steady PCM energy since settings/discontinuity. A silent
       prefetch/tail block must not erase evidence of processed source audio. */
    float inputRMS, outputRMS, headroomDb;
    uint32_t normalizationMeasured, normalizationFrames, energyWindowFrames;
    float loudnessDb, normalizationGainDb, normalizationTargetDb, peakDb, limiterReductionDb;
} LCDSPMetrics;
/* First 2.56 seconds of 10 ms input/output energy after a discontinuity or
   settings change. Atomic diagnostic reads never copy PCM or enter rendering. */
/* Positive crossings use a +/-0.001 hysteresis on the first output channel.
   This diagnoses the PCM at this tap; it is not an assertion that the tap is
   downstream of AVPlayer's global time-pitch stage. */
typedef struct { uint32_t frames, positiveCrossings; float inputEnergy, outputEnergy; } LCDSPEnergyWindow;
LCDSPCore *LCDSPCreate(void);
void LCDSPRetain(LCDSPCore *core);
void LCDSPRelease(LCDSPCore *core);
/* A single control-thread producer. The realtime reader never waits for it. */
int LCDSPConfigure(LCDSPCore *core, int enabled, const float *gains, size_t count, float preampDb, uint32_t revision);
int LCDSPConfigureAdvanced(LCDSPCore *core, int enabled, const float *gains, size_t count, float preampDb,
                          float reverb, float echo, int normalization, uint32_t revision);
int LCDSPPrepare(LCDSPCore *core, double sampleRate, uint32_t channels, uint32_t maximumFrames);
void LCDSPUnprepare(LCDSPCore *core);
void LCDSPUnavailable(LCDSPCore *core, uint32_t reason);
void LCDSPReset(LCDSPCore *core);
/* Planar: stride=1. Interleaved stereo: right=left+1, stride=2. */
void LCDSPProcess(LCDSPCore *core, float *left, float *right, uint32_t frames, uint32_t stride);
LCDSPMetrics LCDSPReadMetrics(const LCDSPCore *core);
LCDSPEnergyWindow LCDSPReadEnergyWindow(const LCDSPCore *core, uint32_t index);
#ifdef __cplusplus
}
#endif
#endif
