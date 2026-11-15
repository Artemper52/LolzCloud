import XCTest
import AVFoundation
import WebKit
import UIKit
@testable import LolzCloud

@MainActor private final class RuntimeFrameProbe: NSObject, WKScriptMessageHandler {
    var child: WKFrameInfo?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if !message.frameInfo.isMainFrame { child = message.frameInfo }
    }
}

// Hosted by the unchanged application, in a fresh disposable simulator. The
// sandbox fixture exercises importAudio, not a substituted file/cookie bridge.
@MainActor final class NativeRuntimeTests: XCTestCase {
    private var subjects: [NativePlayer] = []
    private var scratch: URL!
    private var records: [[String: Any]] = []
    private var savedEffectsPreference: Data?
    private var savedRatePreference: Data?
    private var offline: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Offline", isDirectory: true)
    }

    override func setUp() async throws {
        continueAfterFailure = false
        scratch = FileManager.default.temporaryDirectory.appendingPathComponent("runtime-"+UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        records = []
        savedEffectsPreference = UserDefaults.standard.data(forKey: "native_audio_effects_v1")
        savedRatePreference = UserDefaults.standard.data(forKey:"native_rate_settings_v1")
        UserDefaults.standard.removeObject(forKey:"native_rate_settings_v1")
    }

    override func tearDown() async throws {
        for player in subjects {
            player.stop()
            for track in player.tracks { player.removeDownload(track.id) }
            player.emit = nil
        }
        subjects = []
        if let savedEffectsPreference { UserDefaults.standard.set(savedEffectsPreference,forKey:"native_audio_effects_v1") }
        else { UserDefaults.standard.removeObject(forKey:"native_audio_effects_v1") }
        if let savedRatePreference { UserDefaults.standard.set(savedRatePreference,forKey:"native_rate_settings_v1") }
        else { UserDefaults.standard.removeObject(forKey:"native_rate_settings_v1") }
        if let scratch { try? FileManager.default.removeItem(at: scratch) }
    }

    private func subject() -> NativePlayer {
        let result = NativePlayer()
        subjects.append(result)
        result.emit = { [weak self] event, detail in
            var row = detail; row["event"] = event
            self?.records.append(row)
        }
        return result
    }

    private func avPlayer(_ subject: NativePlayer) throws -> AVPlayer {
        // Read-only inspection of the actual private AVPlayer: no test hook is
        // compiled into production and no playback callback is faked.
        try XCTUnwrap(Mirror(reflecting: subject).children.first { $0.label == "player" }?.value as? AVPlayer)
    }

    private func waitFor(_ message: String, timeout: TimeInterval = 10,
                         _ condition: () -> Bool) async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while !condition() {
            if ProcessInfo.processInfo.systemUptime >= deadline {
                XCTFail("Timed out: "+message)
                throw UserError.message(message)
            }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
    }

    private func settle(_ seconds: Double) async throws {
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private func wave(_ name: String, seconds: Double = 8, hz: Double = 440, sampleRate: Int = 16_000,
                      signal: ((Int) -> Double)? = nil) throws -> URL {
        let rate = sampleRate, count = Int(Double(rate)*seconds)
        var data = Data()
        func text(_ value: String) { data.append(contentsOf: value.utf8) }
        func u16(_ value: UInt16) { var v = value.littleEndian; Swift.withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        func u32(_ value: UInt32) { var v = value.littleEndian; Swift.withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        text("RIFF"); u32(UInt32(36+count*2)); text("WAVEfmt "); u32(16)
        u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate*2)); u16(2); u16(16)
        text("data"); u32(UInt32(count*2))
        for i in 0..<count {
            let value = signal.map { min(1,max(-1,$0(i)))*32767 } ?? sin(Double(i)*2*Double.pi*hz/Double(rate))*4000
            let sample = Int16(value)
            u16(UInt16(bitPattern: sample))
        }
        let file = scratch.appendingPathComponent(name+".wav")
        try data.write(to: file)
        return file
    }

    private func imported(_ subject: NativePlayer, _ urls: [URL]) async throws -> [SavedTrack] {
        let old = Set(subject.tracks.map(\.id))
        subject.importAudio(urls)
        try await waitFor("production importAudio completes") { !subject.importing }
        let added = subject.tracks.filter { !old.contains($0.id) }
        XCTAssertEqual(added.count, urls.count, String(describing: records.filter { $0["event"] as? String == "download" }))
        return added
    }

    private func importOne(_ subject: NativePlayer, _ url: URL) async throws -> SavedTrack {
        let rows = try await imported(subject, [url])
        return try XCTUnwrap(rows.first)
    }

    func testImportCopiesValidatedWAVAndRejectsInvalidAudio() async throws {
        let player = subject(), source = try wave("Проверка копирования")
        let before = try Data(contentsOf: source)
        let track = try await importOne(player, source)
        XCTAssertTrue(track.isLocal)
        XCTAssertTrue(MediaPolicy.localIdentifier(track.id))
        XCTAssertEqual(track.audioUrl, "")
        XCTAssertEqual(track.duration, 8, accuracy: 0.05)
        XCTAssertNil(track.object["fileExtension"])
        let destination = try XCTUnwrap(LocalAudioFiles.existing(track, in: offline))
        XCTAssertNotEqual(destination, source)
        XCTAssertEqual(try Data(contentsOf: destination), before)
        XCTAssertEqual(try Data(contentsOf: source), before)
        let asset = AVURLAsset(url: destination)
        let playable = try await asset.load(.isPlayable)
        let duration = try await asset.load(.duration).seconds
        let audio = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertTrue(playable); XCTAssertFalse(audio.isEmpty)
        XCTAssertEqual(duration, 8, accuracy: 0.05)
        let invalid = scratch.appendingPathComponent("not-audio.wav")
        try Data("This is not audio data".utf8).write(to: invalid)
        let count = player.tracks.count
        player.importAudio([invalid])
        try await waitFor("invalid import finishes") { !player.importing }
        XCTAssertEqual(player.tracks.count, count)
        XCTAssertTrue(records.contains { $0["event"] as? String == "download" && $0["state"] as? String == "error" })
        let recovery = subject()
        XCTAssertTrue(recovery.tracks.contains { $0.id == track.id })
    }

    func testActualAVPlayerProgressPauseSeekRateAndEarlyPause() async throws {
        let player = subject(), source = try wave("Transport")
        let track = try await importOne(player, source)
        let av = try avPlayer(player)
        player.configureQueue([track], index: 0, repeatMode: "off", shuffle: false)
        player.play(track, queueIndex: 0)
        try await waitFor("actual AVPlayer advances") { av.currentTime().seconds > 0.3 && av.rate > 0 }
        XCTAssertEqual(player.state, "playing")
        player.pause(); let pausedAt = av.currentTime().seconds
        player.rate(2)
        try await settle(0.3)
        XCTAssertEqual(av.rate, 0)
        XCTAssertEqual(av.currentTime().seconds, pausedAt, accuracy: 0.08)
        XCTAssertEqual(player.state, "paused")
        player.seek(2.25)
        try await waitFor("seek lands in paused AVPlayer") { abs(av.currentTime().seconds-2.25) < 0.12 }
        XCTAssertEqual(av.rate, 0)
        player.resume()
        try await waitFor("resume applies selected rate") { av.rate > 1.9 && av.currentTime().seconds > 2.7 }
        XCTAssertEqual(av.defaultRate, 2)
        player.stop()
        // Pause in the same turn, before readyToPlay/KVO can complete.
        player.play(track, queueIndex: 0); player.pause()
        try await waitFor("pending item becomes ready") { av.currentItem?.status == .readyToPlay }
        try await settle(0.4)
        XCTAssertEqual(av.rate, 0); XCTAssertEqual(player.state, "paused")
        XCTAssertLessThan(av.currentTime().seconds, 0.15)
    }

    func testActualEndedAdvancesMixedQueueAndPreservesDuplicateIndex() async throws {
        let importer = subject()
        let sources = [try wave("Queue A", seconds: 1.1), try wave("Queue B", seconds: 1.1)]
        let locals = try await imported(importer, sources)
        let network = try XCTUnwrap(SavedTrack(["id":"123456789", "title":"Cached network fixture", "artist":"Runtime test", "duration":1.1,
            "audioUrl":"https://lolzcloud.com/music/audio/123456789/aaaaaaaaaaaaaaaaaaaaaaaa.mp3"]))
        // Seeded cache fixture, not an HTTPS download test: genuine MP3 bytes
        // use the production private index and filename layout.
        let saved = offline.appendingPathComponent(try XCTUnwrap(LocalAudioFiles.filename(network)))
        let fixture = try XCTUnwrap(Bundle(for: NativeRuntimeTests.self).url(forResource: "tone", withExtension: "mp3"))
        try Data(contentsOf: fixture).write(to: saved)
        try JSONEncoder().encode(locals+[network]).write(to: offline.appendingPathComponent("index.json"), options: .atomic)
        importer.stop()
        let player = subject(), av = try avPlayer(player)
        let queue = [locals[0],network,locals[1],locals[0]]
        player.configureQueue(queue, index: 0, repeatMode: "off", shuffle: false)
        player.play(queue[0], queueIndex: 0)
        try await waitFor("real end advances to cached network") { player.current?.id == network.id && av.currentTime().seconds > 0.05 }
        XCTAssertTrue((av.currentItem?.asset as? AVURLAsset)?.url.isFileURL == true)
        try await waitFor("real end advances to second local") { player.current?.id == locals[1].id }
        try await waitFor("real end selects duplicate index three") {
            self.records.contains { $0["event"] as? String == "selection" && $0["index"] as? Int == 3 }
        }
        XCTAssertEqual(player.current?.id, locals[0].id)
        try await waitFor("last item ends without repeating", timeout: 5) { player.state == "ended" }
        XCTAssertEqual(av.rate, 0)
        player.play(locals[0], queueIndex: 3)
        try await waitFor("explicit duplicate selection plays") { av.currentTime().seconds > 0.1 && av.rate > 0 }
        XCTAssertEqual(records.last { $0["event"] as? String == "selection" }?["index"] as? Int, 3)
    }

    func testActualPitchPreferenceIsPausedPersistentAndSurvivesSeekAndDuplicateNext() async throws {
        let player=subject(),track=try await importOne(player,wave("Pitch settings",seconds:6,sampleRate:48000))
        let av=try avPlayer(player),client=UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        player.configureQueue([track,track],index:0,repeatMode:"off",shuffle:false)
        XCTAssertTrue(player.configureRate(["value":1.5,"preservesPitch":false,"revision":1],client:client,request:1))
        XCTAssertEqual(av.rate,0)
        player.play(track,queueIndex:0)
        try await waitFor("varispeed item really plays") { av.rate>1.4 && av.currentTime().seconds>0.2 }
        let item=try XCTUnwrap(av.currentItem)
        XCTAssertEqual(item.audioTimePitchAlgorithm,.varispeed)
        XCTAssertTrue(player.acceptClientIntent(client:client,request:2,handshake:false));player.pause()
        let position=av.currentTime().seconds
        XCTAssertTrue(player.configureRate(["value":0.75,"preservesPitch":true,"revision":2],client:client,request:2))
        try await settle(0.2)
        XCTAssertEqual(av.rate,0);XCTAssertEqual(av.currentTime().seconds,position,accuracy:0.08)
        XCTAssertTrue(av.currentItem===item);XCTAssertEqual(item.audioTimePitchAlgorithm,.spectral)
        XCTAssertFalse(player.configureRate(["value":2,"preservesPitch":false,"revision":1],client:client,request:2))
        XCTAssertFalse(player.configureRate(["value":2,"preservesPitch":false,"revision":3],client:client,request:500))
        XCTAssertFalse(player.configureRate(["value":2],client:client,request:2),"A late legacy command must not undo negotiated settings")
        XCTAssertEqual(av.defaultRate,0.75)
        let restored=subject(),restoredAV=try avPlayer(restored)
        XCTAssertEqual(restoredAV.defaultRate,0.75);XCTAssertEqual(restoredAV.rate,0)
        let stored=try XCTUnwrap(UserDefaults.standard.data(forKey:"native_rate_settings_v1"))
        XCTAssertTrue(try JSONDecoder().decode(NativeRatePreferences.self,from:stored).preservesPitch)
        player.resume()
        try await waitFor("spectral resume keeps the selected slow rate") { av.rate>0.7 && av.rate<0.8 && av.currentTime().seconds>position+0.1 }
        player.seek(2)
        try await waitFor("actual seek preserves pitch mode") { av.currentTime().seconds>1.95 && av.currentTime().seconds<2.7 }
        XCTAssertEqual(av.currentItem?.audioTimePitchAlgorithm,.spectral)
        player.seek(5.95)
        try await waitFor("actual EOF advances to the exact duplicate occurrence") {
            self.records.last{$0["event"] as? String == "selection"}?["index"] as? Int == 1 && av.currentItem !== item && av.rate>0
        }
        XCTAssertEqual(av.currentItem?.audioTimePitchAlgorithm,.spectral);XCTAssertEqual(av.defaultRate,0.75)
        XCTAssertEqual(records.last{$0["event"] as? String == "playback"}?["preservesPitch"] as? Bool,true)
        player.pause()
        XCTAssertEqual(records.last{$0["event"] as? String == "playback"}?["rateAppliedRevision"] as? Int,0)
        player.play(track,queueIndex:1)
        let pendingItem=av.currentItem
        let before=try XCTUnwrap(Mirror(reflecting:player).children.first{$0.label == "intent"}?.value as? PlaybackIntent).generation
        XCTAssertTrue(player.configureRate(["value":1.25,"preservesPitch":false,"revision":3],client:client,request:2))
        let after=try XCTUnwrap(Mirror(reflecting:player).children.first{$0.label == "intent"}?.value as? PlaybackIntent).generation
        XCTAssertEqual(before,after);XCTAssertTrue(av.currentItem === pendingItem)
        try await waitFor("settings during pending item preparation do not cancel or rearm playback") { av.rate>1.2 && av.currentTime().seconds>0.2 }
        XCTAssertEqual(av.currentItem?.audioTimePitchAlgorithm,.varispeed)
        XCTAssertEqual(records.last{$0["event"] as? String == "selection"}?["index"] as? Int,1)
    }

    func testActualAVPlayerRateAlgorithmsMustBeProvenByMeasuredPCM() async throws {
        let importer=subject(),local=try await importOne(importer,wave("Pitch 910 Hz",seconds:4,hz:910,sampleRate:48000))
        let network=try XCTUnwrap(SavedTrack(["id":"123456788","title":"Seeded rate MP3","artist":"Runtime test","duration":1.1,
            "audioUrl":"https://lolzcloud.com/music/audio/123456788/aaaaaaaaaaaaaaaaaaaaaaaa.mp3"]))
        let fixture=try XCTUnwrap(Bundle(for:NativeRuntimeTests.self).url(forResource:"tone",withExtension:"mp3"))
        try Data(contentsOf:fixture).write(to:offline.appendingPathComponent(try XCTUnwrap(LocalAudioFiles.filename(network))))
        try JSONEncoder().encode([local,network]).write(to:offline.appendingPathComponent("index.json"),options:.atomic)
        let player=subject(),av=try avPlayer(player),client=UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        XCTAssertTrue(player.configureEffects(["enabled":false,"gains":[0,0,0,0,0],"preampDb":0],revision:1,client:client,request:1))
        var observations=[[String:Any]](),revision=0
        func trace(_ attempt: [String:Any], attach: Bool = false) {
            let payload: [String:Any] = ["scope":"Real production AVPlayer tap; frequency, not merely item properties, must demonstrate rate processing.",
                "observations":observations,"attempt":attempt]
            guard let data=try? JSONSerialization.data(withJSONObject:payload,options:[.sortedKeys]), let text=String(data:data,encoding:.utf8) else { return }
            print("RATE_PITCH_PROBE_JSON="+text)
            if attach {
                let attachment=XCTAttachment(data:data,uniformTypeIdentifier:"public.json")
                attachment.name="actual-avplayer-rate-pitch-probe";attachment.lifetime = .keepAlways;add(attachment)
            }
        }
        func snapshot(_ source: String,_ rate: Double,_ preserve: Bool) -> [String:Any] {
            let metric=player.audioEffects.measurement,seconds=av.currentTime().seconds
            return ["source":source,"rate":rate,"preservesPitch":preserve,"state":player.state,"error":player.error,
                "itemStatus":av.currentItem?.status.rawValue ?? -1,"itemError":av.currentItem?.error?.localizedDescription ?? "",
                "time":seconds.isFinite ? seconds:0,"actualRate":av.rate,"timeControlStatus":av.timeControlStatus.rawValue,
                "processedFrames":metric?.processedFrames ?? 0,"prepared":metric?.prepared ?? 0,
                "unavailableReason":metric?.unavailableReason ?? 0,"frame55":player.audioEffects.energyWindow(55)?.frames ?? 0]
        }
        for track in [local,network] {
            for (rate,preserve) in [(1.0,true),(1.5,false),(1.5,true),(0.75,false),(0.75,true)] {
                revision+=1
                XCTAssertTrue(player.configureRate(["value":rate,"preservesPitch":preserve,"revision":revision],client:client,request:1))
                player.play(track)
                let source=track.isLocal ? "localWAV":"seededGenuineMP3"
                trace(snapshot(source,rate,preserve))
                let deadline=ProcessInfo.processInfo.systemUptime+12
                while av.currentItem?.status != .readyToPlay || (player.audioEffects.energyWindow(55)?.frames ?? 0)==0 {
                    if player.state == "error" || ProcessInfo.processInfo.systemUptime >= deadline {
                        // Record before XCTFail: continueAfterFailure=false may
                        // abort this test before a Swift catch/defer can run.
                        trace(snapshot(source,rate,preserve),attach:true)
                        XCTFail("PCM probe did not become ready for \(source), rate \(rate), preservesPitch \(preserve): \(player.error)")
                        return
                    }
                    try await Task.sleep(nanoseconds:25_000_000)
                }
                let metric=try XCTUnwrap(player.audioEffects.measurement)
                let rows=(20..<50).compactMap{player.audioEffects.energyWindow($0)}
                let frames=rows.reduce(0.0){$0+Double($1.frames)}/Double(max(1,metric.channels))
                let crossings=rows.reduce(0.0){$0+Double($1.positiveCrossings)}
                let hz=crossings*Double(metric.sampleRate)/max(1,frames)
                observations.append(["source":source,"rate":rate,"preservesPitch":preserve,
                    "tapHz":hz,"sampleRate":metric.sampleRate,"frames":frames,"crossings":crossings,
                    "algorithm":av.currentItem?.audioTimePitchAlgorithm.rawValue ?? ""])
                trace(snapshot(source,rate,preserve))
                // Each play creates a fresh real item/tap. Keep one audio
                // session for the matrix instead of doing ten synchronous OS
                // deactivate/reactivate cycles as a meter precondition.
                player.pause()
            }
        }
        trace(["phase":"matrix-collected"],attach:true)
        for source in ["localWAV","seededGenuineMP3"] {
            let rows=observations.filter{$0["source"] as? String == source},baseline=try XCTUnwrap(rows.first?["tapHz"] as? Double)
            XCTAssertGreaterThan(baseline,100)
            for row in rows.dropFirst() {
                let rate=try XCTUnwrap(row["rate"] as? Double),preserve=try XCTUnwrap(row["preservesPitch"] as? Bool),hz=try XCTUnwrap(row["tapHz"] as? Double)
                let expected=baseline*(preserve ? 1:rate)
                XCTAssertEqual(hz,expected,accuracy:max(10,expected*0.04),"If this fails with unchanged pitch in varispeed, the tap is upstream; these PCM measurements cannot prove final AVPlayer pitch.")
            }
        }
    }

    private func independentPitch(_ player: NativePlayer,_ pitch: Double,revision: Int,client: String,request: Int = 1) {
        XCTAssertTrue(player.configureEffects(["enabled":false,"gains":[12,0,0,0,0],"preampDb":-6,
            "reverb":0.4,"echo":0.3,"normalization":true,"pitch":pitch],revision:revision,client:client,request:request))
    }

    func testActualIndependentPitchMeasuresDownstreamPCMAtDifferentTempos() async throws {
        let importer=subject(),local=try await importOne(importer,wave("Independent 910Hz",seconds:6,hz:910,sampleRate:48000))
        let network=try XCTUnwrap(SavedTrack(["id":"123456787","title":"Independent cached MP3","artist":"Runtime fixture","duration":1.1,
            "audioUrl":"https://lolzcloud.com/music/audio/123456787/aaaaaaaaaaaaaaaaaaaaaaaa.mp3"]))
        let fixture=try XCTUnwrap(Bundle(for:NativeRuntimeTests.self).url(forResource:"tone",withExtension:"mp3"))
        try Data(contentsOf:fixture).write(to:offline.appendingPathComponent(try XCTUnwrap(LocalAudioFiles.filename(network))))
        try JSONEncoder().encode([local,network]).write(to:offline.appendingPathComponent("index.json"),options:.atomic)
        let player=subject(),av=try avPlayer(player),client=UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        XCTAssertEqual(player.capabilities["effectsSchema"] as? Int,2,"Released SW7 must retain schema2 discovery")
        XCTAssertEqual(player.capabilities["maxEffectsSchema"] as? Int,3)
        var revision=0,observations=[[String:Any]]()
        func trace(_ phase: String,attach: Bool = false) {
            let metric=player.audioEffects.measurement
            let payload: [String:Any] = ["scope":"Actual production AVPlayer post-effects tap, including its own spectral tempo stage and C independent pitch. Seeded MP3 is not an HTTPS download proof.","phase":phase,"observations":observations,
                "state":player.state,"error":player.error,"processedFrames":metric?.processedFrames ?? 0,"pitchProcessedFrames":metric?.pitchProcessedFrames ?? 0,
                "latencyFrames":metric?.pitchLatencyFrames ?? 0,"actualRate":av.rate,"time":av.currentTime().seconds.isFinite ? av.currentTime().seconds:0]
            guard let data=try? JSONSerialization.data(withJSONObject:payload,options:[.sortedKeys]),let text=String(data:data,encoding:.utf8) else { return }
            print("INDEPENDENT_PITCH_PROBE_JSON="+text)
            if attach { let item=XCTAttachment(data:data,uniformTypeIdentifier:"public.json");item.name="actual-independent-pitch-probe";item.lifetime = .keepAlways;add(item) }
        }
        for track in [local,network] {
            let source=track.isLocal ? "localWAV":"seededGenuineMP3"
            var baselineHz=0.0,baselineRMS=0.0
            for (tempo,pitch) in [(1.0,1.0),(0.75,0.5),(0.75,1.25),(0.75,2.0),(1.5,0.5),(1.5,1.25),(1.5,2.0)] {
                revision+=1
                XCTAssertTrue(player.configureRate(["value":tempo,"preservesPitch":true,"revision":revision],client:client,request:1))
                independentPitch(player,pitch,revision:revision,client:client)
                player.play(track)
                let deadline=ProcessInfo.processInfo.systemUptime+12
                while (player.audioEffects.energyWindow(55)?.frames ?? 0)==0 || player.audioEffects.status["appliedRevision"] as? Int != revision {
                    if player.state == "error" || ProcessInfo.processInfo.systemUptime >= deadline { trace("failed-"+source,attach:true);XCTFail("Actual independent pitch PCM did not arrive");return }
                    try await settle(0.025)
                }
                let metric=try XCTUnwrap(player.audioEffects.measurement),windows=(20..<50).compactMap{player.audioEffects.energyWindow($0)}
                let frames=windows.reduce(0.0){$0+Double($1.frames)}/Double(max(1,metric.channels)),crossings=windows.reduce(0.0){$0+Double($1.positiveCrossings)}
                let hz=crossings*Double(metric.sampleRate)/max(1,frames),rms=sqrt(windows.reduce(0.0){$0+Double($1.outputEnergy)}/max(1,frames*Double(metric.channels)))
                if pitch==1 { baselineHz=hz;baselineRMS=rms }
                let expected=baselineHz*pitch
                observations.append(["source":source,"tempo":tempo,"pitch":pitch,"expectedHz":expected,"measuredHz":hz,"rms":rms,"baselineRMS":baselineRMS,"frames":frames,"sampleRate":metric.sampleRate,"actualRate":av.rate,"position":av.currentTime().seconds])
                trace("measured-"+source)
                XCTAssertEqual(hz,expected,accuracy:max(8,expected*0.04),"Actual PCM, not a slider/item property, must establish independent tone")
                XCTAssertGreaterThan(rms,baselineRMS*0.68);XCTAssertLessThan(rms,baselineRMS*1.48)
                XCTAssertFalse(player.audioEffects.settings.enabled,"Tone must not enable the user's saved EQ")
                XCTAssertEqual(metric.normalizationFrames,0)
                XCTAssertEqual((player.audioEffects.status["capabilities"] as? [String:Bool])?["pitch"],true)
                if pitch != 1 { XCTAssertGreaterThan(metric.pitchProcessedFrames,0) }
                XCTAssertEqual(av.currentItem?.audioTimePitchAlgorithm,.spectral)
                XCTAssertEqual(av.currentItem?.duration.seconds ?? 0,track.duration,accuracy:0.2)
                if track.isLocal && pitch==1.25 {
                    let start=av.currentTime().seconds,wall=ProcessInfo.processInfo.systemUptime
                    try await settle(0.16)
                    let elapsed=ProcessInfo.processInfo.systemUptime-wall,advance=av.currentTime().seconds-start
                    XCTAssertEqual(advance,elapsed*tempo,accuracy:0.09,"Pitch must leave the actual AVPlayer media clock at its selected tempo")
                }
                player.pause()
            }
        }
        trace("matrix-passed",attach:true)
    }

    func testActualIndependentPitchPauseSeekDuplicateQueueAndLegacyACK() async throws {
        let player=subject(),track=try await importOne(player,wave("Pitch lifecycle",seconds:4,hz:910,sampleRate:48000))
        let av=try avPlayer(player),client=UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        XCTAssertTrue(player.configureEffects(["enabled":false,"gains":[0,0,0,0,0],"preampDb":0],revision:1,client:client,request:1))
        XCTAssertEqual((player.audioEffects.status["config"] as? [String:Any])?.count,3)
        XCTAssertTrue(player.configureEffects(["enabled":false,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0,"echo":0,"normalization":false],revision:2,client:client,request:1))
        XCTAssertEqual((player.audioEffects.status["config"] as? [String:Any])?.count,6)
        XCTAssertEqual((player.audioEffects.status["capabilities"] as? [String:Bool])?["pitch"],false)
        player.configureQueue([track,track],index:0,repeatMode:"off",shuffle:false)
        let generation=try XCTUnwrap(Mirror(reflecting:player).children.first{$0.label=="intent"}?.value as? PlaybackIntent).generation
        independentPitch(player,1.5,revision:3,client:client)
        XCTAssertEqual(try XCTUnwrap(Mirror(reflecting:player).children.first{$0.label=="intent"}?.value as? PlaybackIntent).generation,generation)
        XCTAssertEqual(av.rate,0)
        player.play(track,queueIndex:0)
        let pendingGeneration=try XCTUnwrap(Mirror(reflecting:player).children.first{$0.label=="intent"}?.value as? PlaybackIntent).generation
        independentPitch(player,1.25,revision:4,client:client)
        XCTAssertEqual(try XCTUnwrap(Mirror(reflecting:player).children.first{$0.label=="intent"}?.value as? PlaybackIntent).generation,pendingGeneration)
        try await waitFor("real independent pitch plays") { (player.audioEffects.measurement?.pitchProcessedFrames ?? 0)>1024 && av.currentTime().seconds>0.15 }
        let item=av.currentItem
        player.pause();let position=av.currentTime().seconds
        independentPitch(player,0.5,revision:5,client:client)
        try await settle(0.2)
        XCTAssertEqual(av.rate,0);XCTAssertEqual(av.currentTime().seconds,position,accuracy:0.08);XCTAssertTrue(av.currentItem===item)
        XCTAssertNotEqual(player.audioEffects.status["appliedRevision"] as? Int,5)
        XCTAssertFalse(player.configureEffects(["enabled":false,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0,"echo":0,"normalization":false,"pitch":2],revision:99,client:client,request:500))
        let restored=subject();XCTAssertEqual(restored.audioEffects.settings.pitch,0.5);XCTAssertFalse(restored.audioEffects.settings.enabled);XCTAssertEqual(try avPlayer(restored).rate,0)
        XCTAssertTrue(player.acceptClientIntent(client:client,request:2,handshake:false))
        independentPitch(player,0.5,revision:5,client:client,request:2)
        XCTAssertEqual(av.rate,0)
        player.resume()
        try await waitFor("same tagged settings apply on explicit resume") { player.audioEffects.status["appliedRevision"] as? Int == 5 && av.rate>0 }
        player.seek(2)
        try await waitFor("seek retains pitch and exact item") { av.currentTime().seconds>1.95 && av.currentTime().seconds<2.7 }
        XCTAssertEqual(player.audioEffects.settings.pitch,0.5)
        player.seek(3.95)
        try await waitFor("real EOF keeps duplicate occurrence and pitch") { self.records.last{$0["event"] as? String == "selection"}?["index"] as? Int == 1 && av.currentItem !== item && av.rate>0 }
        XCTAssertEqual(player.audioEffects.settings.pitch,0.5);XCTAssertFalse(player.audioEffects.settings.enabled)
        XCTAssertEqual((player.audioEffects.status["config"] as? [String:Any])?.count,7)
    }

    func testActualTapLatencyCompensationKeepsFirstAndLastPCMAndEOFDuration() async throws {
        let player=subject(),client=UUID().uuidString.lowercased(),rate=48_000
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        XCTAssertTrue(player.configureRate(["value":1,"preservesPitch":false,"revision":1],client:client,request:1))
        let source=try wave("Aligned first and last",seconds:2,sampleRate:rate,signal:{ frame in frame<48 ? 0.25:frame>=2*rate-48 ? -0.25:0 })
        let track=try await importOne(player,source),av=try avPlayer(player)
        independentPitch(player,1,revision:1,client:client)
        player.configureQueue([track],index:0,repeatMode:"off",shuffle:false);player.play(track,queueIndex:0)
        try await waitFor("actual AVPlayer finishes the compensated stream",timeout:6) { player.state=="ended" }
        let metric=try XCTUnwrap(player.audioEffects.measurement)
        try attachEnergyTrace(player,name:"actual-tap-compensated-first-last")
        XCTAssertGreaterThan(energy(player,0..<3),0.01)
        XCTAssertGreaterThan(energy(player,197..<202),0.01,"The lookahead must be flushed before reporting EOF")
        XCTAssertEqual(Double(metric.processedFrames)/Double(metric.sampleRate),2,accuracy:0.015)
        XCTAssertEqual(av.currentTime().seconds,2,accuracy:0.08);XCTAssertEqual(av.rate,0)
    }

    func testDeletedLocalCannotFallbackToNetworkOrPlayCallerURL() async throws {
        let player = subject(), source = try wave("Deleted")
        let track = try await importOne(player, source)
        let path = try XCTUnwrap(LocalAudioFiles.existing(track, in: offline))
        try FileManager.default.removeItem(at: path)
        player.configureQueue([track], index: 0, repeatMode: "off", shuffle: false)
        player.play(track, prepare: true, queueIndex: 0)
        try await settle(0.2)
        XCTAssertEqual(player.state, "error")
        XCTAssertTrue(player.error.contains("Локальный файл"))
        let av = try avPlayer(player)
        XCTAssertNil(av.currentItem); XCTAssertEqual(av.rate, 0)
        var forged = track.object; forged["audioUrl"] = "https://lolzcloud.com/music/audio/1/aaaaaaaaaaaaaaaaaaaaaaaa.mp3"
        XCTAssertNil(SavedTrack(forged))
        player.resume(); try await settle(0.2)
        XCTAssertEqual(player.state, "error"); XCTAssertNil(av.currentItem)
    }

    private func effects(_ player: NativePlayer, client: String, request: Int = 1, revision: Int,
                         gains: [Double] = [0,0,0,0,0], preamp: Double = 0, enabled: Bool = true) {
        XCTAssertTrue(player.configureEffects(["enabled":enabled,"gains":gains,"preampDb":preamp],revision:revision,client:client,request:request))
    }

    func testActualLocalTapChangesSpectrumAndPausedSettingsDoNotResume() async throws {
        let player=subject(),client=UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        let low=try wave("EQ 910",seconds:4,hz:910,sampleRate:44100),high=try wave("EQ 6000",seconds:4,hz:6000,sampleRate:44100)
        let tracks=try await imported(player,[low,high]),av=try avPlayer(player)
        player.configureQueue(tracks,index:0,repeatMode:"off",shuffle:false)
        effects(player,client:client,revision:1,gains:[0,0,12,0,0])
        player.play(tracks[0],queueIndex:0)
        // Update during the actual asynchronous per-item metadata/tap setup.
        // It must neither replace this selection nor cancel/rearm its transport.
        effects(player,client:client,revision:2,gains:[0,0,10,0,0])
        try await waitFor("real local AVPlayer tap processes selected audio") {
            (player.audioEffects.measurement?.processedFrames ?? 0)>6000 && (player.audioEffects.measurement?.inputRMS ?? 0)>0.01 && player.audioEffects.status["state"] as? String == "applied"
        }
        XCTAssertEqual(player.current?.id,tracks[0].id)
        let near=try XCTUnwrap(player.audioEffects.measurement)
        XCTAssertGreaterThan(near.inputRMS,0.01)
        let nearRatio=near.outputRMS/near.inputRMS
        player.play(tracks[1],queueIndex:1)
        player.seek(1.25);player.pause()
        effects(player,client:client,revision:2,gains:[0,0,10,0,0])
        XCTAssertEqual(av.rate,0)
        player.resume()
        try await waitFor("pending per-item prepare resumes from requested seek") {
            av.rate>0 && (player.audioEffects.measurement?.processedFrames ?? 0)>1024
        }
        XCTAssertGreaterThan(av.currentTime().seconds,1.1,"Pause/resume during asynchronous tap setup must preserve the requested seek")
        try await waitFor("second local track has a new real processed tap") {
            (player.audioEffects.measurement?.processedFrames ?? 0)>6000 && (player.audioEffects.measurement?.inputRMS ?? 0)>0.01 && player.audioEffects.status["state"] as? String == "applied"
        }
        let far=try XCTUnwrap(player.audioEffects.measurement)
        XCTAssertGreaterThan(nearRatio/(far.outputRMS/far.inputRMS),2.5,"The actual AVPlayer PCM must show frequency-selective EQ, not just a control acknowledgement")
        XCTAssertEqual(player.audioEffects.status["appliedRevision"] as? Int,2)
        player.pause();let position=av.currentTime().seconds
        effects(player,client:client,revision:3,preamp:-6)
        XCTAssertNotEqual(player.audioEffects.status["state"] as? String,"applied")
        try await settle(0.25)
        XCTAssertEqual(av.rate,0);XCTAssertEqual(player.state,"paused")
        XCTAssertEqual(av.currentTime().seconds,position,accuracy:0.08)
        XCTAssertFalse(player.configureEffects(["enabled":true,"gains":[0,0,0,0,0],"preampDb":0],revision:99,client:client,request:500))
        XCTAssertEqual(player.audioEffects.revision,3)
        XCTAssertTrue(player.acceptClientIntent(client:client,request:2,handshake:false))
        effects(player,client:client,request:2,revision:3,preamp:-6)
        XCTAssertEqual(av.rate,0,"Resending settings for a new transport owner must not start audio")
        player.resume()
        try await waitFor("paused configuration is consumed by real frames on resume") { player.audioEffects.status["state"] as? String == "applied" && av.rate>0 }
        try await settle(0.15)
        let preamp=try XCTUnwrap(player.audioEffects.measurement)
        XCTAssertEqual(preamp.outputRMS/preamp.inputRMS,Float(pow(10,-6.0/20)),accuracy:0.025)
    }

    func testActualCachedMP3TapMeasuresPreampOnDecodedPCM() async throws {
        let seed=subject()
        let network=try XCTUnwrap(SavedTrack(["id":"223456789","title":"Seeded real MP3","artist":"Runtime test","duration":1.1,
            "audioUrl":"https://lolzcloud.com/music/audio/223456789/bbbbbbbbbbbbbbbbbbbbbbbb.mp3"]))
        let fixture=try XCTUnwrap(Bundle(for:NativeRuntimeTests.self).url(forResource:"tone",withExtension:"mp3"))
        let destination=offline.appendingPathComponent(try XCTUnwrap(LocalAudioFiles.filename(network)))
        try Data(contentsOf:fixture).write(to:destination)
        try JSONEncoder().encode([network]).write(to:offline.appendingPathComponent("index.json"),options:.atomic)
        seed.stop()
        let player=subject(),client=UUID().uuidString.lowercased(),av=try avPlayer(player)
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        effects(player,client:client,revision:1,preamp:-6)
        player.configureQueue([network],index:0,repeatMode:"off",shuffle:false)
        player.play(network,queueIndex:0)
        try await waitFor("genuine cached MP3 traverses real AVPlayer audio tap") {
            (player.audioEffects.measurement?.processedFrames ?? 0)>3000 && (player.audioEffects.measurement?.inputRMS ?? 0)>0.01 && player.audioEffects.status["state"] as? String == "applied"
        }
        XCTAssertTrue((av.currentItem?.asset as? AVURLAsset)?.url.isFileURL == true)
        let measurement=try XCTUnwrap(player.audioEffects.measurement)
        XCTAssertGreaterThan(measurement.inputRMS,0.01)
        XCTAssertEqual(measurement.outputRMS/measurement.inputRMS,Float(pow(10,-6.0/20)),accuracy:0.025)
        XCTAssertTrue((player.audioEffects.status["capabilities"] as? [String:Bool])?["normalization"] == false)
    }

    private func advancedEffects(_ player: NativePlayer, client: String, request: Int = 1, revision: Int,
                                 reverb: Double = 0, echo: Double = 0, normalization: Bool = false) {
        XCTAssertTrue(player.configureEffects(["enabled":true,"gains":[0,0,0,0,0],"preampDb":0,
            "reverb":reverb,"echo":echo,"normalization":normalization],revision:revision,client:client,request:request))
    }

    private func energy(_ player: NativePlayer, _ range: Range<Int>, input: Bool = false) -> Double {
        range.reduce(0) { sum,index in
            guard let value = player.audioEffects.energyWindow(index) else { return sum }
            return sum+Double(input ? value.inputEnergy : value.outputEnergy)
        }
    }
    private func attachEnergyTrace(_ player: NativePlayer, name: String) throws {
        let rows: [[String:Any]] = (0..<256).compactMap { index in
            guard let value = player.audioEffects.energyWindow(index), value.frames>0 else { return nil }
            return ["bin":index,"samples":value.frames,"inputEnergy":value.inputEnergy,"outputEnergy":value.outputEnergy]
        }
        let metric = try XCTUnwrap(player.audioEffects.measurement)
        let detail: [String:Any] = ["sampleRate":metric.sampleRate,"channels":metric.channels,
            "windowFrames":metric.energyWindowFrames,"processedFrames":metric.processedFrames,"windows":rows]
        let attachment = XCTAttachment(data:try JSONSerialization.data(withJSONObject:detail,options:[.prettyPrinted,.sortedKeys]),uniformTypeIdentifier:"public.json")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testActualTapEchoImpulseAndReverbTail() async throws {
        let player = subject(), client = UUID().uuidString.lowercased(), rate = 48_000
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        let source = try wave("Real tap impulse",seconds:4,sampleRate:rate,signal: { $0==rate/10 ? 0.25 : 0 })
        let track = try await importOne(player,source), av = try avPlayer(player)
        player.configureQueue([track],index:0,repeatMode:"off",shuffle:false)
        advancedEffects(player,client:client,revision:1,echo:0.8)
        player.play(track,queueIndex:0)
        try await waitFor("real AVPlayer echo produces temporal energy",timeout:12) {
            guard let m = player.audioEffects.measurement else { return false }
            return m.processedFrames > UInt64(m.sampleRate)*2 && av.rate>0 && player.audioEffects.status["state"] as? String == "applied"
        }
        try attachEnergyTrace(player,name:"actual-avplayer-echo-energy")
        let inputBins = (0..<100).map { self.energy(player,$0..<($0+1),input:true) }
        let impulse = try XCTUnwrap(inputBins.indices.max { inputBins[$0]<inputBins[$1] })
        XCTAssertGreaterThan(inputBins[impulse],0.001)
        let inputEnergy = energy(player,max(0,impulse-1)..<(impulse+2),input:true)
        let echo = energy(player,(impulse+27)..<(impulse+30))
        XCTAssertEqual(energy(player,(impulse+27)..<(impulse+30),input:true),0,accuracy:0.000001)
        XCTAssertEqual(echo/inputEnergy,pow(0.8*0.6,2),accuracy:0.04,"Actual decoded PCM must echo about 280 ms after its measured input impulse")
        XCTAssertGreaterThan(energy(player,(impulse+55)..<(impulse+58)),0.00001)
        XCTAssertTrue((player.audioEffects.status["capabilities"] as? [String:Bool])?["echo"] == true)
        player.stop(); advancedEffects(player,client:client,revision:2,reverb:0.8)
        player.play(track,queueIndex:0)
        try await waitFor("real AVPlayer reverb produces a decaying tail",timeout:12) {
            guard let m = player.audioEffects.measurement else { return false }
            return m.processedFrames > UInt64(m.sampleRate)*2 && player.audioEffects.status["state"] as? String == "applied"
        }
        try attachEnergyTrace(player,name:"actual-avplayer-reverb-energy")
        // A tap's first block is not an absolute WAV/AVPlayer clock origin.
        // Locate the source impulse in this real render, then test output in
        // subsequent source-silent windows. No synthetic frames or callbacks.
        let reverbInput = (0..<130).map { self.energy(player,$0..<($0+1),input:true) }
        let reverbImpulse = try XCTUnwrap(reverbInput.indices.max { reverbInput[$0]<reverbInput[$1] })
        XCTAssertGreaterThan(reverbInput[reverbImpulse],0.001)
        try await waitFor("tap has processed the complete relative reverb tail") { (player.audioEffects.energyWindow(reverbImpulse+119)?.frames ?? 0)>0 }
        try attachEnergyTrace(player,name:"actual-avplayer-reverb-complete-relative-tail")
        let early = energy(player,(reverbImpulse+10)..<(reverbImpulse+40)), late = energy(player,(reverbImpulse+90)..<(reverbImpulse+120))
        XCTAssertEqual(energy(player,(reverbImpulse+2)..<(reverbImpulse+120),input:true),0,accuracy:0.000001)
        XCTAssertGreaterThan(early,0.000001); XCTAssertGreaterThan(late,0); XCTAssertLessThan(late,early*0.1)
        XCTAssertTrue((player.audioEffects.status["capabilities"] as? [String:Bool])?["reverb"] == true)
    }

    func testActualTapNormalizationConvergesWithoutChangingPausedTransport() async throws {
        let player = subject(), client = UUID().uuidString.lowercased(), sampleRate = 48_000
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        let source = try wave("Real normalization",seconds:14,sampleRate:sampleRate,
            signal: { sin(Double($0)*2*Double.pi*1000/Double(sampleRate))*0.025 })
        let track = try await importOne(player,source), av = try avPlayer(player)
        player.configureQueue([track],index:0,repeatMode:"off",shuffle:false)
        advancedEffects(player,client:client,revision:1,normalization:true)
        player.play(track,queueIndex:0)
        try await waitFor("real PCM normalizer measures gated energy and converges",timeout:25) {
            guard let m = player.audioEffects.measurement else { return false }
            return m.normalizationMeasured != 0 && m.normalizationGainDb>7.5 && m.normalizationFrames>m.sampleRate*11
        }
        let measured = try XCTUnwrap(player.audioEffects.measurement)
        XCTAssertEqual(measured.normalizationTargetDb,8,accuracy:0.02)
        XCTAssertEqual(measured.normalizationGainDb,8,accuracy:0.5)
        XCTAssertGreaterThan(measured.outputRMS/measured.inputRMS,1.3)
        XCTAssertTrue(measured.loudnessDb.isFinite)
        XCTAssertTrue((player.audioEffects.status["capabilities"] as? [String:Bool])?["normalization"] == true)
        player.pause(); let position = av.currentTime().seconds
        XCTAssertTrue(player.acceptClientIntent(client:client,request:2,handshake:false))
        advancedEffects(player,client:client,request:2,revision:2,reverb:0.4,echo:0.5)
        try await settle(0.35)
        XCTAssertEqual(av.rate,0); XCTAssertEqual(player.state,"paused")
        XCTAssertEqual(av.currentTime().seconds,position,accuracy:0.08)
        XCTAssertEqual(player.current?.id,track.id)
        XCTAssertFalse(player.configureEffects(["enabled":true,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0.8,"echo":0.8,"normalization":true],revision:50,client:client,request:500))
    }

    func testAdvancedSettingsFollowRealDuplicateQueueWithoutDoubleAdvance() async throws {
        let player = subject(), client = UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        let tracks = try await imported(player,[wave("Advanced queue A",seconds:0.8),wave("Advanced queue B",seconds:0.8)])
        let queue = [tracks[0],tracks[1],tracks[0]]
        player.configureQueue(queue,index:0,repeatMode:"off",shuffle:false)
        advancedEffects(player,client:client,revision:1,reverb:0.2,echo:0.3,normalization:true)
        player.play(queue[0],queueIndex:0)
        advancedEffects(player,client:client,revision:2,reverb:0.5,echo:0.4,normalization:true)
        try await waitFor("advanced queue ends at its duplicate occurrence",timeout:12) {
            player.state == "ended" && self.records.contains { $0["event"] as? String == "selection" && $0["index"] as? Int == 2 }
        }
        let selected = records.filter { $0["event"] as? String == "selection" }.compactMap { $0["index"] as? Int }
        var transitions: [Int] = []
        for index in selected where transitions.last != index { transitions.append(index) }
        XCTAssertEqual(transitions,[0,1,2])
        XCTAssertEqual(player.current?.id,tracks[0].id); XCTAssertEqual(player.audioEffects.revision,2)
        XCTAssertEqual(player.audioEffects.status["clientId"] as? String,client)
        XCTAssertEqual(player.audioEffects.status["requestId"] as? Int,1)
        XCTAssertGreaterThan(player.audioEffects.measurement?.processedFrames ?? 0,0)
    }

    func testLazyCatalogReferenceUsesSeededCacheAndPreservesDuplicateOccurrence() async throws {
        let importer = subject(), local = try await importOne(importer,wave("Catalog neighbour",seconds:1.1))
        let reference = try XCTUnwrap(SavedTrack(["id":"1930572542","source":"catalog","audioUrl":"","title":"Public metadata fixture"]))
        // Real bounded public metadata lookup; audio below is a seeded genuine
        // MP3 fixture, not a claim of HTTPS downloading or source authenticity.
        let network = try await NativeCatalog.resolve(reference)
        XCTAssertEqual(network.id,reference.id); XCTAssertFalse(network.isCatalogReference)
        let fixture = try XCTUnwrap(Bundle(for:NativeRuntimeTests.self).url(forResource:"tone",withExtension:"mp3"))
        try Data(contentsOf:fixture).write(to:offline.appendingPathComponent(try XCTUnwrap(LocalAudioFiles.filename(network))))
        try JSONEncoder().encode([local,network]).write(to:offline.appendingPathComponent("index.json"),options:.atomic)
        importer.stop()
        let player = subject(), av = try avPlayer(player), client = UUID().uuidString.lowercased()
        XCTAssertTrue(player.acceptClientIntent(client:client,request:1,handshake:true))
        let snapshot = [local,reference,reference]
        player.configureQueue(snapshot,index:1,repeatMode:"off",shuffle:false)
        player.play(reference,queueIndex:1); player.pause()
        advancedEffects(player,client:client,revision:1,echo:0.4)
        try await settle(0.3)
        XCTAssertNil(av.currentItem); XCTAssertEqual(av.rate,0); XCTAssertEqual(player.state,"paused")
        player.resume()
        try await waitFor("native lazy lookup selects the cached numeric record",timeout:20) {
            player.current?.id == network.id && player.current?.isCatalogReference == false && av.rate>0 && av.currentTime().seconds>0.15
        }
        XCTAssertTrue((av.currentItem?.asset as? AVURLAsset)?.url.isFileURL == true)
        let time = av.currentTime().seconds
        player.configureQueue(snapshot,index:0,repeatMode:"off",shuffle:false)
        XCTAssertEqual(player.current?.audioUrl,network.audioUrl)
        XCTAssertGreaterThanOrEqual(av.currentTime().seconds,time-0.08)
        XCTAssertEqual(records.last { $0["event"] as? String == "selection" }?["index"] as? Int,1)
        XCTAssertEqual(records.last { $0["event"] as? String == "selection" }?["previousId"] as? String,reference.id)
        try await waitFor("native end resolves the second reference occurrence",timeout:20) {
            self.records.contains { $0["event"] as? String == "selection" && $0["index"] as? Int == 2 && ($0["track"] as? [String:Any])?["audioUrl"] as? String == network.audioUrl }
        }
        XCTAssertEqual(player.audioEffects.revision,1)
    }

    private func javascript(_ source: String, in web: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            web.evaluateJavaScript(source) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }
    private func javascriptObject(_ source: String, in web: WKWebView) async throws -> [String:Any] {
        let deadline = ProcessInfo.processInfo.systemUptime+5
        while ProcessInfo.processInfo.systemUptime<deadline {
            if let value = try await javascript(source,in:web) as? [String:Any] { return value }
            try await settle(0.025)
        }
        XCTFail("Timed out waiting for the real WebKit event")
        throw UserError.message("WebKit event did not arrive")
    }

    private func post(_ object: [String: Any], in web: WKWebView) async throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        _ = try await javascript("window.webkit.messageHandlers.lolzcloud.postMessage("+json+"); true", in: web)
    }

    func testLiveHTTPSWebKitBridgeRejectsStaleClientAndWrongPage() async throws {
        let shell = AppShell(), web = try XCTUnwrap(shell.webView)
        let scene=try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.first{$0.activationState == .foregroundActive})
        let previousKey=scene.windows.first{$0.isKeyWindow},window=UIWindow(windowScene:scene),controller=UIViewController()
        window.rootViewController=controller;window.frame=scene.screen.bounds
        controller.view.addSubview(web);web.frame=controller.view.bounds;web.autoresizingMask=[.flexibleWidth,.flexibleHeight]
        window.makeKeyAndVisible();controller.view.layoutIfNeeded()
        subjects.append(shell.player)
        shell.player.emit = { [weak self] name, detail in var row = detail; row["event"] = name; self?.records.append(row) }
        defer {
            shell.login.cancel()
            web.stopLoading(); web.configuration.userContentController.removeScriptMessageHandler(forName: "lolzcloud")
            web.navigationDelegate = nil; web.uiDelegate = nil
            web.removeFromSuperview();window.isHidden=true;previousKey?.makeKeyAndVisible()
        }
        try await waitFor("live public HTTPS PWA loads", timeout: 35) { !shell.loading && web.url?.host == "lolzcloud.com" }
        XCTAssertTrue(shell.loadError.isEmpty, shell.loadError)
        XCTAssertTrue(MediaPolicy.bridgePage(web.url))
        XCTAssertTrue(web.window===window)
        let fits=try await javascript("document.documentElement.scrollWidth<=innerWidth+2&&innerWidth>300&&[...document.querySelectorAll('button')].some(b=>{var r=b.getBoundingClientRect();return r.width>=24&&r.height>=24;})",in:web)
        XCTAssertEqual(fits as? Bool,true,"The actual attached public PWA must fit this device's viewport and show usable controls")
        let renderer=UIGraphicsImageRenderer(bounds:window.bounds)
        let attachment=XCTAttachment(image:renderer.image{_ in window.drawHierarchy(in:window.bounds,afterScreenUpdates:true)})
        attachment.name="attached-public-pwa-"+(UIDevice.current.userInterfaceIdiom == .pad ? "ipad":"iphone");attachment.lifetime = .keepAlways;add(attachment)
        let track = try await importOne(shell.player, wave("Bridge"))
        let a = UUID().uuidString.lowercased(), b = UUID().uuidString.lowercased()
        var handshake: [String:Any] = ["action":"queue", "clientId":a, "requestId":1, "handshake":true,
            "tracks":[track.object], "index":0, "repeat":"off", "shuffle":false]
        try await post(handshake, in: web)
        try await waitFor("actual WK message establishes client") { self.records.contains { $0["clientId"] as? String == a } }
        var play = track.object
        play.merge(["action":"play", "clientId":a, "requestId":2, "queueIndex":0]) { _, new in new }
        try await post(play, in: web)
        let av = try avPlayer(shell.player)
        try await waitFor("WK play reaches actual AVPlayer") { av.currentTime().seconds > 0.2 && av.rate > 0 }
        try await post(["action":"effects","clientId":a,"requestId":2,"revision":1,
                        "config":["enabled":false,"gains":[0,0,0,0,0],"preampDb":0]],in:web)
        try await waitFor("first document has an accepted effects owner") { shell.player.audioEffects.status["clientId"] as? String == a }
        handshake["clientId"] = b
        try await post(handshake, in: web)
        try await waitFor("new document client takes ownership") { self.records.last { $0["event"] as? String == "playback" }?["clientId"] as? String == b }
        XCTAssertEqual(shell.player.audioEffects.status["clientId"] as? String,a,"A new transport handshake must not relabel an old configuration acknowledgement")
        try await post(["action":"pause", "clientId":a, "requestId":500], in: web)
        try await settle(0.2)
        XCTAssertGreaterThan(av.rate, 0, "Retired client's high request must not pause current playback")
        try await post(["action":"pause", "clientId":b, "requestId":2], in: web)
        try await waitFor("current client pause is accepted") { av.rate == 0 }
        let config: [String:Any] = ["enabled":true,"gains":[0,0,0,0,0],"preampDb":-6]
        try await post(["action":"effects","clientId":b,"requestId":2,"revision":1,"config":config],in:web)
        try await waitFor("actual WK effects message stores independent settings") { shell.player.audioEffects.revision == 1 }
        XCTAssertEqual(av.rate,0,"Effects messages must not resume the paused native player")
        try await post(["action":"effects","clientId":b,"requestId":500,"revision":99,"config":config],in:web)
        try await settle(0.1)
        XCTAssertEqual(shell.player.audioEffects.revision,1,"A future FX request must not take over the transport binding")
        try await post(["action":"pause","clientId":b,"requestId":2],in:web)
        XCTAssertEqual(av.rate,0)
        try await post(["action":"rate","clientId":b,"requestId":2,"value":1.25,"preservesPitch":false,"revision":1],in:web)
        try await waitFor("actual trusted WK rate message selects varispeed without resuming") { av.defaultRate == 1.25 && av.currentItem?.audioTimePitchAlgorithm == .varispeed }
        XCTAssertEqual(av.rate,0)
        try await post(["action":"rate","clientId":b,"requestId":500,"value":2,"preservesPitch":true,"revision":2],in:web)
        try await settle(0.1)
        XCTAssertEqual(av.defaultRate,1.25,"A settings side-channel must not acquire a future transport request")
        XCTAssertEqual(av.currentItem?.audioTimePitchAlgorithm,.varispeed)
        let probe = RuntimeFrameProbe()
        web.configuration.userContentController.add(probe, name: "runtime_probe")
        web.configuration.userContentController.addUserScript(WKUserScript(
            source: "if(window.top!==window)window.webkit.messageHandlers.runtime_probe.postMessage('child');",
            injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        // /app/ correctly forbids framing via frame-ancestors. about:blank is
        // an allowed real child document and inherits the trusted origin.
        _ = try await javascript("var f=document.createElement('iframe');f.id='runtime-child';f.src='about:blank';document.body.appendChild(f);true", in: web)
        try await waitFor("real child frame loads", timeout: 25) { probe.child != nil }
        let child = try XCTUnwrap(probe.child)
        let childData = try JSONSerialization.data(withJSONObject: ["action":"rate", "clientId":b, "requestId":3, "value":1.75])
        let childJSON = try XCTUnwrap(String(data: childData, encoding: .utf8))
        let _: Any? = try await withCheckedThrowingContinuation { continuation in
            web.evaluateJavaScript("window.webkit.messageHandlers.lolzcloud.postMessage("+childJSON+");true", in: child, in: .page) { result in
                switch result {
                case .success(let value): continuation.resume(returning: value)
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
        try await settle(0.2)
        XCTAssertEqual(av.defaultRate, 1.25, "A real iframe must not control the native player")
        web.configuration.userContentController.removeScriptMessageHandler(forName: "runtime_probe")
        _ = try await javascript("document.getElementById('runtime-child').remove();true", in: web)
        records.removeAll()
        // /social intentionally redirects unauthenticated visitors to native
        // login. Use a public own page so this read-only test never starts auth.
        web.load(URLRequest(url: MediaPolicy.origin.appendingPathComponent("install.html")))
        try await waitFor("public non-bridge own page finishes", timeout: 30) { web.url?.path == "/install.html" && !web.isLoading }
        try await post(["action":"rate", "clientId":b, "requestId":3, "value":1.75], in: web)
        try await settle(0.2)
        XCTAssertEqual(av.defaultRate, 1.25, "A public same-origin page must not acquire the /app bridge")
        XCTAssertFalse(records.contains { $0["requestId"] as? Int == 3 })
    }

    func testTaggedProfileExportPresentsRealAnchoredSystemSheetAndPreservesPause() async throws {
        let shell = AppShell(), web = try XCTUnwrap(shell.webView)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive })
        let previousKey = scene.windows.first { $0.isKeyWindow }, window = UIWindow(windowScene:scene), controller = UIViewController()
        window.rootViewController = controller; window.frame = scene.screen.bounds
        controller.view.addSubview(web); web.frame = controller.view.bounds; web.autoresizingMask = [.flexibleWidth,.flexibleHeight]
        window.makeKeyAndVisible(); controller.view.layoutIfNeeded()
        subjects.append(shell.player)
        shell.player.emit = { [weak self] name,detail in var row = detail; row["event"] = name; self?.records.append(row) }
        let temporary = FileManager.default.temporaryDirectory.standardizedFileURL
        func profileFolders() -> [URL] {
            ((try? FileManager.default.contentsOfDirectory(at:temporary,includingPropertiesForKeys:[.isDirectoryKey,.isSymbolicLinkKey])) ?? [])
                .filter { $0.lastPathComponent.hasPrefix("LolzCloud-profile-") }.map(\.standardizedFileURL)
        }
        let before = Set(profileFolders()); var fixtureFolder: URL?
        defer {
            // This is fixture cleanup, not a simulated user completion. No
            // activity or destination is selected and no completion callback
            // is invoked by the test. Physical/system Cancel remains unproved.
            controller.presentedViewController?.dismiss(animated:false)
            if let folder = fixtureFolder, folder.deletingLastPathComponent() == temporary,
               folder.lastPathComponent.hasPrefix("LolzCloud-profile-") { try? FileManager.default.removeItem(at:folder) }
            shell.login.cancel(); web.stopLoading(); web.configuration.userContentController.removeScriptMessageHandler(forName:"lolzcloud")
            web.navigationDelegate = nil; web.uiDelegate = nil; web.removeFromSuperview(); window.isHidden = true; previousKey?.makeKeyAndVisible()
        }
        try await waitFor("public own application loads for actual export bridge",timeout:35) { !shell.loading && MediaPolicy.bridgePage(web.url) }
        XCTAssertTrue(shell.loadError.isEmpty,shell.loadError)
        _ = try await javascript("window.__runtimeProfileExports=[];window.addEventListener('lolzcloud:profileExport',e=>window.__runtimeProfileExports.push(e.detail));true",in:web)
        let track = try await importOne(shell.player,wave("Export paused music")), client = UUID().uuidString.lowercased()
        try await post(["action":"queue","clientId":client,"requestId":1,"handshake":true,"tracks":[track.object,track.object],"index":1,"repeat":"off","shuffle":false],in:web)
        var play = track.object; play.merge(["action":"play","clientId":client,"requestId":2,"queueIndex":1]) { _,new in new }
        try await post(play,in:web)
        let av = try avPlayer(shell.player)
        try await waitFor("actual audio plays before export pause") { av.rate>0 && av.currentTime().seconds>0.2 }
        try await post(["action":"pause","clientId":client,"requestId":3],in:web)
        try await waitFor("actual export source is paused") { av.rate==0 && shell.player.state == "paused" }
        let position = av.currentTime().seconds, item = try XCTUnwrap(av.currentItem), operation = UUID().uuidString.lowercased()
        let object: [String:Any] = ["format":"lolzcloud-profile","version":1,"music":["preferences":["density":"compact","description":"Проверка профиля UTF-8"]],"wave":[:],"tools":[:]]
        let bytes = try JSONSerialization.data(withJSONObject:object,options:[.sortedKeys]), json = try XCTUnwrap(String(data:bytes,encoding:.utf8))
        let filename = "LolzCloud-profile-2026-11-15.json"
        try await post(["action":"exportProfile","clientId":client,"requestId":3,"operationId":operation,"filename":filename,"json":json],in:web)
        try await waitFor("real UIKit share controller is presented") {
            controller.presentedViewController is UIActivityViewController && controller.presentedViewController?.isBeingPresented == false
        }
        let activity = try XCTUnwrap(controller.presentedViewController as? UIActivityViewController)
        let created = profileFolders().filter { !before.contains($0) }
        XCTAssertEqual(created.count,1); let folder = try XCTUnwrap(created.first); fixtureFolder = folder
        let values = try folder.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey])
        XCTAssertTrue(values.isDirectory == true); XCTAssertFalse(values.isSymbolicLink == true)
        XCTAssertEqual(try Data(contentsOf:folder.appendingPathComponent(filename)),bytes)
        if UIDevice.current.userInterfaceIdiom == .pad {
            let popover = try XCTUnwrap(activity.popoverPresentationController)
            XCTAssertTrue(popover.sourceView === web)
            XCTAssertEqual(popover.sourceRect,CGRect(x:web.bounds.midX,y:web.bounds.midY,width:1,height:1))
            XCTAssertTrue(web.bounds.contains(popover.sourceRect))
        }
        let initial = try await javascriptObject("window.__runtimeProfileExports.find(e=>e.state==='sharing')||null",in:web)
        XCTAssertEqual(initial["operationId"] as? String,operation); XCTAssertEqual(initial["clientId"] as? String,client); XCTAssertEqual(initial["requestId"] as? Int,3)
        // A second current-tag request must fail without replacing the first
        // sheet's captured owner or creating a second private export file.
        try await post(["action":"pause","clientId":client,"requestId":4],in:web)
        let duplicate = UUID().uuidString.lowercased()
        try await post(["action":"exportProfile","clientId":client,"requestId":4,"operationId":duplicate,"filename":filename,"json":json],in:web)
        let rejected = try await javascriptObject("window.__runtimeProfileExports.find(e=>e.state==='error')||null",in:web)
        XCTAssertEqual(rejected["operationId"] as? String,duplicate); XCTAssertEqual(rejected["requestId"] as? Int,4)
        XCTAssertTrue(controller.presentedViewController === activity)
        XCTAssertEqual(profileFolders().filter { !before.contains($0) },[folder])
        let captured = Mirror(reflecting:shell).children.first { $0.label == "profileExportOwner" }?.value as? [String:Any]
        XCTAssertEqual(captured?["clientId"] as? String,client); XCTAssertEqual(captured?["requestId"] as? Int,3)
        XCTAssertTrue(av.currentItem === item); XCTAssertEqual(av.rate,0); XCTAssertEqual(shell.player.state,"paused")
        XCTAssertEqual(av.currentTime().seconds,position,accuracy:0.08)
        XCTAssertEqual(shell.player.current?.id,track.id)
        XCTAssertEqual(records.last { $0["event"] as? String == "selection" }?["index"] as? Int,1)
        let image = UIGraphicsImageRenderer(bounds:window.bounds).image { _ in window.drawHierarchy(in:window.bounds,afterScreenUpdates:true) }
        let screen = XCTAttachment(image:image); screen.name = "actual-system-profile-share-"+(UIDevice.current.userInterfaceIdiom == .pad ? "ipad":"iphone"); screen.lifetime = .keepAlways; add(screen)
        let evidence: [String:Any] = ["presentedController":String(describing:type(of:activity)),"fileBytes":bytes.count,
            "utf8Exact":true,"duplicateRejected":true,"pausedQueueIndex":1,"ipadAnchorChecked":UIDevice.current.userInterfaceIdiom == .pad,
            "cleanup":"Programmatic fixture dismissal and removal of this test's private directory; user Cancel/completion callback not asserted."]
        let note = XCTAttachment(data:try JSONSerialization.data(withJSONObject:evidence,options:[.prettyPrinted,.sortedKeys]),uniformTypeIdentifier:"public.json")
        note.name = "profile-share-scope"; note.lifetime = .keepAlways; add(note)
    }
}
