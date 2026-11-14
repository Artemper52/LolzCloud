import XCTest
@testable import LolzCloudPolicy

final class NativeCatalogTests: XCTestCase {
    let source = "https://soundcloud.com/test/saved-song"
    let audio = "https://lolzcloud.com/music/audio/123/abcdef0123456789abcdef01.mp3"
    func reference(_ id: String = "123",source: String? = nil) -> SavedTrack {
        SavedTrack(["id":id,"source":"catalog","audioUrl":"","url":source ?? self.source,"title":"Saved song","artist":"Artist","duration":90])!
    }
    func resolved(_ id: String = "123",source: String? = nil) -> [String:Any] {
        ["id":id,"url":source ?? self.source,"audioUrl":audio.replacingOccurrences(of:"/123/",with:"/"+id+"/"),"title":"Saved song","artist":"Artist","duration":90,"cover":""]
    }
    func reply(_ address: URL,_ body: Any,status: Int = 200,final: URL? = nil) throws -> NativeCatalog.Reply {
        NativeCatalog.Reply(status:status,body:try JSONSerialization.data(withJSONObject:body),url:final ?? address,mimeType:"application/json")
    }
    func testExplicitReferencesHaveNoAudioURLAndSurviveCodable() throws {
        for value in [reference(),reference("ref:"+source)] {
            XCTAssertTrue(value.isCatalogReference);XCTAssertFalse(value.isLocal);XCTAssertEqual(value.audioUrl,"")
            let decoded = try JSONDecoder().decode(SavedTrack.self,from:JSONEncoder().encode(value))
            XCTAssertEqual(decoded.sourceUrl,source);XCTAssertEqual(decoded.id,value.id);XCTAssertTrue(decoded.isCatalogReference)
        }
        XCTAssertNil(SavedTrack(["id":"123","url":source]))
        for patch in [["id":"ref:https://evil.test/a/b"],["audioUrl":"https://evil.test/song.mp3"],["url":"https://evil.test/a/b"],["id":"local:12345678-1234-4567-89ab-123456789abc"],["local":true]] as [[String:Any]] {
            var object=reference().object;object.merge(patch){_,value in value};XCTAssertNil(SavedTrack(object))
        }
    }
    func testNumericIdentityResolvesThroughFixedMetadataEndpoint() async throws {
        let track=reference(),value=try await NativeCatalog.resolve(track){address,timeout in
            XCTAssertEqual(address.absoluteString,"https://lolzcloud.com/music/track/123");XCTAssertEqual(timeout,10)
            return try self.reply(address,["track":self.resolved()])
        }
        XCTAssertEqual(value.id,"123");XCTAssertEqual(value.audioUrl,audio);XCTAssertEqual(value.sourceUrl,source);XCTAssertFalse(value.isCatalogReference)
    }
    func testURLReferenceMatchesTheExactPermalinkRatherThanTheFirstSearchResult() async throws {
        let value=try await NativeCatalog.resolve(reference("ref:"+source)){address,_ in
            let parts=URLComponents(url:address,resolvingAgainstBaseURL:false)!
            XCTAssertEqual(address.host,"lolzcloud.com");XCTAssertEqual(address.path,"/music/search")
            XCTAssertEqual(parts.queryItems?.first(where:{$0.name=="q"})?.value,self.source)
            return try self.reply(address,["tracks":[self.resolved("456",source:"https://soundcloud.com/test/wrong-song"),self.resolved()]])
        }
        XCTAssertEqual(value.id,"123");XCTAssertEqual(value.sourceUrl,source)
    }
    func testMetadataCannotSubstituteIdentityRedirectOrUnboundedData() async {
        for variant in ["other-id","redirect","large","wrong-url","missing-title","bad-audio","duplicate"] {
            do {
                _ = try await NativeCatalog.resolve(variant == "duplicate" ? reference("ref:"+source) : reference()){address,_ in
                    if variant=="large" { return NativeCatalog.Reply(status:200,body:Data(repeating:32,count:64001),url:address,mimeType:"application/json") }
                    var row=self.resolved(variant=="other-id" ? "456":"123")
                    if variant=="wrong-url" {row["url"]="https://evil.test/a/b"}
                    if variant=="missing-title" {row.removeValue(forKey:"title")}
                    if variant=="bad-audio" {row["audioUrl"]="https://evil.test/song.mp3"}
                    if variant=="duplicate" {return try self.reply(address,["tracks":[row,row]])}
                    return try self.reply(address,["track":row],final:variant=="redirect" ? URL(string:"https://evil.test/")!:nil)
                }
                XCTFail("Accepted invalid metadata: "+variant)
            } catch { }
        }
    }
    func testLocalFilesNeverUseCatalogueAndCancellationNeverCommitsAReply() async throws {
        let local=SavedTrack.imported(id:"local:12345678-1234-4567-89ab-123456789abc",title:"Local",artist:"Artist",duration:90,fileExtension:"wav")!
        let untouched=try await NativeCatalog.resolve(local){_,_ in XCTFail("Local file requested network");throw CancellationError()}
        XCTAssertEqual(untouched.id,local.id)
        let operation=Task {try await NativeCatalog.resolve(self.reference()){_,_ in
            try Task.checkCancellation();throw CancellationError()
        }}
        operation.cancel()
        do {_ = try await operation.value;XCTFail("Cancelled metadata was accepted")}catch is CancellationError{}catch{XCTFail("Wrong cancellation error")}
    }
    func testQueueKeepsExactDuplicateOccurrenceAndResolvedMetadataAcrossStaleReferenceSnapshot() throws {
        let alias=reference("ref:"+source),ready=SavedTrack(resolved())!,other=SavedTrack(resolved("456",source:"https://soundcloud.com/test/other"))!
        var queue=QueuePolicy();XCTAssertTrue(queue.configure([alias,alias,other],index:1,repeatMode:"all",shuffle:false,currentID:nil))
        XCTAssertTrue(queue.refreshCurrent(ready,expectedID:alias.id));XCTAssertEqual(queue.index,1);XCTAssertEqual(queue.current?.id,"123")
        XCTAssertTrue(queue.configure([alias,alias,other],index:0,repeatMode:"all",shuffle:false,currentID:"123"))
        XCTAssertEqual(queue.index,1);XCTAssertEqual(queue.current?.audioUrl,audio);XCTAssertTrue(queue.tracks[0].isCatalogReference)
        XCTAssertEqual(queue.step(1)?.id,"456");XCTAssertEqual(queue.step(-1)?.audioUrl,audio)
        XCTAssertFalse(queue.refreshCurrent(other,expectedID:"123"))
    }
}
