# iOS Simulator runtime verification

`node ios/tools/runtime-test.cjs` creates an isolated Xcode project and a fresh iPhone Simulator, then runs a hosted XCTest target against the four unchanged application Swift files. It removes only that simulator afterwards. Published IPA/simulator archives are not inputs or outputs of this test and must not be replaced by its testable build.

The tests exercise production `NativePlayer.importAudio` with generated PCM WAV files, private copies and index recovery, real AVURLAsset decoding/duration, AVPlayer progress/pause/seek/rate and early pause, natural-ended mixed local/cached-network queues and duplicate indices, and missing-local refusal. `Fixtures/tone.mp3` is a genuine 1.1-second mono MP3 generated with ffmpeg; the network cache row is seeded locally, so this does not claim successful HTTPS download validation.

One test loads the public HTTPS `/app/` in the actual `AppShell` WKWebView, sends genuine script messages, checks client/request ownership and the iframe and non-`/app` boundaries. It does not sign in, approve a device, or mutate a room/account. This test depends on the public website being reachable.

The JSON and `.xcresult` are uploaded separately as `LolzCloud-iOS-runtime-<run-id>`. A successful run is simulator evidence. It does not prove physical-device audio, lock-screen playback, a real external Document Provider's security-scoped grant, picker interaction, Apple signing, or personal OAuth. Sandbox import passes through the production scope/coordinator/copy code, but its source needs no external scope grant.

Apple references: [XCTest](https://developer.apple.com/documentation/xctest), [WKWebView JavaScript evaluation](https://developer.apple.com/documentation/webkit/wkwebview), [WKScriptMessage.frameInfo](https://developer.apple.com/documentation/webkit/wkscriptmessage/frameinfo).
