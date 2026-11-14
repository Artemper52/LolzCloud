#ifndef LC_NATIVE_AUDIO_TAP_H
#define LC_NATIVE_AUDIO_TAP_H
#include <MediaToolbox/MediaToolbox.h>
#include "include/LCDSPCore.h"
MTAudioProcessingTapRef _Nullable LCNativeAudioTapCreate(LCDSPCore * _Nonnull core) CF_RETURNS_RETAINED;
#endif
