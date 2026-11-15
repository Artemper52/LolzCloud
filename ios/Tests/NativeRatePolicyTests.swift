import XCTest
@testable import LolzCloudPolicy

final class NativeRatePolicyTests: XCTestCase {
    private let a = "12345678-1234-4234-8234-123456789abc"
    private let b = "12345678-1234-4234-8234-123456789abd"
    func testRateAndBooleanAreStrictAndPreferencesRoundTrip() throws {
        let value = try XCTUnwrap(NativeRatePreferences(["value":1.5,"preservesPitch":false]))
        XCTAssertEqual(try JSONDecoder().decode(NativeRatePreferences.self,from:JSONEncoder().encode(value)),value)
        for invalid: Any in [true,"1.5",Double.nan,Double.infinity,0.49,2.01] {
            XCTAssertNil(NativeRatePreferences(["value":invalid,"preservesPitch":false]))
        }
        for invalid: Any in [1,0,"true",NSNull()] {
            XCTAssertNil(NativeRatePreferences(["value":1.5,"preservesPitch":invalid]))
        }
        XCTAssertNil(NativeRatePreferences(["value":1,"preservesPitch":true,"pitch":2]))
        XCTAssertThrowsError(try JSONDecoder().decode(NativeRatePreferences.self,from:Data("{\"value\":9,\"preservesPitch\":false}".utf8)))
    }
    func testPitchChoiceDoesNotChangePlaybackOrSleepIntent() {
        var settings = PlaybackSettings(), intent = PlaybackIntent()
        XCTAssertTrue(settings.preservesPitch)
        XCTAssertTrue(settings.setSleep(minutes:15,now:1000)); let deadline = settings.sleepDeadline
        let generation = intent.generation
        XCTAssertTrue(settings.setRate(1.5,preservesPitch:false))
        XCTAssertFalse(settings.preservesPitch); XCTAssertEqual(settings.rate,1.5)
        XCTAssertFalse(intent.wantsPlay); XCTAssertEqual(intent.generation,generation); XCTAssertEqual(settings.sleepDeadline,deadline)
        XCTAssertTrue(settings.setRate(0.75)); XCTAssertFalse(settings.preservesPitch,"Legacy rate must retain the pitch choice")
        XCTAssertFalse(settings.setRate(.nan,preservesPitch:true)); XCTAssertFalse(settings.preservesPitch)
    }
    func testStaleOrConflictingRevisionCannotReplaceCurrentPreferences() {
        var binding = NativeRateBinding()
        let first = NativeRatePreferences(value:1.5,preservesPitch:false)!, second = NativeRatePreferences(value:1.5,preservesPitch:true)!
        XCTAssertTrue(binding.accept(first,revision:4,client:a,request:2))
        XCTAssertFalse(binding.accept(second,revision:3,client:a,request:2))
        XCTAssertFalse(binding.accept(second,revision:4,client:a,request:2))
        XCTAssertEqual(binding.preferences,first)
        XCTAssertTrue(binding.accept(second,revision:5,client:a,request:2))
        XCTAssertEqual(binding.preferences,second)
        XCTAssertFalse(binding.accept(second,revision:0,client:a,request:2))
        XCTAssertFalse(binding.accept(second,revision:6,client:a.uppercased(),request:2))
    }
    func testNewTransportMustExplicitlyRebindSameRevisionWithoutRelabelledAck() {
        var binding = NativeRateBinding(); let value = NativeRatePreferences(value:1.5,preservesPitch:true)!
        XCTAssertTrue(binding.accept(value,revision:5,client:a,request:2))
        XCTAssertEqual(binding.acknowledgement(client:a,request:2,applied:true)["rateAppliedRevision"] as? Int,5)
        XCTAssertTrue(binding.acknowledgement(client:a,request:3,applied:true).isEmpty)
        XCTAssertTrue(binding.accept(value,revision:5,client:a,request:3))
        XCTAssertEqual(binding.acknowledgement(client:a,request:3,applied:false)["rateState"] as? String,"pending")
        XCTAssertEqual(binding.acknowledgement(client:a,request:3,applied:false)["rateAppliedRevision"] as? Int,0)
    }
    func testNewDocumentStartsAtRevisionOneAndLegacyCannotUndoAdvancedChoice() {
        var binding = NativeRateBinding(); let value = NativeRatePreferences(value:2,preservesPitch:false)!
        XCTAssertTrue(binding.acceptsLegacy(client:a))
        XCTAssertTrue(binding.accept(value,revision:500,client:a,request:9))
        XCTAssertFalse(binding.acceptsLegacy(client:a)); XCTAssertTrue(binding.acceptsLegacy(client:b))
        XCTAssertTrue(binding.acknowledgement(client:b,request:1,applied:true).isEmpty)
        XCTAssertTrue(binding.accept(value,revision:1,client:b,request:1))
        XCTAssertEqual(binding.revision,1); XCTAssertFalse(binding.acceptsLegacy(client:b))
    }
}
