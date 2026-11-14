import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum NativeCatalog {
    struct Reply {
        let status: Int
        let body: Data
        let url: URL
        let mimeType: String?
    }
    static let maximumBytes = 64_000
    static func endpoint(_ track: SavedTrack) -> URL? {
        guard track.isCatalogReference, !track.isLocal else { return nil }
        if MediaPolicy.identifier(track.id) {
            return URL(string:"/music/track/"+track.id,relativeTo:MediaPolicy.origin)?.absoluteURL
        }
        guard MediaPolicy.referenceIdentifier(track.id), MediaPolicy.sourceURL(track.sourceUrl) == track.sourceUrl else { return nil }
        var parts = URLComponents(url:MediaPolicy.origin.appendingPathComponent("music/search"),resolvingAgainstBaseURL:false)!
        parts.queryItems = [URLQueryItem(name:"q",value:track.sourceUrl),URLQueryItem(name:"offset",value:"0")]
        return parts.url
    }
    static func resolve(_ track: SavedTrack, request: ((URL,TimeInterval) async throws -> Reply)? = nil) async throws -> SavedTrack {
        // A local identifier never becomes a network fallback, including when
        // its private file has been removed or the profile contains a fake URL.
        guard track.isCatalogReference else { return track }
        guard let address = endpoint(track) else { throw UserError.message("Некорректная ссылка сохранённого трека.") }
        try Task.checkCancellation()
        let reply = try await (request ?? fetch)(address,10)
        try Task.checkCancellation()
        guard reply.url == address, reply.status == 200, reply.mimeType == "application/json",
              !reply.body.isEmpty, reply.body.count <= maximumBytes else {
            if reply.status == 404 { throw UserError.message("Полная запись сейчас недоступна у источника.") }
            if reply.status == 429 { throw UserError.message("Источник попросил подождать. Повтори попытку через минуту.") }
            throw UserError.message("Не удалось восстановить сохранённый трек. Повтори попытку.")
        }
        guard let object = try? JSONSerialization.jsonObject(with:reply.body) as? [String:Any] else { throw UserError.message("Сервер вернул некорректную запись.") }
        let rows: [[String:Any]]
        if MediaPolicy.identifier(track.id) { rows = (object["track"] as? [String:Any]).map { [$0] } ?? [] }
        else { rows = object["tracks"] as? [[String:Any]] ?? [] }
        guard rows.count <= 20 else { throw UserError.message("Сервер вернул слишком много записей.") }
        let resolved = rows.compactMap { row -> SavedTrack? in
            guard let title = row["title"] as? String, !title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, title.count <= 300,
                  let artist = row["artist"] as? String, artist.count <= 300,
                  let duration = MediaPolicy.number(row["duration"]), duration > 0, duration <= 1200,
                  let value = SavedTrack(row), !value.isLocal, !value.isCatalogReference,
                  !value.sourceUrl.isEmpty else { return nil }
            if MediaPolicy.identifier(track.id) { return value.id == track.id ? value : nil }
            return value.sourceUrl == track.sourceUrl ? value : nil
        }
        guard resolved.count == 1 else { throw UserError.message("Сохранённая запись не найдена. Выбери другую версию песни.") }
        return resolved[0]
    }
    private static func fetch(_ address: URL,_ timeout: TimeInterval) async throws -> Reply {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        configuration.timeoutIntervalForResource = timeout; configuration.timeoutIntervalForRequest = timeout
        let transport = NoRedirects(maximumDownloadBytes:Int64(maximumBytes))
        let session = URLSession(configuration:configuration,delegate:transport,delegateQueue:nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url:address,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:timeout)
        request.setValue("application/json",forHTTPHeaderField:"Accept")
        let (temporary,response) = try await session.download(for:request,delegate:transport)
        defer { try? FileManager.default.removeItem(at:temporary) }
        let size = (try FileManager.default.attributesOfItem(atPath:temporary.path)[.size] as? NSNumber)?.intValue ?? 0
        guard size > 0, size <= maximumBytes, let http = response as? HTTPURLResponse, let final = response.url,
              response.expectedContentLength < 0 || response.expectedContentLength == size else { throw UserError.message("Сервер вернул слишком большую или неполную запись.") }
        return Reply(status:http.statusCode,body:try Data(contentsOf:temporary),url:final,mimeType:response.mimeType)
    }
}
