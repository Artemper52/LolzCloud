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
    private var offline: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Offline", isDirectory: true)
    }

    override func setUp() async throws {
        continueAfterFailure = false
        scratch = FileManager.default.temporaryDirectory.appendingPathComponent("runtime-"+UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        records = []
    }

    override func tearDown() async throws {
        for player in subjects {
            player.stop()
            for track in player.tracks { player.removeDownload(track.id) }
            player.emit = nil
        }
        subjects = []
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

    private func wave(_ name: String, seconds: Double = 8) throws -> URL {
        let rate = 16_000, count = Int(Double(rate)*seconds)
        var data = Data()
        func text(_ value: String) { data.append(contentsOf: value.utf8) }
        func u16(_ value: UInt16) { var v = value.littleEndian; Swift.withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        func u32(_ value: UInt32) { var v = value.littleEndian; Swift.withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        text("RIFF"); u32(UInt32(36+count*2)); text("WAVEfmt "); u32(16)
        u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate*2)); u16(2); u16(16)
        text("data"); u32(UInt32(count*2))
        for i in 0..<count {
            let sample = Int16(sin(Double(i)*2*Double.pi*440/Double(rate))*4000)
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

    private func javascript(_ source: String, in web: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            web.evaluateJavaScript(source) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }

    private func post(_ object: [String: Any], in web: WKWebView) async throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        _ = try await javascript("window.webkit.messageHandlers.lolzcloud.postMessage("+json+"); true", in: web)
    }

    func testLiveHTTPSWebKitBridgeRejectsStaleClientAndWrongPage() async throws {
        let shell = AppShell(), web = try XCTUnwrap(shell.webView)
        subjects.append(shell.player)
        shell.player.emit = { [weak self] name, detail in var row = detail; row["event"] = name; self?.records.append(row) }
        defer {
            shell.login.cancel()
            web.stopLoading(); web.configuration.userContentController.removeScriptMessageHandler(forName: "lolzcloud")
            web.navigationDelegate = nil; web.uiDelegate = nil
        }
        try await waitFor("live public HTTPS PWA loads", timeout: 35) { !shell.loading && web.url?.host == "lolzcloud.com" }
        XCTAssertTrue(shell.loadError.isEmpty, shell.loadError)
        XCTAssertTrue(MediaPolicy.bridgePage(web.url))
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
        handshake["clientId"] = b
        try await post(handshake, in: web)
        try await waitFor("new document client takes ownership") { self.records.last { $0["event"] as? String == "playback" }?["clientId"] as? String == b }
        try await post(["action":"pause", "clientId":a, "requestId":500], in: web)
        try await settle(0.2)
        XCTAssertGreaterThan(av.rate, 0, "Retired client's high request must not pause current playback")
        try await post(["action":"pause", "clientId":b, "requestId":2], in: web)
        try await waitFor("current client pause is accepted") { av.rate == 0 }
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
        XCTAssertEqual(av.defaultRate, 1, "A real iframe must not control the native player")
        web.configuration.userContentController.removeScriptMessageHandler(forName: "runtime_probe")
        _ = try await javascript("document.getElementById('runtime-child').remove();true", in: web)
        records.removeAll()
        // /social intentionally redirects unauthenticated visitors to native
        // login. Use a public own page so this read-only test never starts auth.
        web.load(URLRequest(url: MediaPolicy.origin.appendingPathComponent("install.html")))
        try await waitFor("public non-bridge own page finishes", timeout: 30) { web.url?.path == "/install.html" && !web.isLoading }
        try await post(["action":"rate", "clientId":b, "requestId":3, "value":1.75], in: web)
        try await settle(0.2)
        XCTAssertEqual(av.defaultRate, 1, "A public same-origin page must not acquire the /app bridge")
        XCTAssertFalse(records.contains { $0["requestId"] as? Int == 3 })
    }
}
