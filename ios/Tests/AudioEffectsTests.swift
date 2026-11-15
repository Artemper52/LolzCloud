import XCTest
@testable import LolzCloudPolicy
import LolzCloudDSPCore

final class AudioEffectsTests: XCTestCase {
    private func config(_ core: OpaquePointer, gains: [Float] = [0,0,0,0,0], preamp: Float = 0, enabled: Bool = true, revision: UInt32 = 2) -> Int32 {
        gains.withUnsafeBufferPointer { LCDSPConfigure(core,enabled ? 1:0,$0.baseAddress,$0.count,preamp,revision) }
    }
    private func process(_ core: OpaquePointer, hz: Double, seconds: Double = 0.3, amplitude: Double = 0.1) -> (Double,Double) {
        var samples=(0..<Int(44100*seconds)).map { Float(sin(Double($0)*2*Double.pi*hz/44100)*amplitude) }
        let input=sqrt(samples.reduce(0.0){$0+Double($1*$1)}/Double(samples.count))
        samples.withUnsafeMutableBufferPointer { LCDSPProcess(core,$0.baseAddress,nil,UInt32($0.count),1) }
        let output=sqrt(samples.suffix(samples.count/2).reduce(0.0){$0+Double($1*$1)}/Double(samples.count-samples.count/2))
        return (input,output)
    }
    func testSettingsRejectBooleansNonfiniteWrongShapeAndUnknownFields() {
        let valid: [String:Any]=["enabled":true,"gains":[0,0,0,0,0],"preampDb":0]
        XCTAssertNotNil(AudioEffectsSettings(valid))
        for (key,value) in [("enabled",1 as Any),("gains",[true,0,0,0,0] as Any),("gains",[0,0,0,0] as Any),("gains",[0,0,Double.nan,0,0] as Any),("gains",[13,0,0,0,0] as Any),("preampDb",true as Any),("preampDb",1 as Any),("preampDb",Double.infinity as Any)] {
            var object=valid;object[key]=value;XCTAssertNil(AudioEffectsSettings(object))
        }
        var unknown=valid;unknown["normalization"]=true;XCTAssertNil(AudioEffectsSettings(unknown))
    }
    func testBypassIsBitExactForFinitePCMAndCountsRealFrames() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        XCTAssertEqual(config(core,enabled:false),1);XCTAssertEqual(LCDSPPrepare(core,44100,1,65536),1)
        var data: [Float]=[0,0.1,-0.3,0.999,-0.999];let original=data
        data.withUnsafeMutableBufferPointer{LCDSPProcess(core,$0.baseAddress,nil,UInt32($0.count),1)}
        XCTAssertEqual(data,original);let m=LCDSPReadMetrics(core)
        XCTAssertEqual(m.processedFrames,5);XCTAssertEqual(m.appliedRevision,2)
    }
    func testPCMCrossingMeterMeasuresToneAndResetsWithTheStream() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        _=config(core,enabled:false);_=LCDSPPrepare(core,44100,1,65536)
        _=process(core,hz:910,seconds:1.2)
        let rows=(20..<110).map{LCDSPReadEnergyWindow(core,UInt32($0))}
        let frames=rows.reduce(0.0){$0+Double($1.frames)},crossings=rows.reduce(0.0){$0+Double($1.positiveCrossings)}
        XCTAssertEqual(crossings*44100/frames,910,accuracy:2)
        LCDSPReset(core)
        XCTAssertEqual(LCDSPReadEnergyWindow(core,50).positiveCrossings,0)
        XCTAssertEqual(LCDSPReadEnergyWindow(core,50).frames,0)
    }
    func testPeakingBandChangesFrequencyBalanceWithHeadroom() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        XCTAssertEqual(config(core,gains:[0,0,12,0,0]),1);XCTAssertEqual(LCDSPPrepare(core,44100,1,65536),1)
        let near=process(core,hz:910);LCDSPReset(core);let far=process(core,hz:6000)
        XCTAssertGreaterThan(near.1/far.1,3)
        XCTAssertEqual(LCDSPReadMetrics(core).headroomDb,-12,accuracy:0.01)
    }
    func testPreampAppliesMeasuredGainAndRevisionOnlyAfterFrames() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        XCTAssertEqual(config(core,preamp:-6),1);XCTAssertEqual(LCDSPPrepare(core,48000,1,65536),1)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,0)
        let result=process(core,hz:440)
        XCTAssertEqual(result.1/result.0,pow(10,-6.0/20),accuracy:0.015)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,2)
    }
    func testSilentPrefetchTailCannotEraseMeasuredEffectEnergy() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        _=config(core,preamp:-6);_=LCDSPPrepare(core,44100,1,65536)
        _=process(core,hz:660)
        var silence=[Float](repeating:0,count:8192)
        silence.withUnsafeMutableBufferPointer{LCDSPProcess(core,$0.baseAddress,nil,UInt32($0.count),1)}
        let measured=LCDSPReadMetrics(core)
        XCTAssertGreaterThan(measured.inputRMS,0.01)
        XCTAssertEqual(measured.outputRMS/measured.inputRMS,Float(pow(10,-6.0/20)),accuracy:0.01)
        LCDSPReset(core);XCTAssertEqual(LCDSPReadMetrics(core).inputRMS,0)
    }
    func testStereoPlanarAndInterleavedKeepIndependentState() throws {
        let a=try XCTUnwrap(LCDSPCreate()),b=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(a);LCDSPRelease(b)}
        _=config(a,gains:[-4,3,5,-2,1]);_=config(b,gains:[-4,3,5,-2,1]);_=LCDSPPrepare(a,44100,2,65536);_=LCDSPPrepare(b,44100,2,65536)
        let count=4096;var left=(0..<count).map{Float(sin(Double($0)*0.1)*0.1)},right=[Float](repeating:0,count:count)
        var interleaved=left.flatMap{[$0,Float(0)]}
        left.withUnsafeMutableBufferPointer{l in right.withUnsafeMutableBufferPointer{r in LCDSPProcess(a,l.baseAddress,r.baseAddress,UInt32(count),1)}}
        interleaved.withUnsafeMutableBufferPointer{p in LCDSPProcess(b,p.baseAddress,p.baseAddress!.advanced(by:1),UInt32(count),2)}
        XCTAssertTrue(right.allSatisfy{$0==0})
        for index in 0..<count{XCTAssertEqual(left[index],interleaved[index*2],accuracy:0.000001);XCTAssertEqual(interleaved[index*2+1],0)}
    }
    func testNonfiniteInputAndExtremeBoostRemainFiniteBounded() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        _=config(core,gains:[12,12,12,12,12]);_=LCDSPPrepare(core,44100,1,65536)
        var input: [Float]=[.nan,.infinity,-.infinity,Float.greatestFiniteMagnitude,-Float.greatestFiniteMagnitude]+[Float](repeating:1,count:8192)
        input.withUnsafeMutableBufferPointer{LCDSPProcess(core,$0.baseAddress,nil,UInt32($0.count),1)}
        XCTAssertTrue(input.allSatisfy{$0.isFinite&&abs($0)<=0.981})
    }
    func testInvalidConfigurationAndUnavailableFormatCannotClaimApplied() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        XCTAssertEqual(config(core,gains:[0,0]),0);XCTAssertEqual(config(core,gains:[.nan,0,0,0,0]),0)
        XCTAssertEqual(config(core,preamp:1),0);XCTAssertEqual(LCDSPPrepare(core,.nan,2,1024),0)
        XCTAssertEqual(LCDSPPrepare(core,44100,3,1024),0);XCTAssertEqual(LCDSPReadMetrics(core).processedFrames,0)
        _=config(core,gains:[0,0,0,0,12]);_=LCDSPPrepare(core,16000,1,1024)
        XCTAssertEqual(LCDSPReadMetrics(core).unavailableReason,3)
    }
    func testParameterRevisionIsConsumedWithoutRestart() throws {
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        _=config(core,preamp:0,revision:2);_=LCDSPPrepare(core,44100,1,65536)
        _=process(core,hz:440);let frames=LCDSPReadMetrics(core).processedFrames
        _=config(core,preamp:-12,revision:3)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,2)
        let result=process(core,hz:440)
        XCTAssertEqual(result.1/result.0,pow(10,-12.0/20),accuracy:0.015)
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,3)
        XCTAssertGreaterThan(LCDSPReadMetrics(core).processedFrames,frames)
    }
    func testAllFiveBandsApplyTheirExpectedFrequencyResponse() throws {
        let near: [Double]=[20,230,910,3600,20000],far: [Double]=[6000,6000,6000,200,500]
        for band in 0..<5 {
            let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
            var gains=[Float](repeating:0,count:5);gains[band]=6
            _=config(core,gains:gains);_=LCDSPPrepare(core,44100,1,65536)
            let a=process(core,hz:near[band]);LCDSPReset(core);let b=process(core,hz:far[band])
            XCTAssertGreaterThan(a.1/b.1,1.5,"Band \(band) must shape the actual PCM spectrum")
        }
    }
    func testControlMailboxRemainsFiniteUnderConcurrentBoundedUpdates() throws {
        final class Shared: @unchecked Sendable {let pointer: OpaquePointer;init(_ pointer: OpaquePointer){self.pointer=pointer}}
        let core=try XCTUnwrap(LCDSPCreate());defer{LCDSPRelease(core)}
        _=config(core);_=LCDSPPrepare(core,44100,1,2048)
        let shared=Shared(core),group=DispatchGroup();group.enter()
        DispatchQueue(label:"DSP-test-control").async {
            for revision in 3...2003 {
                let gains=[Float](repeating:Float(revision%25)-12,count:5)
                gains.withUnsafeBufferPointer{_ = LCDSPConfigure(shared.pointer,1,$0.baseAddress,$0.count,-3,UInt32(revision))}
            }
            group.leave()
        }
        var audio=[Float](repeating:0.1,count:512)
        for _ in 0..<2000 {audio.withUnsafeMutableBufferPointer{LCDSPProcess(core,$0.baseAddress,nil,UInt32($0.count),1)}}
        XCTAssertEqual(group.wait(timeout:.now()+3),.success)
        XCTAssertTrue(audio.allSatisfy{$0.isFinite&&abs($0)<=0.981})
        _=config(core,revision:3000)
        for _ in 0..<4 {audio.withUnsafeMutableBufferPointer{LCDSPProcess(core,$0.baseAddress,nil,UInt32($0.count),1)}}
        XCTAssertEqual(LCDSPReadMetrics(core).appliedRevision,3000)
    }
}
