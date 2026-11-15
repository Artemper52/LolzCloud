import XCTest
@testable import LolzCloudPolicy

final class NativeRoomPolicyTests: XCTestCase {
    private let client="12345678-1234-4234-8234-123456789abc",doc="12345678-1234-4234-8234-123456789abd"
    private func object(active: Bool=true,epoch: Int=1,revision: Int=1,document: String?=nil) -> [String:Any] {
        ["roomId":String(repeating:"a",count:32),"documentId":document ?? doc,"epoch":epoch,"revision":revision,"active":active,
         "playback":["url":"https://soundcloud.com/artist/song","title":"Song","artist":"Artist","cover":"","duration":200,"position":12,"playing":active],
         "capabilities":["play":true,"pause":true,"next":true,"previous":true,"seek":true]]
    }
    func testStrictSnapshotRejectsUnsafeURLsBooleanNumbersAndMissingCapability() throws {
        XCTAssertNotNil(NativeRoomTransport(object()))
        for unsafeURL in ["file:///private/audio.mp3","http://soundcloud.com/a/b","https://soundcloud.com.evil/a/b","https://music.youtube.com/watch?v=bad","https://soundcloud.com/a/b\n","https://soundcloud.com/a/b%0A","https://music.youtube.com/watch?v=abcdefghijk%0A"] {
            var row=object();var playback=row["playback"] as! [String:Any];playback["url"]=unsafeURL;row["playback"]=playback;XCTAssertNil(NativeRoomTransport(row))
        }
        var row=object();row["epoch"]=true;XCTAssertNil(NativeRoomTransport(row))
        row=object();row["active"]=1;XCTAssertNil(NativeRoomTransport(row))
        row=object();row["capabilities"]=["play":true];XCTAssertNil(NativeRoomTransport(row))
        row=object();row["roomId"]=String(repeating:"a",count:32)+"\n";XCTAssertNil(NativeRoomTransport(row))
    }
    func testLateReleaseCannotClearNewRoomDocument() throws {
        var binding=NativeRoomBinding()
        XCTAssertEqual(binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1),.acquired)
        let other="12345678-1234-4234-8234-123456789abe"
        XCTAssertEqual(binding.accept(try XCTUnwrap(NativeRoomTransport(object(document:other))),client:client,request:1),.acquired)
        XCTAssertNil(binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:100))),client:client,request:1))
        XCTAssertEqual(binding.current?.documentID,other)
    }
    func testReleaseNeverResumesSoloAndNewEpochAllowsIndependentRevision() throws {
        var binding=NativeRoomBinding()
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(revision:20))),client:client,request:1)
        XCTAssertTrue(binding.soloBlocked)
        XCTAssertEqual(binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:21))),client:client,request:1),.released)
        XCTAssertNil(binding.current);XCTAssertTrue(binding.soloBlocked)
        XCTAssertNil(binding.accept(try XCTUnwrap(NativeRoomTransport(object(revision:22))),client:client,request:1))
        XCTAssertEqual(binding.accept(try XCTUnwrap(NativeRoomTransport(object(epoch:2,revision:1))),client:client,request:1),.acquired)
        XCTAssertFalse(binding.chooseSolo());XCTAssertTrue(binding.soloBlocked)
    }
    func testDuplicateSnapshotRebindsButCannotConflictinglyRewriteRevision() throws {
        var binding=NativeRoomBinding();let state=try XCTUnwrap(NativeRoomTransport(object()))
        _=binding.accept(state,client:client,request:1);let generation=binding.generation
        XCTAssertEqual(binding.accept(state,client:client,request:2),.updated);XCTAssertEqual(binding.generation,generation)
        var bad=object();bad["active"]=false;XCTAssertNil(binding.accept(try XCTUnwrap(NativeRoomTransport(bad)),client:client,request:2))
        XCTAssertEqual(binding.current,state)
    }
    func testCommandsExpireAfterThreeSecondsAndCannotCrossReleaseOrReacquire() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        let command=try XCTUnwrap(binding.command("next",value:nil,now:10))
        XCTAssertTrue(binding.owns(command,now:12.9));XCTAssertFalse(binding.owns(command,now:13.1))
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:2))),client:client,request:1)
        XCTAssertFalse(binding.owns(command,now:11));XCTAssertNil(binding.command("play",value:nil,now:11))
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(epoch:2,revision:3))),client:client,request:1)
        XCTAssertFalse(binding.owns(command,now:11))
    }
    func testCapabilityAndSeekValidationDoNotSelectSoloOrChangeGeneration() throws {
        var row=object();row["capabilities"]=["play":true,"pause":true,"next":false,"previous":false,"seek":true]
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(row)),client:client,request:1);let generation=binding.generation
        XCTAssertNil(binding.command("next",value:nil,now:0));XCTAssertNil(binding.command("seek",value:.nan,now:0))
        let command=try XCTUnwrap(binding.command("seek",value:300,now:0));XCTAssertEqual(command.value,200)
        XCTAssertEqual(binding.generation,generation);XCTAssertTrue(binding.soloBlocked)
    }
    func testExplicitSoloAfterReleaseDropsTheFenceAndInvalidatesOldCommands() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        let command=try XCTUnwrap(binding.command("play",value:nil,now:0))
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:2))),client:client,request:1)
        XCTAssertTrue(binding.chooseSolo());XCTAssertFalse(binding.soloBlocked);XCTAssertFalse(binding.owns(command,now:1))
    }
    func testOfflineRetirementRejectsOldDocumentEvenWithLargerEpoch() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        let command=try XCTUnwrap(binding.command("next",value:nil,now:0))
        XCTAssertTrue(binding.retireForOffline(expectedGeneration:binding.generation))
        XCTAssertNil(binding.current);XCTAssertTrue(binding.soloBlocked);XCTAssertFalse(binding.owns(command,now:1))
        XCTAssertNil(binding.accept(try XCTUnwrap(NativeRoomTransport(object(epoch:100,revision:500))),client:client,request:1))
        XCTAssertTrue(binding.chooseSolo())
    }
    func testDelayedOfflineCompletionCannotRetireNewRoomOrExplicitSolo() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        let ticket=binding.generation,other="12345678-1234-4234-8234-123456789abe"
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(document:other))),client:client,request:1)
        XCTAssertFalse(binding.retireForOffline(expectedGeneration:ticket));XCTAssertEqual(binding.current?.documentID,other)
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:2,document:other))),client:client,request:1)
        let paused=binding.generation;XCTAssertTrue(binding.chooseSolo())
        XCTAssertFalse(binding.retireForOffline(expectedGeneration:paused));XCTAssertFalse(binding.soloBlocked)
    }
    func testParentDocumentReplacementRetiresRoomButKeepsSoloFence() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        let command=try XCTUnwrap(binding.command("next",value:nil,now:0))
        binding.parentDocumentReplaced()
        XCTAssertNil(binding.current);XCTAssertTrue(binding.soloBlocked);XCTAssertFalse(binding.owns(command,now:1))
        XCTAssertNil(binding.accept(try XCTUnwrap(NativeRoomTransport(object(epoch:100))),client:client,request:1))
        XCTAssertTrue(binding.chooseSolo());XCTAssertFalse(binding.soloBlocked)
    }
    func testUIReloadAfterExplicitSoloDoesNotIntroduceAnotherPlaybackFence() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:2))),client:client,request:1)
        XCTAssertTrue(binding.chooseSolo());binding.parentDocumentReplaced()
        XCTAssertNil(binding.current);XCTAssertFalse(binding.soloBlocked)
    }
    func testAcceptedDeliveryHasBoundedCompletionTimeWithoutRepeatedExtension() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        var command=try XCTUnwrap(binding.command("next",value:nil,now:10))
        XCTAssertTrue(command.acceptDelivery(now:12));XCTAssertTrue(command.acceptedDelivery);XCTAssertEqual(command.deadline,72)
        XCTAssertTrue(binding.owns(command,now:15),"A genuine slow SDK Next is not a delivery timeout")
        XCTAssertTrue(command.acceptDelivery(now:50));XCTAssertEqual(command.deadline,72)
        XCTAssertTrue(binding.owns(command,now:71.9));XCTAssertFalse(binding.owns(command,now:72.1))
        XCTAssertFalse(command.acceptDelivery(now:72.1))
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:2))),client:client,request:1)
        XCTAssertFalse(binding.owns(command,now:20),"Even accepted work cannot cross room release")
    }
    func testExpiredDeliveryCannotBeResurrectedByLateAcceptedResult() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        var command=try XCTUnwrap(binding.command("next",value:nil,now:0))
        XCTAssertFalse(command.acceptDelivery(now:3.1));XCTAssertFalse(command.acceptedDelivery);XCTAssertEqual(command.deadline,3)
    }
    func testOnlyRoomCommandsAttemptBackgroundDeliveryOnReadyTrustedParent() {
        for event in ["room-command","room-command-result","playback","effects","account","download","profileExport","capabilities"] {
            let room=event=="room-command" || event=="room-command-result"
            XCTAssertEqual(NativeRoomDelivery.mayEvaluate(event:event,applicationActive:false,pageReady:true,trustedParent:true,offline:false),room)
            XCTAssertTrue(NativeRoomDelivery.mayEvaluate(event:event,applicationActive:true,pageReady:true,trustedParent:true,offline:false))
            XCTAssertFalse(NativeRoomDelivery.mayEvaluate(event:event,applicationActive:false,pageReady:false,trustedParent:true,offline:false))
            XCTAssertFalse(NativeRoomDelivery.mayEvaluate(event:event,applicationActive:false,pageReady:true,trustedParent:false,offline:false))
            XCTAssertFalse(NativeRoomDelivery.mayEvaluate(event:event,applicationActive:true,pageReady:true,trustedParent:true,offline:true))
        }
    }
    func testBackgroundAttemptNeverExtendsExpiredCommandOrCrossesOwnerRelease() throws {
        var binding=NativeRoomBinding();_=binding.accept(try XCTUnwrap(NativeRoomTransport(object())),client:client,request:1)
        let command=try XCTUnwrap(binding.command("next",value:nil,now:0))
        let allowed=NativeRoomDelivery.mayEvaluate(event:"room-command",applicationActive:false,pageReady:true,trustedParent:true,offline:false)
        XCTAssertTrue(allowed && binding.owns(command,now:1))
        XCTAssertFalse(allowed && binding.owns(command,now:3.1))
        _=binding.accept(try XCTUnwrap(NativeRoomTransport(object(active:false,revision:2))),client:client,request:1)
        XCTAssertFalse(allowed && binding.owns(command,now:1))
    }
}
