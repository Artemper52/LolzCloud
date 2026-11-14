import XCTest
@testable import LolzCloudPolicy
import LolzCloudDSPCore

final class AdvancedAudioEffectsTests: XCTestCase {
    private let rate = 48_000.0
    private func configure(_ core: OpaquePointer, reverb: Float = 0, echo: Float = 0,
                           normalization: Int32 = 0, enabled: Int32 = 1, revision: UInt32 = 2) -> Int32 {
        let gains: [Float] = [0,0,0,0,0]
        return gains.withUnsafeBufferPointer { LCDSPConfigureAdvanced(core,enabled,$0.baseAddress,$0.count,0,reverb,echo,normalization,revision) }
    }
    private func process(_ core: OpaquePointer, _ input: [Float]) -> [Float] {
        var data = input
        data.withUnsafeMutableBufferPointer { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = min(1024,buffer.count-offset)
                LCDSPProcess(core,buffer.baseAddress!.advanced(by:offset),nil,UInt32(count),1)
                offset += count
            }
        }
        return data
    }
    private func tone(_ seconds: Double, amplitude: Double = 0.025) -> [Float] {
        (0..<Int(rate*seconds)).map { Float(sin(Double($0)*2*Double.pi*1000/rate)*amplitude) }
    }
    private func energy(_ values: ArraySlice<Float>) -> Double { values.reduce(0) { $0+Double($1)*Double($1) } }

    func testSchemaTwoStrictBoundsAndLegacyPreferenceMigration() throws {
        let full: [String:Any] = ["enabled":true,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0.8,"echo":0.8,"normalization":true]
        XCTAssertNotNil(AudioEffectsSettings(full))
        for (field,value) in [("reverb",true as Any),("reverb",Double.nan as Any),("echo",0.81 as Any),("echo",-0.1 as Any),("normalization",1 as Any)] {
            var invalid = full; invalid[field] = value; XCTAssertNil(AudioEffectsSettings(invalid))
        }
        var partial = full; partial.removeValue(forKey:"echo"); XCTAssertNil(AudioEffectsSettings(partial))
        let old = Data(#"{"enabled":true,"gains":[0,1,2,3,4],"preampDb":-6}"#.utf8)
        let migrated = try JSONDecoder().decode(AudioEffectsSettings.self,from:old)
        XCTAssertEqual(migrated.preampDb,-6); XCTAssertEqual(migrated.gains,[0,1,2,3,4])
        XCTAssertEqual(migrated.reverb,0); XCTAssertEqual(migrated.echo,0); XCTAssertFalse(migrated.normalization)
        let settings = try XCTUnwrap(AudioEffectsSettings(full))
        XCTAssertEqual(try JSONDecoder().decode(AudioEffectsSettings.self,from:JSONEncoder().encode(settings)),settings)
    }
    func testEchoImpulseArrivesAt280MillisecondsWithBoundedFeedback() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        XCTAssertEqual(configure(core,echo:0.8),1); XCTAssertEqual(LCDSPPrepare(core,rate,1,1024),1)
        var input = [Float](repeating:0,count:Int(rate*1.1)); let start = Int(rate*0.1),delay = Int(rate*0.28)
        input[start] = 0.2; let output = process(core,input)
        XCTAssertEqual(output[start],0.2,accuracy:0.00001)
        XCTAssertEqual(output[start+delay],0.2*0.8*0.6,accuracy:0.00001)
        XCTAssertEqual(output[start+2*delay]/output[start+delay],0.8*0.55,accuracy:0.00001)
        XCTAssertEqual(energy(output[(start+1)..<(start+delay)]),0)
        let window = LCDSPReadEnergyWindow(core,38)
        XCTAssertEqual(window.inputEnergy,0); XCTAssertGreaterThan(window.outputEnergy,0)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,2)
    }
    func testReverbHasFiniteDecayingTailAndDiscontinuityClearsIt() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,reverb:0.8); _ = LCDSPPrepare(core,rate,1,1024)
        var input = [Float](repeating:0,count:Int(rate*1.6)); input[Int(rate*0.1)] = 0.2
        let output = process(core,input)
        let early = energy(output[Int(rate*0.2)..<Int(rate*0.5)]),late = energy(output[Int(rate*1.0)..<Int(rate*1.3)])
        XCTAssertGreaterThan(early,0.000001); XCTAssertGreaterThan(late,0); XCTAssertLessThan(late,early*0.1)
        XCTAssertTrue(output.allSatisfy { $0.isFinite && abs($0)<0.71 })
        LCDSPReset(core)
        XCTAssertTrue(process(core,[Float](repeating:0,count:48_000)).allSatisfy { $0==0 })
    }
    func testDisabledModulesAndGlobalBypassDoNotHideWetAudio() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core); _ = LCDSPPrepare(core,rate,1,1024)
        let dry = tone(0.2)
        XCTAssertEqual(process(core,dry),dry)
        _ = configure(core,reverb:0.8,echo:0.8,normalization:1,enabled:0,revision:3)
        _ = process(core,[Float](repeating:0,count:2048))
        let input: [Float] = [0,0.99,-0.99,0.01]
        XCTAssertEqual(process(core,input),input)
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationFrames,0)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,3)
    }
    func testNormalizationConvergesAtOneDbPerSecondAndSurvivesOtherSettings() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,normalization:1); _ = LCDSPPrepare(core,rate,1,1024)
        _ = process(core,tone(4))
        let initial = LCDSPReadMetrics(core)
        XCTAssertEqual(initial.normalizationMeasured,1); XCTAssertEqual(initial.normalizationTargetDb,8,accuracy:0.01)
        XCTAssertGreaterThan(initial.normalizationGainDb,0.6); XCTAssertLessThan(initial.normalizationGainDb,1.1)
        _ = configure(core,reverb:0.1,normalization:1,revision:3)
        _ = process(core,tone(0.1)); let after = LCDSPReadMetrics(core)
        XCTAssertGreaterThan(after.normalizationFrames,initial.normalizationFrames)
        XCTAssertGreaterThanOrEqual(after.normalizationGainDb,initial.normalizationGainDb)
        _ = process(core,tone(10)); let final = LCDSPReadMetrics(core)
        XCTAssertEqual(final.normalizationGainDb,8,accuracy:0.01)
        XCTAssertTrue(final.loudnessDb.isFinite); XCTAssertGreaterThan(final.loudnessDb,-70)
        XCTAssertEqual(final.appliedRevision,3)
    }
    func testNormalizationSilenceGateAndResetNeverAmplifySilence() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,normalization:1); _ = LCDSPPrepare(core,rate,1,1024)
        XCTAssertTrue(process(core,[Float](repeating:0,count:48_000*5)).allSatisfy { $0==0 })
        let silence = LCDSPReadMetrics(core)
        XCTAssertEqual(silence.normalizationMeasured,0); XCTAssertEqual(silence.normalizationGainDb,0)
        _ = process(core,tone(5)); LCDSPReset(core)
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationGainDb,0)
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationFrames,0)
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationMeasured,0)
    }
    func testDisablingNormalizationReturnsSmoothlyToUnityWithoutHiddenMetering() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,normalization:1); _ = LCDSPPrepare(core,rate,1,1024)
        _ = process(core,tone(6)); let before = LCDSPReadMetrics(core)
        XCTAssertGreaterThan(before.normalizationGainDb,2)
        _ = configure(core,revision:3)
        _ = process(core,[0.01]); let first = LCDSPReadMetrics(core)
        XCTAssertEqual(first.normalizationGainDb,before.normalizationGainDb,accuracy:0.005)
        let input = tone(0.08),output = process(core,input)
        XCTAssertEqual(Array(output.suffix(512)),Array(input.suffix(512)))
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationGainDb,0)
        XCTAssertEqual(LCDSPReadMetrics(core).normalizationFrames,0)
    }
    func testWetLimiterIsStereoLinkedFiniteAndBoundedUnderExtremeInput() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,reverb:0.8,echo:0.8,normalization:1); _ = LCDSPPrepare(core,rate,2,1024)
        var left = [Float](repeating:2,count:1024),right = [Float](repeating:0.2,count:1024)
        left.withUnsafeMutableBufferPointer { l in right.withUnsafeMutableBufferPointer { r in LCDSPProcess(core,l.baseAddress,r.baseAddress,1024,1) } }
        XCTAssertLessThanOrEqual(left.map(abs).max()!,0.708)
        XCTAssertEqual(right[200]/left[200],0.1,accuracy:0.001)
        var invalid: [Float] = [.nan,.infinity,-.infinity,.greatestFiniteMagnitude,-.greatestFiniteMagnitude]
        invalid.withUnsafeMutableBufferPointer { p in LCDSPProcess(core,p.baseAddress,p.baseAddress,UInt32(p.count),1) }
        XCTAssertTrue(invalid.allSatisfy { $0.isFinite && abs($0)<=0.981 })
        let metrics = LCDSPReadMetrics(core)
        XCTAssertGreaterThan(metrics.limiterReductionDb,0); XCTAssertTrue(metrics.normalizationGainDb.isFinite)
    }
    func testReprepareAndDisableReenableCannotReplayOldDelayMemory() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,reverb:0.8,echo:0.8); _ = LCDSPPrepare(core,rate,1,1024)
        _ = process(core,tone(0.15))
        _ = configure(core,revision:3); _ = process(core,[Float](repeating:0,count:2048))
        _ = configure(core,reverb:0.8,echo:0.8,revision:4)
        XCTAssertTrue(process(core,[Float](repeating:0,count:48_000)).allSatisfy { $0==0 })
        LCDSPUnprepare(core); XCTAssertEqual(LCDSPReadMetrics(core).prepared,0)
        XCTAssertEqual(LCDSPPrepare(core,96_000,1,1024),1)
        XCTAssertTrue(process(core,[Float](repeating:0,count:48_000)).allSatisfy { $0==0 })
    }
    func testAdvancedControlRejectsNonfiniteBoundsAndNonBooleanFlags() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        XCTAssertEqual(configure(core,reverb:.nan),0); XCTAssertEqual(configure(core,echo:.infinity),0)
        XCTAssertEqual(configure(core,reverb:0.81),0); XCTAssertEqual(configure(core,echo:-0.1),0)
        XCTAssertEqual(configure(core,normalization:2),0)
    }
    func testPreparedAdvancedGraphHandlesSupportedRatesAndInterleavedStereo() throws {
        let core = try XCTUnwrap(LCDSPCreate()); defer { LCDSPRelease(core) }
        _ = configure(core,reverb:0.8,echo:0.8,normalization:1)
        for sampleRate in [8000.0,16000,44100,48000,96000,192000,384000] {
            XCTAssertEqual(LCDSPPrepare(core,sampleRate,2,256),1)
            var input = (0..<2048).flatMap { index -> [Float] in
                let sample = Float(sin(Double(index)*0.1)*0.2)
                return [sample,-sample*0.5]
            }
            input.withUnsafeMutableBufferPointer { buffer in
                for frame in stride(from:0,to:2048,by:256) {
                    let first = buffer.baseAddress!.advanced(by:frame*2)
                    LCDSPProcess(core,first,first.advanced(by:1),256,2)
                }
            }
            XCTAssertTrue(input.allSatisfy { $0.isFinite && abs($0)<=0.981 })
            let metrics = LCDSPReadMetrics(core)
            XCTAssertEqual(metrics.sampleRate,UInt32(sampleRate)); XCTAssertEqual(metrics.channels,2)
            XCTAssertEqual(metrics.unavailableReason,0)
        }
    }
}
