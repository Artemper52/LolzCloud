import XCTest
@testable import LolzCloudPolicy

final class PortableProfileFileTests: XCTestCase {
    let operation = "12345678-1234-4567-89ab-123456789abc"
    let filename = "LolzCloud-profile-2026-11-15.json"
    func json(_ changes: [String:Any] = [:]) throws -> String {
        var value: [String:Any] = ["format":"lolzcloud-profile","version":1,"music":[:],"wave":[:],"tools":[:]]
        value.merge(changes){_,new in new}
        return String(data:try JSONSerialization.data(withJSONObject:value),encoding:.utf8)!
    }
    func testCanonicalProfileFileRemainsExactlyTheReviewedUTF8Data() throws {
        let text = try json(["music":["preferences":["density":"compact"]]])
        let data = try PortableProfileFile.data(json:text,filename:filename,operationID:operation)
        XCTAssertEqual(String(data:data,encoding:.utf8),text)
    }
    func testFileBridgeRejectsForeignFormatBooleanVersionAndUnreviewedRootFields() throws {
        let changes: [[String:Any]] = [["format":"other"],["version":true],["version":2],["cookies":"private"],["music":[]],["wave":"wrong"]]
        for change in changes {
            XCTAssertThrowsError(try PortableProfileFile.data(json:json(change),filename:filename,operationID:operation))
        }
        XCTAssertThrowsError(try PortableProfileFile.data(json:"{broken",filename:filename,operationID:operation))
    }
    func testFileBridgeCannotSelectPathsOrUnboundOperationsAndCountsUTF8Bytes() throws {
        let text = try json()
        for name in ["../profile.json","/tmp/profile.json","LolzCloud-profile-2026-11-15.json/other","LolzCloud-profile-2026-11-15.json\n"] {
            XCTAssertThrowsError(try PortableProfileFile.data(json:text,filename:name,operationID:operation))
        }
        XCTAssertThrowsError(try PortableProfileFile.data(json:text,filename:filename,operationID:"unbound"))
        let large = try json(["music":["description":String(repeating:"я",count:375000)]])
        XCTAssertGreaterThan(large.utf8.count,PortableProfileFile.maximumBytes)
        XCTAssertThrowsError(try PortableProfileFile.data(json:large,filename:filename,operationID:operation))
    }
}
