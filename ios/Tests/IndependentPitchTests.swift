import XCTest
@testable import LolzCloudPolicy
import LolzCloudDSPCore

private final class PitchPCMSource {
    var samples: [Float]
    var position = 0
    var start = true
    init(_ samples: [Float]) { self.samples = samples }
}
private func pitchReadPCM(_ context: UnsafeMutableRawPointer?, _ requested: UInt32, _ left: UnsafeMutablePointer<Float>?, _ right: UnsafeMutablePointer<Float>?, _ count: UnsafeMutablePointer<UInt32>?, _ flags: UnsafeMutablePointer<UInt32>?) -> Int32 {
    guard let context, let left, let count, let flags else { return 0 }
    let source = Unmanaged<PitchPCMSource>.fromOpaque(context).takeUnretainedValue()
    let size = min(Int(requested),source.samples.count-source.position)
    for i in 0..<size { left[i] = source.samples[source.position+i]; right?[i] = -left[i]*0.5 }
    flags.pointee = source.start ? UInt32(LCPCMStart):0; source.start = false
    source.position += size; count.pointee = UInt32(size)
    if source.position == source.samples.count { flags.pointee |= UInt32(LCPCMEnd) }
    return 1
}

final class IndependentPitchTests: XCTestCase {
    private let rate = 48_000.0
    private func object(_ pitch: Double = 1) -> [String:Any] { ["enabled":false,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0,"echo":0,"normalization":false,"pitch":pitch] }
    private func configure(_ core: OpaquePointer, pitch: Float, revision: UInt32 = 2, effects: Bool = false) -> Int32 {
        let gains: [Float] = effects ? [12,12,12,12,12]:[0,0,0,0,0]
        return gains.withUnsafeBufferPointer { LCDSPConfigurePitch(core,effects ? 1:0,$0.baseAddress,$0.count,0,0,0,0,pitch,revision) }
    }
    private func tone(_ hz: Double, seconds: Double = 2) -> [Float] { (0..<Int(rate*seconds)).map { Float(sin(Double($0)*2*Double.pi*hz/rate)*0.1) } }
    private func process(_ core: OpaquePointer, _ values: [Float]) -> [Float] {
        var result = values
        result.withUnsafeMutableBufferPointer { buffer in
            for offset in stride(from:0,to:buffer.count,by:1024) { LCDSPProcess(core,buffer.baseAddress!.advanced(by:offset),nil,UInt32(min(1024,buffer.count-offset)),1) }
        }
        return result
    }
    private func measured(_ values: ArraySlice<Float>) -> (hz: Double,rms: Double) {
        var crossings = 0, armed = false, energy = 0.0
        for sample in values { if sample < -0.0001 { armed = true } else if sample > 0.0001 && armed { crossings += 1; armed = false }; energy += Double(sample)*Double(sample) }
        return (Double(crossings)*rate/Double(values.count),sqrt(energy/Double(values.count)))
    }
    private func stream(_ core: OpaquePointer, source: PitchPCMSource, frames: Int = 1024) throws -> [Float] {
        let stream = try XCTUnwrap(LCPCMStreamCreate(core,1,UInt32(frames))); defer { LCPCMStreamDestroy(stream) }
        var result = [Float](), end = false, calls = 0
        while !end {
            var count: UInt32 = 0, flags: UInt32 = 0
            XCTAssertEqual(LCPCMStreamRender(stream,pitchReadPCM,Unmanaged.passUnretained(source).toOpaque(),UInt32(frames),&count,&flags),1)
            XCTAssertLessThanOrEqual(count,UInt32(frames)); if count > 0 { result.append(contentsOf:UnsafeBufferPointer(start:LCPCMStreamChannel(stream,0),count:Int(count))) }
            end = flags & UInt32(LCPCMEnd) != 0; calls += 1
            if calls > source.samples.count/frames+10 { XCTFail("Stream did not finish bounded EOF drain"); break }
        }
        return result
    }
    func testSchemaThreeExactShapeAndLegacyPitchDefaults() throws {
        XCTAssertEqual(try XCTUnwrap(AudioEffectsSettings(object(1.5))).pitch,1.5)
        for schema in [1,2] { let shape = try XCTUnwrap(AudioEffectsSettings(object())).object(schema:schema); XCTAssertEqual(shape.count,schema == 1 ? 3:6); XCTAssertEqual(try XCTUnwrap(AudioEffectsSettings(shape)).pitch,1) }
        var partial = object(); partial.removeValue(forKey:"echo"); XCTAssertNil(AudioEffectsSettings(partial))
        var partialLegacy: [String:Any] = ["enabled":true,"gains":[0,0,0,0,0],"preampDb":0]; partialLegacy["pitch"] = 1.5; XCTAssertNil(AudioEffectsSettings(partialLegacy))
        var extra = object(); extra["transportEnabled"] = true; XCTAssertNil(AudioEffectsSettings(extra))
    }
    func testPitchBoundsAndPersistedPreferenceMigration() throws {
        let invalidValues: [Any] = [true,Double.nan,Double.infinity,0.49,2.01,"1.5"]
        for value in invalidValues { var invalid = object(); invalid["pitch"] = value; XCTAssertNil(AudioEffectsSettings(invalid)) }
        for ratio in [0.5,1,1.25,2] {
            let settings = try XCTUnwrap(AudioEffectsSettings(object(ratio)))
            XCTAssertFalse(settings.enabled); XCTAssertEqual(try JSONDecoder().decode(AudioEffectsSettings.self,from:JSONEncoder().encode(settings)),settings)
        }
        let old = Data(#"{"enabled":false,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0.4,"echo":0.3,"normalization":true}"#.utf8)
        let migrated = try JSONDecoder().decode(AudioEffectsSettings.self,from:old)
        XCTAssertEqual(migrated.pitch,1); XCTAssertEqual(migrated.reverb,0.4); XCTAssertEqual(migrated.echo,0.3); XCTAssertTrue(migrated.normalization)
    }
    func testUnityAndDisabledFXAreExactBypass() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        XCTAssertEqual(configure(core,pitch:1),1); XCTAssertEqual(LCDSPPrepare(core,rate,1,1024),1)
        let values: [Float] = [0,0.1,-0.3,0.99,-0.99]
        XCTAssertEqual(process(core,values),values)
    }
    func testRealLowMidHighToneFrequencyAndEnergyAcrossRatios() throws {
        for hz in [60.0,220,910,3000,12000] { for ratio in [0.5,0.75,1.25,1.5,2] where hz*ratio < 22000 {
            let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
            XCTAssertEqual(configure(core,pitch:Float(ratio)),1); XCTAssertEqual(LCDSPPrepare(core,rate,1,1024),1)
            let result = process(core,tone(hz)), measured = measured(result.suffix(48_000)), expected = hz*ratio
            XCTAssertEqual(measured.hz,expected,accuracy:max(1,expected*0.02),"\(hz) × \(ratio)")
            XCTAssertGreaterThan(measured.rms,0.05,"Independent tone must not lose more than 3dB: \(hz) × \(ratio)")
            XCTAssertLessThan(measured.rms,0.1,"Independent tone must not gain more than 3dB")
            XCTAssertEqual(result.count,96_000); XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,2)
            XCTAssertGreaterThan(LCDSPReadMetrics(core).pitchProcessedFrames,0)
        } }
    }
    func testPitchStillProcessesWhenAllSavedEffectsAreDisabled() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        let gains: [Float] = [12,12,12,12,12]
        XCTAssertEqual(gains.withUnsafeBufferPointer { LCDSPConfigurePitch(core,0,$0.baseAddress,$0.count,-12,0.8,0.8,1,1.5,2) },1)
        XCTAssertEqual(LCDSPPrepare(core,rate,1,1024),1)
        let result = measured(process(core,tone(910)).suffix(48_000))
        XCTAssertEqual(result.hz,1365,accuracy:3); XCTAssertGreaterThan(result.rms,0.05)
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationFrames,0)
    }
    func testTapTimelineAbsorbsLatencyAndDrainsExactShortAndFullDuration() throws {
        for count in [1,123,2048,8195,48_123] {
            let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
            _ = configure(core,pitch:1); _ = LCDSPPrepare(core,rate,1,1024)
            var input = (0..<count).map { Float(sin(Double($0)*0.1)*0.1) }; input[0] = 0.31; input[count-1] = -0.47
            let source = PitchPCMSource(input), result = try stream(core,source:source)
            XCTAssertEqual(result,input,"Priming/EOF must neither drop the first/last sample nor extend the timeline")
            XCTAssertEqual(source.position,count); XCTAssertEqual(LCDSPReadMetrics(core).processedFrames,UInt64(count))
        }
    }
    func testNonunityTimelineKeepsFrameCountAndLastAudio() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,pitch:1.5); _ = LCDSPPrepare(core,rate,1,1024)
        let input = tone(910), result = try stream(core,source:PitchPCMSource(input))
        XCTAssertEqual(result.count,input.count); XCTAssertEqual(LCDSPReadMetrics(core).processedFrames,UInt64(input.count))
        let steady = measured(result[48_000..<72_000]); XCTAssertEqual(steady.hz,1365,accuracy:4); XCTAssertGreaterThan(steady.rms,0.05)
        XCTAssertGreaterThan(measured(result.suffix(4800)).rms,0.03,"End-of-stream must drain the compensated processor")
    }
    func testSettingsDoNotAcknowledgeWithoutActualFramesAndCannotStartPlayback() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,pitch:1.5); _ = LCDSPPrepare(core,rate,1,1024)
        XCTAssertEqual(LCDSPReadMetrics(core).processedFrames,0); XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,0)
        _ = configure(core,pitch:0.5,revision:3)
        XCTAssertEqual(LCDSPReadMetrics(core).processedFrames,0); XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,0)
        _ = process(core,tone(910,seconds:0.5)); XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,3)
    }
    func testPitchChangeSmoothingAndSeekClearAllOldTail() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,pitch:1.5); _ = LCDSPPrepare(core,rate,1,1024); _ = LCDSPUsePitchLookahead(core); LCDSPBeginOutputTimeline(core)
        _ = process(core,tone(910,seconds:0.5)); _ = configure(core,pitch:0.5,revision:3)
        let transition = process(core,tone(910,seconds:0.5))
        XCTAssertTrue(transition.allSatisfy { $0.isFinite && abs($0)<0.71 })
        XCTAssertLessThan(zip(transition.dropFirst(),transition).map { abs($0-$1) }.max()!,0.08)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,3)
        LCDSPReset(core); LCDSPBeginOutputTimeline(core)
        XCTAssertTrue(process(core,[Float](repeating:0,count:8192)).allSatisfy { $0 == 0 })
    }
    func testFiniteLimiterAndInvalidRatios() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        for pitch in [Float.nan,.infinity,0.49,2.01] { XCTAssertEqual(configure(core,pitch:pitch),0) }
        _ = configure(core,pitch:0.5); _ = LCDSPPrepare(core,rate,1,1024)
        let invalid: [Float] = [.nan,.infinity,-.infinity,.greatestFiniteMagnitude,-.greatestFiniteMagnitude]+[Float](repeating:10,count:8192)
        XCTAssertTrue(process(core,invalid).allSatisfy { $0.isFinite && abs($0)<=0.981 })
    }
    func testOutOfBandContentIsDiscardedRatherThanAliased() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,pitch:2); _ = LCDSPPrepare(core,rate,1,1024)
        let result = measured(process(core,tone(18000)).suffix(48_000))
        XCTAssertLessThan(result.rms,0.0001)
    }
    func testPitchProcessorIsFiniteAcrossPreparedRateAndStereoLayouts() throws {
        for sampleRate in [8000.0,16000,44100,48000,96000,192000,384000] {
            let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
            _ = configure(core,pitch:1.5); XCTAssertEqual(LCDSPPrepare(core,sampleRate,2,1024),1)
            var samples = (0..<Int(sampleRate*0.3)).flatMap { index -> [Float] in let value=Float(sin(Double(index)*2*Double.pi*910/sampleRate)*0.1); return [value,-value*0.5] }
            let totalFrames=samples.count/2
            samples.withUnsafeMutableBufferPointer { buffer in
                for frame in stride(from:0,to:totalFrames,by:1024) {
                    let pointer=buffer.baseAddress!.advanced(by:frame*2),count=min(1024,totalFrames-frame)
                    LCDSPProcess(core,pointer,pointer.advanced(by:1),UInt32(count),2)
                }
            }
            XCTAssertTrue(samples.allSatisfy { $0.isFinite && abs($0)<0.71 })
            for index in stride(from:samples.count/2,to:samples.count-1,by:2) { XCTAssertEqual(samples[index+1],-samples[index]*0.5,accuracy:0.00001) }
            XCTAssertEqual(LCDSPReadMetrics(core).pitchReady,1)
        }
    }
}
