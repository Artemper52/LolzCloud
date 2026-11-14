import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import LolzCloudPolicy
final class MediaPolicyTests: XCTestCase {
    let audio = "https://lolzcloud.com/music/audio/123/abcdef0123456789abcdef01.mp3"
    func testIssuedMediaAddress() {
        XCTAssertNotNil(MediaPolicy.audio(audio))
        for url in [audio+"?token=x",audio+"#x",audio.replacingOccurrences(of:"https:",with:"http:"),audio.replacingOccurrences(of:"lolzcloud.com",with:"lolzcloud.com.attacker.test"),audio.replacingOccurrences(of:"https://",with:"https://user:pass@"),audio.replacingOccurrences(of:"/123/",with:"/../"),audio.replacingOccurrences(of:"lolzcloud.com",with:"lolzcloud.com:444")] { XCTAssertNil(MediaPolicy.audio(url),url) }
    }
    func testTrackAndFileIdentity() {
        XCTAssertNotNil(SavedTrack(["id":"123","audioUrl":audio,"title":"Песня","artist":"Артист","duration":89]))
        XCTAssertNil(SavedTrack(["id":"124","audioUrl":audio]))
        XCTAssertNil(SavedTrack(["id":"../outside","audioUrl":audio]))
        XCTAssertNil(SavedTrack(["id":"123","audioUrl":"file:///etc/passwd"]))
    }
    func testPairingCannotRedirectToAnotherOriginOrCode() {
        let code = "abcdefghijkl",url = "https://lolzcloud.com/connect?code="+code
        XCTAssertNotNil(MediaPolicy.verification(url,code:code))
        for address in [url+"&code=mnopqrstuvwx",url+"&next=https://example.com",url.replacingOccurrences(of:code,with:"mnopqrstuvwx"),url.replacingOccurrences(of:"lolzcloud.com",with:"example.com"),url+"#fragment"] { XCTAssertNil(MediaPolicy.verification(address,code:code)) }
        XCTAssertFalse(MediaPolicy.secret("short")); XCTAssertTrue(MediaPolicy.secret(String(repeating:"a",count:43)))
    }
    func testTimeRejectsNaNBooleanAndInvalidValues() {
        XCTAssertEqual(MediaPolicy.time(true),0); XCTAssertEqual(MediaPolicy.time(Double.nan),0); XCTAssertEqual(MediaPolicy.time(-8),0); XCTAssertEqual(MediaPolicy.time(17.5),17.5); XCTAssertEqual(MediaPolicy.time(Double.infinity),0)
    }
    func testBridgeRequiresExactOwnApplicationPathAndOrigin() {
        for value in ["https://lolzcloud.com/app", "https://lolzcloud.com/app/", "https://lolzcloud.com:443/app/?tab=profile"] { XCTAssertTrue(MediaPolicy.bridgePage(URL(string:value)),value) }
        for value in ["https://lolzcloud.com/application", "https://lolzcloud.com/app-attacker", "https://lolzcloud.com/social", "https://lolzcloud.com:444/app/", "https://user:pass@lolzcloud.com/app/", "http://lolzcloud.com/app/", "https://lolzcloud.com.attacker.test/app/"] { XCTAssertFalse(MediaPolicy.bridgePage(URL(string:value)),value) }
        XCTAssertFalse(MediaPolicy.bridgePage(nil))
    }
    func testAccountIdentityRejectsBooleanFractionalAndInvalidIdentifiers() {
        XCTAssertEqual(MediaPolicy.accountID(123),"123")
        for value: Any in [true,false,0,-1,1.5,"123",Double.infinity] { XCTAssertNil(MediaPolicy.accountID(value)) }
    }
    func testPauseOrNewSelectionCancelsInterruptionResume() {
        var intent = PlaybackIntent()
        _ = intent.select(); intent.interrupt(); intent.pause()
        XCTAssertFalse(intent.finishInterruption(shouldResume:true)); XCTAssertFalse(intent.wantsPlay)
        _ = intent.select(); intent.interrupt(); _ = intent.select()
        XCTAssertFalse(intent.finishInterruption(shouldResume:true)); XCTAssertTrue(intent.wantsPlay)
        intent.interrupt(); intent.stop()
        XCTAssertFalse(intent.finishInterruption(shouldResume:true)); XCTAssertFalse(intent.wantsPlay)
    }
    func testLoadingPlaybackResumesOnlyWhenSystemAllows() {
        var intent = PlaybackIntent()
        _ = intent.select(); intent.interrupt()
        XCTAssertTrue(intent.finishInterruption(shouldResume:true)); XCTAssertTrue(intent.wantsPlay)
        intent.interrupt(); XCTAssertFalse(intent.finishInterruption(shouldResume:false)); XCTAssertFalse(intent.wantsPlay)
    }
    func testLateOrRepeatedEndCannotConsumeAnotherQueueItem() {
        var intent = PlaybackIntent(), ticket = intent.select()
        intent.pause(); XCTAssertFalse(intent.ended(ticket))
        intent.resume(); XCTAssertTrue(intent.ended(ticket)); XCTAssertFalse(intent.ended(ticket))
        ticket = intent.select(); let newer = intent.select()
        XCTAssertFalse(intent.ended(ticket)); XCTAssertTrue(intent.ended(newer))
    }
    func testReplayRestartsEndedTrackAndPreservesMidTrackRetry() {
        XCTAssertEqual(MediaPolicy.replayPosition(ended:true,position:120,duration:120),0)
        XCTAssertEqual(MediaPolicy.replayPosition(ended:false,position:120,duration:120),0)
        XCTAssertEqual(MediaPolicy.replayPosition(ended:false,position:17,duration:120),17)
        XCTAssertEqual(MediaPolicy.replayPosition(ended:false,position:.nan,duration:120),0)
    }
    func testOversizedDownloadIsCancelledBeforeItCanFinish() {
        let session = URLSession(configuration:.ephemeral), delegate = NoRedirects(maximumDownloadBytes:20_000_000)
        defer { session.invalidateAndCancel() }
        let declared = session.downloadTask(with:URL(string:audio)!)
        delegate.urlSession(session,downloadTask:declared,didWriteData:1024,totalBytesWritten:1024,totalBytesExpectedToWrite:20_000_001)
        XCTAssertTrue(declared.state == .canceling || declared.state == .completed)
        let streaming = session.downloadTask(with:URL(string:audio)!)
        delegate.urlSession(session,downloadTask:streaming,didWriteData:1024,totalBytesWritten:20_000_001,totalBytesExpectedToWrite:-1)
        XCTAssertTrue(streaming.state == .canceling || streaming.state == .completed)
        let bounded = session.downloadTask(with:URL(string:audio)!)
        delegate.urlSession(session,downloadTask:bounded,didWriteData:1024,totalBytesWritten:1024,totalBytesExpectedToWrite:-1)
        XCTAssertEqual(bounded.state,.suspended)
    }
    func testAccountAndAudioNeverFollowRedirects() {
        let session = URLSession(configuration:.ephemeral), delegate = NoRedirects()
        defer { session.invalidateAndCancel() }
        let source = URL(string:audio)!, task = session.downloadTask(with:source)
        let response = HTTPURLResponse(url:source,statusCode:302,httpVersion:nil,headerFields:nil)!
        var called = false
        delegate.urlSession(session,task:task,willPerformHTTPRedirection:response,newRequest:URLRequest(url:URL(string:"https://attacker.test/audio")!)) { request in called = true; XCTAssertNil(request) }
        XCTAssertTrue(called)
    }
    func rows(_ count: Int = 3) -> [SavedTrack] {
        (1...count).map { SavedTrack(["id":String($0),"audioUrl":audio.replacingOccurrences(of:"/123/",with:"/\($0)/"),"title":"Song \($0)","artist":"Artist","duration":120])! }
    }
    func testQueueSnapshotPreservesNativeSelectionAcrossStaleForegroundIndex() {
        var queue = QueuePolicy(); let tracks = rows()
        XCTAssertTrue(queue.configure(tracks,index:0,repeatMode:"off",shuffle:false,currentID:nil))
        queue.select("2"); XCTAssertEqual(queue.current?.id,"2")
        XCTAssertTrue(queue.configure(tracks,index:0,repeatMode:"all",shuffle:false,currentID:"2"))
        XCTAssertEqual(queue.index,1); XCTAssertEqual(queue.current?.id,"2")
        XCTAssertEqual(queue.step(1)?.id,"3"); XCTAssertEqual(queue.step(-1)?.id,"2")
    }
    func testQueueNextPreviousAndEndRepeatDoNotSkipTracks() {
        var queue = QueuePolicy(); let tracks = rows()
        XCTAssertTrue(queue.configure(tracks,index:0,repeatMode:"off",shuffle:false,currentID:nil))
        XCTAssertEqual(queue.step(1,automatic:true)?.id,"2"); XCTAssertEqual(queue.step(1,automatic:true)?.id,"3"); XCTAssertNil(queue.step(1,automatic:true))
        XCTAssertTrue(queue.configure(tracks,index:0,repeatMode:"one",shuffle:false,currentID:"2"))
        XCTAssertEqual(queue.step(1,automatic:true)?.id,"2"); XCTAssertEqual(queue.step(1)?.id,"3")
        XCTAssertTrue(queue.configure(tracks,index:0,repeatMode:"all",shuffle:false,currentID:"3"))
        XCTAssertEqual(queue.step(1,automatic:true)?.id,"1")
    }
    func testShuffleExcludesCurrentAndPreviousReturnsToThePlayedTrack() {
        var queue = QueuePolicy()
        XCTAssertTrue(queue.configure(rows(),index:1,repeatMode:"off",shuffle:true,currentID:nil))
        XCTAssertEqual(queue.step(1,random:0)?.id,"3"); XCTAssertEqual(queue.step(-1)?.id,"2")
        XCTAssertEqual(queue.step(1,random:0.999)?.id,"1"); XCTAssertEqual(queue.step(-1)?.id,"2")
    }
    func testInvalidQueueCannotReplaceWorkingQueue() {
        var queue = QueuePolicy(); let tracks = rows()
        XCTAssertTrue(queue.configure(tracks,index:1,repeatMode:"off",shuffle:false,currentID:nil))
        XCTAssertFalse(queue.configure(rows(201),index:0,repeatMode:"all",shuffle:false,currentID:nil))
        XCTAssertFalse(queue.configure(tracks,index:20,repeatMode:"off",shuffle:false,currentID:nil))
        XCTAssertEqual(queue.current?.id,"2")
        XCTAssertTrue(queue.configure([tracks[0]],index:0,repeatMode:"off",shuffle:false,currentID:"2")); XCTAssertNil(queue.current)
    }
    func testPreparationRequiresSignedOwnAudioAndExactReadyIdentity() throws {
        XCTAssertEqual(MediaPolicy.preparation(audio)?.absoluteString,"https://lolzcloud.com/music/prepare/123/abcdef0123456789abcdef01")
        XCTAssertNil(MediaPolicy.preparation("https://attacker.test/audio.mp3"))
        let ready = try JSONSerialization.data(withJSONObject:["state":"ready","audioUrl":audio])
        XCTAssertTrue(try AudioPreparation.parse(status:200,data:ready,expected:audio).ready)
        XCTAssertThrowsError(try AudioPreparation.parse(status:200,data:ready,expected:audio.replacingOccurrences(of:"/123/",with:"/124/")))
        let invalid = try JSONSerialization.data(withJSONObject:["state":"preparing","retryAfterMs":true])
        XCTAssertThrowsError(try AudioPreparation.parse(status:202,data:invalid,expected:audio))
        XCTAssertThrowsError(try AudioPreparation.parse(status:200,data:Data(repeating:65,count:17000),expected:audio))
    }
    func testColdPreparationPollsUntilReadyWithBoundedRequestTimeout() async throws {
        var time = 0.0, calls = 0
        try await AudioPreparation.awaitReady(audio:audio,request:{ endpoint, timeout in
            XCTAssertEqual(endpoint,MediaPolicy.preparation(self.audio)); XCTAssertLessThanOrEqual(timeout,10); calls += 1
            return AudioPreparation.Reply(ready:calls == 3,retryAfter:1)
        },now:{time},sleep:{time += $0})
        XCTAssertEqual(calls,3); XCTAssertEqual(time,2)
    }
    func testPreparationDeadlineAndNetworkRetriesAreFinite() async {
        var time = 0.0, calls = 0
        do {
            try await AudioPreparation.awaitReady(audio:audio,request:{ _,timeout in calls += 1; time += timeout; return AudioPreparation.Reply(ready:false,retryAfter:3) },now:{time},sleep:{time += $0})
            XCTFail("A permanently cold track must time out")
        } catch { XCTAssertEqual(time,125); XCTAssertLessThanOrEqual(calls,13) }
        calls = 0; time = 0
        do {
            try await AudioPreparation.awaitReady(audio:audio,request:{ _,_ in calls += 1; throw URLError(.timedOut) },now:{time},sleep:{time += $0})
            XCTFail("Network retries must stop")
        } catch { XCTAssertEqual(calls,3) }
    }
    func testCancelledPreparationCannotFinishLater() async {
        let entered = expectation(description:"Preparation request started")
        let task = Task {
            try await AudioPreparation.awaitReady(audio:self.audio,request:{ _,_ in entered.fulfill(); return AudioPreparation.Reply(ready:false,retryAfter:1) })
        }
        await fulfillment(of:[entered],timeout:2); task.cancel()
        do { try await task.value; XCTFail("Cancelled preparation must not start playback") }
        catch { XCTAssertTrue(error is CancellationError) }
    }
    func testPlaybackRateBoundsPreserveThePreviousSetting() {
        var settings = PlaybackSettings(), intent = PlaybackIntent()
        _ = intent.select(); intent.pause()
        for rate in [0.5,0.85,1,1.2,2] { XCTAssertTrue(settings.setRate(rate)); XCTAssertEqual(settings.rate,rate); XCTAssertFalse(intent.wantsPlay) }
        for rate in [Double.nan,Double.infinity,0.49,2.01,-1] { XCTAssertFalse(settings.setRate(rate)); XCTAssertEqual(settings.rate,2) }
        XCTAssertNil(MediaPolicy.number(true)); XCTAssertNil(MediaPolicy.number(Double.nan))
    }
    func testSleepOffAndReplacementRejectOldDeadline() {
        var settings = PlaybackSettings()
        XCTAssertTrue(settings.setSleep(minutes:15,now:1000)); let first = settings.sleepDeadline
        XCTAssertEqual(first,901000)
        XCTAssertTrue(settings.setSleep(minutes:30,now:2000)); let second = settings.sleepDeadline
        XCTAssertFalse(settings.expireSleep(first)); XCTAssertEqual(settings.sleepDeadline,second)
        XCTAssertTrue(settings.setSleep(minutes:0,now:3000)); XCTAssertEqual(settings.sleepDeadline,0)
        XCTAssertFalse(settings.expireSleep(second))
        XCTAssertFalse(settings.setSleep(minutes:1,now:3000)); XCTAssertEqual(settings.sleepDeadline,0)
        XCTAssertTrue(settings.setSleep(minutes:60,now:4000)); XCTAssertTrue(settings.expireSleep(settings.sleepDeadline)); XCTAssertEqual(settings.sleepDeadline,0)
    }
    func testOfflineRetryReplacesOnlyAnUnindexedOrphanAndRollsBackIndexFailure() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LolzCloud-ios-commit-"+UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:directory) }
        let temporary = directory.appendingPathComponent("new.download"), destination = directory.appendingPathComponent("123.mp3"), index = directory.appendingPathComponent("index.json"), unrelated = directory.appendingPathComponent("456.mp3")
        try Data("old orphan".utf8).write(to:destination); try Data("keep other music".utf8).write(to:unrelated); try Data("new verified audio".utf8).write(to:temporary)
        try OfflineCommit.install(temporary:temporary,destination:destination,index:index,data:Data("[]".utf8))
        XCTAssertEqual(try Data(contentsOf:destination),Data("new verified audio".utf8)); XCTAssertFalse(FileManager.default.fileExists(atPath:temporary.path))
        XCTAssertEqual(try Data(contentsOf:unrelated),Data("keep other music".utf8))
        try Data("another verified audio".utf8).write(to:temporary)
        XCTAssertThrowsError(try OfflineCommit.install(temporary:temporary,destination:destination,index:directory.appendingPathComponent("missing/index.json"),data:Data("[]".utf8)))
        XCTAssertFalse(FileManager.default.fileExists(atPath:destination.path)); XCTAssertEqual(try Data(contentsOf:unrelated),Data("keep other music".utf8))
    }
    let localID = "local:12345678-1234-4234-8234-123456789abc"
    func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LolzCloud-import-test-"+UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:directory) }
        return directory
    }
    func testLocalPublicTrackCannotSelectAPathOrNetworkURL() throws {
        let local = SavedTrack.imported(id:localID,title:"Моя запись",artist:"Артист",duration:100,fileExtension:"wav")!
        XCTAssertTrue(local.isLocal); XCTAssertEqual(local.audioUrl,"")
        XCTAssertNil(local.object["fileExtension"]); XCTAssertEqual(local.object["source"] as? String,"local")
        XCTAssertEqual(LocalAudioFiles.filename(local),"local-12345678-1234-4234-8234-123456789abc.wav")
        let publicTrack = SavedTrack(local.object)!
        XCTAssertNil(LocalAudioFiles.filename(publicTrack),"A public bridge object is not a registered file")
        XCTAssertNil(MediaPolicy.preparation(local.audioUrl))
        for address in [audio,"file:///private/other.wav","../../other.wav"] {
            var value = local.object; value["audioUrl"] = address; XCTAssertNil(SavedTrack(value))
        }
        for id in ["local:../../outside",localID.uppercased(),"123"] { var value = local.object; value["id"] = id; XCTAssertNil(SavedTrack(value)) }
        var encoded = local.object; encoded["fileExtension"] = "../../outside"
        XCTAssertThrowsError(try JSONDecoder().decode(SavedTrack.self,from:JSONSerialization.data(withJSONObject:encoded)))
    }
    func testLegacyNetworkIndexAndPrivateLocalMetadataSurviveRoundTrip() throws {
        var legacy = rows()[0].object; legacy.removeValue(forKey:"source"); legacy.removeValue(forKey:"local")
        let restored = try JSONDecoder().decode(SavedTrack.self,from:JSONSerialization.data(withJSONObject:legacy))
        XCTAssertFalse(restored.isLocal); XCTAssertEqual(LocalAudioFiles.filename(restored),"1.mp3")
        let local = SavedTrack.imported(id:localID,title:"Запись",artist:"",duration:89,fileExtension:"flac")!
        let stored = try JSONDecoder().decode(SavedTrack.self,from:JSONEncoder().encode(local))
        XCTAssertEqual(stored.fileExtension,"flac"); XCTAssertEqual(stored.id,localID)
        XCTAssertNil(stored.object["fileExtension"])
    }
    func testStagingUsesGeneratedNameBoundsBytesAndPreservesOriginal() throws {
        let directory = try temporaryDirectory(), source = directory.appendingPathComponent("Original song.WAV"), owned = directory.appendingPathComponent("owned",isDirectory:true), bytes = Data(repeating:7,count:2048)
        try bytes.write(to:source)
        let staged = try LocalAudioFiles.stage(source,in:owned)
        XCTAssertTrue(MediaPolicy.localIdentifier(staged.id)); XCTAssertEqual(staged.fileExtension,"wav"); XCTAssertEqual(staged.bytes,2048)
        XCTAssertNotEqual(staged.url.lastPathComponent,source.lastPathComponent); XCTAssertEqual(try Data(contentsOf:staged.url),bytes); XCTAssertEqual(try Data(contentsOf:source),bytes)
        XCTAssertThrowsError(try LocalAudioFiles.stage(source,in:owned,maximum:1024))
        let wrong = directory.appendingPathComponent("program.exe"); try bytes.write(to:wrong)
        XCTAssertThrowsError(try LocalAudioFiles.stage(wrong,in:owned))
        XCTAssertThrowsError(try LocalAudioFiles.stage(URL(string:"https://example.com/song.mp3")!,in:owned))
    }
    func testLocalRegistryRejectsMissingFilesAndSymbolicLinks() throws {
        let directory = try temporaryDirectory(), local = SavedTrack.imported(id:localID,title:"Track",artist:"",duration:20,fileExtension:"wav")!
        let file = directory.appendingPathComponent(LocalAudioFiles.filename(local)!), other = directory.appendingPathComponent("other.wav")
        XCTAssertNil(LocalAudioFiles.existing(local,in:directory))
        try Data(repeating:1,count:200).write(to:file); XCTAssertEqual(LocalAudioFiles.existing(local,in:directory),file)
        try FileManager.default.removeItem(at:file); try Data(repeating:2,count:200).write(to:other); try FileManager.default.createSymbolicLink(at:file,withDestinationURL:other)
        XCTAssertNil(LocalAudioFiles.existing(local,in:directory)); XCTAssertThrowsError(try LocalAudioFiles.stage(file,in:directory))
    }
    func testInterruptedLocalCommitRecoversIndexExactlyOnce() throws {
        let directory = try temporaryDirectory(), local = SavedTrack.imported(id:localID,title:"Track",artist:"",duration:20,fileExtension:"wav")!, index = directory.appendingPathComponent("index.json")
        let destination = directory.appendingPathComponent(LocalAudioFiles.filename(local)!), journal = directory.appendingPathComponent(".local-12345678-1234-4234-8234-123456789abc.pending.json")
        try Data(repeating:3,count:200).write(to:destination); try JSONEncoder().encode(local).write(to:journal)
        let recovered = LocalAudioFiles.recover(in:directory,index:index,registered:[])
        XCTAssertEqual(recovered.map(\.id),[localID]); XCTAssertFalse(FileManager.default.fileExists(atPath:journal.path))
        XCTAssertEqual(try JSONDecoder().decode([SavedTrack].self,from:Data(contentsOf:index)).first?.id,localID)
        try JSONEncoder().encode(local).write(to:journal)
        XCTAssertEqual(LocalAudioFiles.recover(in:directory,index:index,registered:recovered).count,1)
        XCTAssertEqual(try Data(contentsOf:destination),Data(repeating:3,count:200))
    }
    func testFailedLocalIndexCommitLeavesOriginalAndOtherMusicIntact() throws {
        let directory = try temporaryDirectory(), original = directory.appendingPathComponent("original.wav"), local = SavedTrack.imported(id:localID,title:"Track",artist:"",duration:20,fileExtension:"wav")!
        try Data(repeating:4,count:200).write(to:original)
        let staged = try LocalAudioFiles.stage(original,in:directory), destination = directory.appendingPathComponent(LocalAudioFiles.filename(local)!)
        XCTAssertThrowsError(try LocalAudioFiles.commit(local,temporary:staged.url,in:directory,index:directory.appendingPathComponent("missing/index.json"),registered:[]))
        XCTAssertFalse(FileManager.default.fileExists(atPath:destination.path)); XCTAssertTrue(FileManager.default.fileExists(atPath:original.path))
    }
    func testMixedQueueUsesTheSameRepeatShuffleAndPreviousRules() {
        var queue = QueuePolicy(); let local = SavedTrack.imported(id:localID,title:"Track",artist:"",duration:20,fileExtension:"mp3")!, network = rows()
        XCTAssertTrue(queue.configure([network[0],local,network[1]],index:0,repeatMode:"off",shuffle:false,currentID:nil))
        XCTAssertEqual(queue.step(1)?.id,localID); XCTAssertTrue(queue.current!.isLocal)
        XCTAssertEqual(queue.step(1)?.id,"2"); XCTAssertEqual(queue.step(-1)?.id,localID)
        XCTAssertTrue(queue.configure([network[0],local,network[1]],index:0,repeatMode:"one",shuffle:true,currentID:localID))
        XCTAssertEqual(queue.step(1,automatic:true)?.id,localID); XCTAssertNotEqual(queue.step(1,random:0)?.id,localID)
        let unavailable = SavedTrack(local.object)!
        XCTAssertNil(LocalAudioFiles.filename(unavailable))
        XCTAssertTrue(queue.configure([network[0],unavailable,network[1]],index:0,repeatMode:"off",shuffle:false,currentID:nil))
        XCTAssertTrue(queue.select("2",index:2)); XCTAssertEqual(queue.index,2,"An unavailable local reference must not invalidate neighbouring network tracks")
    }
    func testCrashCleanupRemovesOnlyOwnedStagesAndCountsOrphanAudioTowardsQuota() throws {
        let directory = try temporaryDirectory(), stage = directory.appendingPathComponent(".import-12345678-1234-4234-8234-123456789abc.wav"), orphan = directory.appendingPathComponent("local-12345678-1234-4234-8234-123456789abc.wav"), unrelated = directory.appendingPathComponent("keep-my.wav")
        try Data(repeating:1,count:200).write(to:stage); try Data(repeating:2,count:300).write(to:orphan); try Data(repeating:3,count:400).write(to:unrelated)
        XCTAssertEqual(LocalAudioFiles.storedBytes(in:directory),300)
        _ = LocalAudioFiles.recover(in:directory,index:directory.appendingPathComponent("index.json"),registered:[])
        XCTAssertFalse(FileManager.default.fileExists(atPath:stage.path)); XCTAssertTrue(FileManager.default.fileExists(atPath:orphan.path)); XCTAssertTrue(FileManager.default.fileExists(atPath:unrelated.path))
        XCTAssertEqual(LocalAudioFiles.storedBytes(in:directory),300)
    }
    func testDuplicateQueuePreservesOccurrenceAndValidatesExplicitIndex() {
        XCTAssertEqual(MediaPolicy.queueIndex(2),2)
        for value: Any in [true,-1,200,2.5,"2",Double.nan] { XCTAssertNil(MediaPolicy.queueIndex(value)) }
        var queue = QueuePolicy(); let network = rows(), repeated = [network[0],network[1],network[0]]
        XCTAssertTrue(queue.configure(repeated,index:0,repeatMode:"off",shuffle:false,currentID:nil))
        XCTAssertTrue(queue.select("1",index:2)); XCTAssertEqual(queue.index,2)
        XCTAssertFalse(queue.select("1",index:1)); XCTAssertFalse(queue.select("1",index:200)); XCTAssertEqual(queue.index,2)
        XCTAssertTrue(queue.configure(repeated,index:0,repeatMode:"off",shuffle:false,currentID:"1")); XCTAssertEqual(queue.index,2)
        XCTAssertEqual(queue.step(-1)?.id,"1"); XCTAssertEqual(queue.index,0)
        XCTAssertEqual(queue.step(1)?.id,"2"); XCTAssertEqual(queue.index,1)
        XCTAssertEqual(queue.step(1,automatic:true)?.id,"1"); XCTAssertEqual(queue.index,2)
        XCTAssertNil(queue.step(1,automatic:true))
        XCTAssertTrue(queue.configure(repeated,index:0,repeatMode:"all",shuffle:false,currentID:"1"))
        XCTAssertEqual(queue.step(1,automatic:true)?.id,"1"); XCTAssertEqual(queue.index,0)
    }
    func testNativeClientRejectsStaleIntentsAndEchoesSystemQueueOwnership() {
        let first = "12345678-1234-4234-8234-123456789abc"
        var client = NativeClientIntent(), playback = PlaybackIntent()
        XCTAssertFalse(client.accept(client:first,request:1,handshake:false))
        XCTAssertTrue(client.accept(client:first,request:1,handshake:true))
        XCTAssertTrue(client.accept(client:first,request:2,handshake:false))
        XCTAssertFalse(client.accept(client:first,request:1,handshake:false))
        XCTAssertTrue(client.accept(client:first,request:2,handshake:false),"Stop, queue and play may share one intent")
        _ = playback.select(); _ = playback.select()
        XCTAssertEqual(client.fields["clientId"] as? String,first); XCTAssertEqual(client.fields["requestId"] as? Int,2,"Native Next does not change the document request tag")
    }
    func testNewDocumentHandshakeRetiresOldClientAndValidatesRequestNumbers() {
        let first = "12345678-1234-4234-8234-123456789abc", second = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        var client = NativeClientIntent()
        XCTAssertTrue(client.accept(client:first,request:500,handshake:true))
        XCTAssertFalse(client.accept(client:second,request:1,handshake:false))
        XCTAssertTrue(client.accept(client:second,request:1,handshake:true))
        XCTAssertFalse(client.accept(client:first,request:501,handshake:true))
        XCTAssertEqual(client.fields["clientId"] as? String,second)
        for value: Any in [true,0,-1,1.5,Double.nan,9_007_199_254_740_992.0,"1"] { XCTAssertNil(MediaPolicy.requestID(value)) }
        XCTAssertEqual(MediaPolicy.requestID(1),1)
        XCTAssertFalse(client.accept(client:second.uppercased(),request:2,handshake:true))
    }
}
