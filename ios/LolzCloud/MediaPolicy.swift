import Foundation
import CoreFoundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum MediaPolicy {
    static let origin = URL(string: "https://lolzcloud.com")!
    static func ownPage(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host == "lolzcloud.com" && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }
    static func bridgePage(_ url: URL?) -> Bool {
        guard ownPage(url), let path = url?.path else { return false }
        return path == "/app" || path.hasPrefix("/app/")
    }
    static func replayPosition(ended: Bool, position: Double, duration: Double) -> Double {
        guard position.isFinite, position > 0 else { return 0 }
        if ended || duration.isFinite && duration > 0 && position >= duration - 0.1 { return 0 }
        return position
    }
    static func identifier(_ value: String) -> Bool {
        value.range(of: "^[1-9][0-9]{0,15}$", options: .regularExpression) != nil
    }
    static func localIdentifier(_ value: String) -> Bool {
        value.range(of:"^local:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",options:.regularExpression) != nil
    }
    static func accountID(_ value: Any?) -> String? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.stringValue.range(of:"^[1-9][0-9]{0,14}$",options:.regularExpression) != nil else { return nil }
        return number.stringValue
    }
    static func audio(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https", url.host == "lolzcloud.com",
              url.port == nil || url.port == 443, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              url.path.range(of: "^/music/audio/[1-9][0-9]{0,15}/[a-f0-9]{24}\\.mp3$", options: .regularExpression) != nil else { return nil }
        return url
    }
    static func secret(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z0-9_-]{43}$", options: .regularExpression) != nil
    }
    static func preparation(_ value: String) -> URL? {
        guard let url = audio(value) else { return nil }
        return URL(string: url.path.replacingOccurrences(of:"/music/audio/",with:"/music/prepare/").replacingOccurrences(of:".mp3",with:""),relativeTo:origin)?.absoluteURL
    }
    static func verification(_ value: String, code: String) -> URL? {
        guard code.range(of: "^[a-zA-Z0-9_-]{12}$", options: .regularExpression) != nil,
              let url = URL(string: value), url.scheme == "https", url.host == "lolzcloud.com",
              url.port == nil || url.port == 443, url.user == nil, url.password == nil,
              url.path == "/connect", url.fragment == nil,
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "code", value: code)] else { return nil }
        return url
    }
    static func time(_ value: Any?) -> Double {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return 0 }
        let seconds = number.doubleValue
        return seconds.isFinite ? max(0, min(86400, seconds)) : 0
    }
    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return nil }
        return number.doubleValue
    }
    static func queueIndex(_ value: Any?) -> Int? {
        guard let number = number(value), number >= 0, number < 200, number.rounded(.towardZero) == number else { return nil }
        return Int(number)
    }
    static func requestID(_ value: Any?) -> Int? {
        guard let number = number(value), number >= 1, number <= 9_007_199_254_740_991, number.rounded(.towardZero) == number else { return nil }
        return Int(number)
    }
}

struct NativeClientIntent {
    private(set) var clientID: String?
    private(set) var requestID = 0
    private var retired: [String] = []
    var fields: [String:Any] { clientID.map { ["clientId":$0,"requestId":requestID] } ?? [:] }
    mutating func accept(client: String, request: Int, handshake: Bool) -> Bool {
        guard MediaPolicy.localIdentifier("local:"+client), request > 0, request <= 9_007_199_254_740_991 else { return false }
        if clientID == client {
            guard request >= requestID else { return false }
            requestID = request; return true
        }
        guard handshake, !retired.contains(client) else { return false }
        if let clientID { retired.append(clientID); if retired.count > 32 { retired.removeFirst() } }
        clientID = client; requestID = request; return true
    }
}

struct PlaybackSettings {
    private(set) var rate = 1.0
    private(set) var sleepDeadline = 0.0
    mutating func setRate(_ value: Double) -> Bool {
        guard value.isFinite, (0.5...2).contains(value) else { return false }
        rate = value; return true
    }
    mutating func setSleep(minutes: Int, now: TimeInterval) -> Bool {
        guard [0,15,30,45,60].contains(minutes), now.isFinite else { return false }
        sleepDeadline = minutes == 0 ? 0 : now+Double(minutes)*60_000
        return true
    }
    mutating func expireSleep(_ deadline: TimeInterval) -> Bool {
        guard deadline > 0, sleepDeadline == deadline else { return false }
        sleepDeadline = 0; return true
    }
}

// The same intent gates late AVPlayer events and interruption recovery.
struct PlaybackIntent {
    private(set) var generation = 0
    private(set) var wantsPlay = false
    private var interruptedGeneration: Int?
    mutating func select() -> Int { generation += 1; resume(); return generation }
    mutating func resume() { wantsPlay = true; interruptedGeneration = nil }
    mutating func pause() { wantsPlay = false; interruptedGeneration = nil }
    mutating func stop() { generation += 1; pause() }
    mutating func interrupt() { interruptedGeneration = wantsPlay ? generation : nil; wantsPlay = false }
    mutating func finishInterruption(shouldResume: Bool) -> Bool {
        let allowed = shouldResume && interruptedGeneration == generation
        interruptedGeneration = nil
        if allowed { wantsPlay = true }
        return allowed
    }
    mutating func ended(_ ticket: Int) -> Bool {
        guard ticket == generation, wantsPlay else { return false }
        wantsPlay = false; return true
    }
}

struct QueuePolicy {
    private(set) var tracks: [SavedTrack] = []
    private(set) var index = -1
    private(set) var repeatMode = "off"
    private(set) var shuffle = false
    private var history: [Int] = []
    var current: SavedTrack? { tracks.indices.contains(index) ? tracks[index] : nil }
    mutating func configure(_ rows: [SavedTrack], index proposed: Int, repeatMode: String, shuffle: Bool, currentID: String?) -> Bool {
        guard rows.count <= 200, ["off","all","one"].contains(repeatMode), proposed >= -1,
              rows.isEmpty ? proposed <= 0 : proposed < rows.count else { return false }
        let previous = tracks, previousIndex = index
        func mapped(_ position: Int) -> Int? {
            guard previous.indices.contains(position) else { return nil }
            let id = previous[position].id, occurrence = previous[..<position].filter { $0.id == id }.count
            let matches = rows.indices.filter { rows[$0].id == id }
            return matches.indices.contains(occurrence) ? matches[occurrence] : nil
        }
        let remappedHistory = history.compactMap(mapped)
        let preserved = currentID.flatMap { id -> Int? in
            if previous.indices.contains(previousIndex), previous[previousIndex].id == id, let position = mapped(previousIndex) { return position }
            return rows.firstIndex { $0.id == id }
        }
        tracks = rows; self.repeatMode = repeatMode; self.shuffle = shuffle
        index = currentID != nil ? preserved ?? -1 : (rows.indices.contains(proposed) ? proposed : -1)
        history = remappedHistory
        return true
    }
    @discardableResult mutating func select(_ id: String, index preferred: Int? = nil, remember: Bool = true) -> Bool {
        let target: Int
        if let preferred { guard tracks.indices.contains(preferred), tracks[preferred].id == id else { return false }; target = preferred }
        else if current?.id == id { target = index }
        else if let first = tracks.firstIndex(where: { $0.id == id }) { target = first }
        else { index = -1; return false }
        if remember, tracks.indices.contains(index), index != target { history.append(index); if history.count > 200 { history.removeFirst() } }
        index = target; return true
    }
    mutating func step(_ direction: Int, automatic: Bool = false, random: Double = Double.random(in:0..<1)) -> SavedTrack? {
        guard !tracks.isEmpty else { return nil }
        if automatic && repeatMode == "one", let current { return current }
        let target: Int
        if direction < 0 {
            if let previous = history.popLast(), tracks.indices.contains(previous) { target = previous }
            else if index > 0 { target = index-1 }
            else if repeatMode == "all" { target = tracks.count-1 }
            else { return nil }
        } else if shuffle && tracks.count > 1 {
            let unit = random.isFinite ? min(0.999999,max(0,random)) : 0
            target = (max(0,index)+1+Int(unit*Double(tracks.count-1)))%tracks.count
        } else if index+1 < tracks.count { target = index+1 }
        else if repeatMode == "all" { target = 0 }
        else { return nil }
        let selected = tracks[target]
        select(selected.id,index:target,remember:direction >= 0)
        return selected
    }
}

enum UserError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

enum OfflineCommit {
    static func install(temporary: URL, destination: URL, index: URL, data: Data) throws {
        guard temporary.isFileURL, destination.isFileURL, index.isFileURL, data.count <= 1_000_000 else { throw UserError.message("Не удалось сохранить библиотеку. Удали ненужные записи и повтори.") }
        // rename replaces an unindexed orphan atomically; an interrupted index write
        // must not make every retry fail because the previous MP3 already exists.
        let result = temporary.withUnsafeFileSystemRepresentation { source in
            destination.withUnsafeFileSystemRepresentation { target -> Int32 in
                guard let source, let target else { return -1 }
                return rename(source,target)
            }
        }
        guard result == 0 else { throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno)) }
        do { try data.write(to:index,options:.atomic) }
        catch { try? FileManager.default.removeItem(at:destination); throw error }
    }
}

enum AudioPreparation {
    struct Reply { let ready: Bool; let retryAfter: TimeInterval }
    static func parse(status: Int, data: Data, expected: String) throws -> Reply {
        guard data.count <= 16*1024, MediaPolicy.audio(expected) != nil,
              let body = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else { throw UserError.message("Аудиосервис вернул неверный ответ. Повтори попытку.") }
        if status == 200, body["state"] as? String == "ready", body["audioUrl"] as? String == expected { return Reply(ready:true,retryAfter:0) }
        if status == 202, body["state"] as? String == "preparing", let number = body["retryAfterMs"] as? NSNumber,
           CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite { return Reply(ready:false,retryAfter:min(3,max(0.25,number.doubleValue/1000))) }
        if status >= 400 { throw UserError.message(String((body["error"] as? String ?? "Запись недоступна. Повтори попытку или выбери другой трек.").prefix(300))) }
        throw UserError.message("Аудиосервис вернул другую запись. Повтори попытку.")
    }
    static func awaitReady(audio: String, request: (URL,TimeInterval) async throws -> Reply,
                           now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
                           sleep: (TimeInterval) async throws -> Void = { try await Task.sleep(nanoseconds:UInt64($0*1_000_000_000)) }) async throws {
        guard let endpoint = MediaPolicy.preparation(audio) else { throw UserError.message("Недопустимый источник аудио.") }
        let deadline = now()+125; var failures = 0
        while now() < deadline {
            try Task.checkCancellation()
            do {
                let reply = try await request(endpoint,min(10,deadline-now()))
                try Task.checkCancellation()
                guard now() <= deadline else { break }
                if reply.ready { return }
                failures = 0; try await sleep(min(reply.retryAfter,max(0,deadline-now())))
            } catch is CancellationError { throw CancellationError() }
            catch let error as UserError { throw error }
            catch { failures += 1; if failures >= 3 { throw UserError.message("Нет связи с аудиосервисом. Проверь сеть и повтори попытку.") }; try await sleep(min(1,max(0,deadline-now()))) }
        }
        throw UserError.message("Подготовка трека заняла слишком много времени. Нажми «Повторить».")
    }
}

struct SavedTrack: Codable, Identifiable {
    let id: String
    let title: String
    let artist: String
    let audioUrl: String
    let duration: Double
    let cover: String
    let source: String
    private(set) var fileExtension: String?
    var isLocal: Bool { source == "local" }
    init?(_ object: [String: Any]) {
        guard let id = object["id"] as? String else { return nil }
        if object["source"] as? String == "local" || object["local"] as? Bool == true {
            guard MediaPolicy.localIdentifier(id), object["audioUrl"] as? String == "", object["url"] == nil || object["url"] as? String == "" else { return nil }
            source = "local"; audioUrl = ""
        } else {
            guard object["source"] == nil || object["source"] as? String == "soundcloud", MediaPolicy.identifier(id),
                  let address = object["audioUrl"] as? String ?? object["url"] as? String,
                  let url = MediaPolicy.audio(address), url.path.split(separator:"/")[2] == Substring(id) else { return nil }
            source = "soundcloud"; audioUrl = url.absoluteString
        }
        self.id = id
        title = String((object["title"] as? String ?? "Без названия").prefix(300))
        artist = String((object["artist"] as? String ?? "").prefix(300))
        duration = MediaPolicy.time(object["duration"]); cover = source == "local" ? "" : String((object["cover"] as? String ?? "").prefix(2000))
        fileExtension = nil
    }
    static func imported(id: String,title: String,artist: String,duration: Double,fileExtension: String) -> SavedTrack? {
        guard LocalAudioFiles.extensions.contains(fileExtension), duration.isFinite, duration > 0, duration <= 86400,
              var track = SavedTrack(["id":id,"title":title,"artist":artist,"duration":duration,"audioUrl":"","source":"local"]) else { return nil }
        track.fileExtension = fileExtension; return track
    }
    private enum CodingKeys: String, CodingKey { case id,title,artist,audioUrl,duration,cover,source,fileExtension }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy:CodingKeys.self)
        let object: [String:Any] = ["id":try values.decode(String.self,forKey:.id),"title":try values.decode(String.self,forKey:.title),"artist":try values.decode(String.self,forKey:.artist),"audioUrl":try values.decode(String.self,forKey:.audioUrl),"duration":try values.decode(Double.self,forKey:.duration),"cover":try values.decode(String.self,forKey:.cover),"source":try values.decodeIfPresent(String.self,forKey:.source) ?? "soundcloud"]
        guard var track = SavedTrack(object) else { throw DecodingError.dataCorruptedError(forKey:.id,in:values,debugDescription:"Invalid stored track") }
        if track.isLocal {
            let ext = try values.decode(String.self,forKey:.fileExtension)
            guard LocalAudioFiles.extensions.contains(ext) else { throw DecodingError.dataCorruptedError(forKey:.fileExtension,in:values,debugDescription:"Invalid local audio format") }
            track.fileExtension = ext
        }
        self = track
    }
    var object: [String: Any] { ["id":id,"title":title,"artist":artist,"audioUrl":audioUrl,"duration":duration,"cover":cover,"source":source,"local":isLocal] }
}

enum LocalAudioFiles {
    static let extensions: Set<String> = ["mp3","m4a","aac","wav","aif","aiff","caf","flac"]
    static let maximumBytes: Int64 = 20_000_000
    static let quota: Int64 = 256*1024*1024
    struct Staged { let id: String; let url: URL; let fileExtension: String; let bytes: Int64; let title: String }
    static func storedBytes(in directory: URL) -> Int64 {
        let files = (try? FileManager.default.contentsOfDirectory(at:directory,includingPropertiesForKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])) ?? []
        return files.reduce(Int64(0)) { sum,file in
            let name = file.lastPathComponent
            let owned = name.range(of:"^[1-9][0-9]{0,15}\\.mp3$",options:.regularExpression) != nil || name.range(of:"^local-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(mp3|m4a|aac|wav|aif|aiff|caf|flac)$",options:.regularExpression) != nil
            guard owned, let values = try? file.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey]), values.isRegularFile == true, values.isSymbolicLink != true else { return sum }
            return sum+Int64(max(0,values.fileSize ?? 0))
        }
    }
    static func filename(_ track: SavedTrack) -> String? {
        if track.isLocal {
            guard MediaPolicy.localIdentifier(track.id), let ext = track.fileExtension, extensions.contains(ext) else { return nil }
            return "local-"+String(track.id.dropFirst(6))+"."+ext
        }
        return MediaPolicy.identifier(track.id) ? track.id+".mp3" : nil
    }
    static func existing(_ track: SavedTrack,in directory: URL) -> URL? {
        guard directory.isFileURL, let name = filename(track) else { return nil }
        let file = directory.appendingPathComponent(name)
        guard let values = try? file.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey]), values.isRegularFile == true, values.isSymbolicLink != true,
              let bytes = values.fileSize, bytes > 0, Int64(bytes) <= maximumBytes else { return nil }
        return file
    }
    static func stage(_ source: URL,in directory: URL,maximum: Int64 = maximumBytes) throws -> Staged {
        let ext = source.pathExtension.lowercased()
        guard source.isFileURL, extensions.contains(ext), maximum > 0,
              let values = try? source.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey]), values.isRegularFile == true, values.isSymbolicLink != true,
              values.fileSize.map({ $0 > 0 && Int64($0) <= min(maximum,maximumBytes) }) ?? true else { throw UserError.message("Выбери аудиофайл поддерживаемого формата до 20 МБ.") }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let uuid = UUID().uuidString.lowercased(), target = directory.appendingPathComponent(".import-"+uuid+"."+ext)
        guard FileManager.default.createFile(atPath:target.path,contents:nil,attributes:[.posixPermissions:0o600]) else { throw UserError.message("Не удалось создать копию аудио. Проверь свободное место.") }
        var complete = false
        defer { if !complete { try? FileManager.default.removeItem(at:target) } }
        let input = try FileHandle(forReadingFrom:source), output = try FileHandle(forWritingTo:target)
        defer { try? input.close(); try? output.close() }
        var bytes: Int64 = 0
        while let chunk = try input.read(upToCount:65536), !chunk.isEmpty {
            try Task.checkCancellation(); bytes += Int64(chunk.count)
            guard bytes <= min(maximum,maximumBytes) else { throw UserError.message("Аудиофайл превышает лимит 20 МБ.") }
            try output.write(contentsOf:chunk)
        }
        guard bytes > 128 else { throw UserError.message("Аудиофайл пуст или повреждён.") }
        try output.synchronize(); complete = true
        let title = String(source.deletingPathExtension().lastPathComponent.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.map(String.init).joined().prefix(300))
        return Staged(id:"local:"+uuid,url:target,fileExtension:ext,bytes:bytes,title:title.isEmpty ? "Локальная запись" : title)
    }
    static func commit(_ track: SavedTrack,temporary: URL,in directory: URL,index: URL,registered: [SavedTrack]) throws -> [SavedTrack] {
        guard track.isLocal, let name = filename(track), !registered.contains(where: { $0.id == track.id }) else { throw UserError.message("Недопустимая локальная запись.") }
        let journal = directory.appendingPathComponent(".local-"+String(track.id.dropFirst(6))+".pending.json"), updated = registered+[track]
        try JSONEncoder().encode(track).write(to:journal,options:.atomic)
        do { try OfflineCommit.install(temporary:temporary,destination:directory.appendingPathComponent(name),index:index,data:try JSONEncoder().encode(updated)) }
        catch { try? FileManager.default.removeItem(at:journal); throw error }
        try? FileManager.default.removeItem(at:journal)
        return updated
    }
    static func recover(in directory: URL,index: URL,registered: [SavedTrack]) -> [SavedTrack] {
        var tracks = registered
        let entries = (try? FileManager.default.contentsOfDirectory(at:directory,includingPropertiesForKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])) ?? []
        for entry in entries where entry.lastPathComponent.hasPrefix(".local-") && entry.lastPathComponent.hasSuffix(".pending.json") {
            guard let values = try? entry.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey]), values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? 4097) <= 4096,
                  let data = try? Data(contentsOf:entry), let track = try? JSONDecoder().decode(SavedTrack.self,from:data), track.isLocal,
                  entry.lastPathComponent == ".local-"+String(track.id.dropFirst(6))+".pending.json", existing(track,in:directory) != nil else { continue }
            if !tracks.contains(where: { $0.id == track.id }) {
                let total = tracks.reduce(Int64(0)) { sum,row in sum+((existing(row,in:directory).flatMap { try? $0.resourceValues(forKeys:[.fileSizeKey]).fileSize }).map(Int64.init) ?? 0) }
                let bytes = (existing(track,in:directory).flatMap { try? $0.resourceValues(forKeys:[.fileSizeKey]).fileSize }).map(Int64.init) ?? quota
                guard total+bytes <= quota else { continue }
                let next = tracks+[track]
                guard let encoded = try? JSONEncoder().encode(next), encoded.count <= 1_000_000 else { continue }
                do { try encoded.write(to:index,options:.atomic); tracks = next } catch { continue }
            }
            try? FileManager.default.removeItem(at:entry)
        }
        for entry in entries where entry.lastPathComponent.range(of:"^\\.import-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(mp3|m4a|aac|wav|aif|aiff|caf|flac)$",options:.regularExpression) != nil {
            guard let values = try? entry.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey]), values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            try? FileManager.default.removeItem(at:entry)
        }
        return tracks
    }
}

final class NoRedirects: NSObject, URLSessionDownloadDelegate {
    let maximumDownloadBytes: Int64?
    init(maximumDownloadBytes: Int64? = nil) { self.maximumDownloadBytes = maximumDownloadBytes; super.init() }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) { /* The async download caller owns the returned temporary file. */ }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if let maximumDownloadBytes, totalBytesWritten > maximumDownloadBytes || totalBytesExpectedToWrite > maximumDownloadBytes { downloadTask.cancel() }
    }
}
