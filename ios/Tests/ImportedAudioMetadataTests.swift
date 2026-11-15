import XCTest
@testable import LolzCloudPolicy

final class ImportedAudioMetadataTests: XCTestCase {
    func testEmbeddedIdentityOverridesOpaqueFilenameAndPersistsInTrack() throws {
        let value=ImportedAudioMetadata(title:"Настоящее название",artist:"Исполнитель",fallbackTitle:"001")
        let track=try XCTUnwrap(SavedTrack.imported(id:"local:12345678-1234-4234-8234-123456789abc",title:value.title,artist:value.artist,duration:90,fileExtension:"mp3"))
        let restored=try JSONDecoder().decode(SavedTrack.self,from:JSONEncoder().encode(track))
        XCTAssertEqual(restored.title,"Настоящее название");XCTAssertEqual(restored.artist,"Исполнитель")
        XCTAssertTrue(restored.isLocal);XCTAssertEqual(restored.audioUrl,"")
    }
    func testMissingMetadataKeepsFilenameAndNeverInventsArtist() {
        let value=ImportedAudioMetadata(title:" \n ",artist:nil,fallbackTitle:"Свой файл")
        XCTAssertEqual(value.title,"Свой файл");XCTAssertEqual(value.artist,"Локальная музыка")
    }
    func testControlBytesAndHugeTagsAreBoundedBeforeStorage() {
        let value=ImportedAudioMetadata(title:"\u{0}  Title\n\tName",artist:String(repeating:"x",count:100_000),fallbackTitle:"ignored")
        XCTAssertEqual(value.title,"Title Name");XCTAssertEqual(value.artist.count,300)
        XCTAssertEqual(ImportedAudioMetadata(title:nil,artist:"",fallbackTitle:"").title,"Локальная запись")
    }
}
