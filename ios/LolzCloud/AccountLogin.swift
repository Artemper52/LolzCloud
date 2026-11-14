import Foundation
import WebKit
import UIKit
import Combine

@MainActor final class AccountLogin: ObservableObject {
    @Published var presented = false
    @Published private(set) var code = ""
    @Published private(set) var status = ""
    @Published private(set) var verificationURL: URL?
    private var task: Task<Void,Never>?
    private var generation = 0
    private weak var webView: WKWebView?
    var completed: ((String,[String:Any]) -> Void)?
    private var pendingCookie: HTTPCookie?
    private var previousCookie: HTTPCookie?
    func start(_ webView: WKWebView) {
        let previousTask = task
        cancel(notify:false); self.webView = webView; generation += 1; let ticket = generation
        presented = true; code = ""; verificationURL = nil; status = "Создаём код подключения…"
        task = Task { [weak self] in
            guard let self else { return }
            do {
                await previousTask?.value
                try Task.checkCancellation()
                let (pair,_) = try await self.request("/api/desktop/start",body:[:])
                guard let device = pair["deviceCode"] as? String, MediaPolicy.secret(device),
                      let code = pair["code"] as? String,
                      let address = pair["verificationUrl"] as? String,
                      let url = MediaPolicy.verification(address,code:code) else { throw UserError.message("Сервер вернул неверный код. Начни вход заново.") }
                let lifetime = MediaPolicy.time(pair["expiresIn"])
                guard lifetime > 0, lifetime <= 600 else { throw UserError.message("Сервер вернул неверный срок кода. Начни вход заново.") }
                try Task.checkCancellation(); guard self.generation == ticket else { return }
                self.code = code; self.verificationURL = url; self.status = "Подтверди этот код в браузере. Затем вернись в LolzCloud."
                let deadline = Date().addingTimeInterval(lifetime)
                while Date() < deadline {
                    try await Task.sleep(nanoseconds:2_500_000_000)
                    let (poll,response) = try await self.request("/api/desktop/poll",body:["deviceCode":device])
                    try Task.checkCancellation(); guard self.generation == ticket else { return }
                    if poll["pending"] as? Bool == true { continue }
                    guard poll["pending"] as? Bool == false, let token = poll["token"] as? String, MediaPolicy.secret(token),
                          let user = poll["user"] as? [String:Any], let userID = MediaPolicy.accountID(user["id"]),
                          let expires = poll["expires"] as? Double else { throw UserError.message("Сервер не подтвердил аккаунт. Начни вход заново.") }
                    let formatter = DateFormatter(); formatter.locale = Locale(identifier:"en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT:0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
                    let now = response.value(forHTTPHeaderField:"Date").flatMap(formatter.date(from:)) ?? Date()
                    let expiry = Date(timeIntervalSince1970:expires/1000)
                    guard expiry > now, expiry.timeIntervalSince(now) <= 7*86400+60 else { throw UserError.message("Сессия уже истекла. Войди заново.") }
                    try await self.verify(token,expectedID:userID,cookie:false)
                    try Task.checkCancellation(); guard self.generation == ticket else { return }
                    let seconds = max(1,min(7*86400,Int(expiry.timeIntervalSince(now))))
                    guard let cookie = HTTPCookie.cookies(withResponseHeaderFields:["Set-Cookie":"__Host-lc_session=\(token); Path=/; Max-Age=\(seconds); Secure; HttpOnly; SameSite=Lax"],for:MediaPolicy.origin).first,
                          cookie.name == "__Host-lc_session", cookie.path == "/", cookie.isSecure, cookie.isHTTPOnly,
                          let jar = self.webView?.configuration.websiteDataStore.httpCookieStore else { throw UserError.message("Не удалось сохранить вход. Повтори попытку.") }
                    let cookies = await jar.lolzCookies()
                    try Task.checkCancellation(); guard self.generation == ticket else { return }
                    self.previousCookie = cookies.first { $0.name == cookie.name && $0.domain == cookie.domain && $0.path == "/" }
                    self.pendingCookie = cookie; await jar.lolzStoreCookie(cookie)
                    do {
                        try Task.checkCancellation(); guard self.generation == ticket else { await self.rollback(cookie,in:jar); return }
                        let saved = await jar.lolzCookies()
                        guard saved.contains(where: { $0.name == cookie.name && $0.domain == cookie.domain && $0.path == "/" && $0.value == token && $0.isSecure && $0.isHTTPOnly }) else { throw UserError.message("WebKit не сохранил вход. Повтори попытку.") }
                        try Task.checkCancellation(); guard self.generation == ticket else { await self.rollback(cookie,in:jar); return }
                        try await self.verify(token,expectedID:userID,cookie:true)
                        try Task.checkCancellation(); guard self.generation == ticket else { await self.rollback(cookie,in:jar); return }
                        self.pendingCookie = nil; self.previousCookie = nil; self.presented = false; self.status = "Аккаунт подключён"
                        self.completed?("account",["state":"ready"]); return
                    } catch { await self.rollback(cookie,in:jar); throw error }
                }
                throw UserError.message("Код истёк. Закрой окно и начни вход заново.")
            } catch is CancellationError { }
            catch {
                guard self.generation == ticket else { return }
                self.status = (error as? UserError)?.localizedDescription ?? "Не удалось проверить вход. Проверь сеть и начни заново."
                self.completed?("account",["state":"error","error":self.status])
            }
        }
    }
    func openBrowser() { if let url = verificationURL { UIApplication.shared.open(url) } }
    func cancel(notify: Bool = true) {
        generation += 1; task?.cancel(); presented = false
        if notify { completed?("account",["state":"cancelled"]) }
    }
    private func verify(_ token: String, expectedID: String, cookie: Bool) async throws {
        let (object,_) = try await request("/api/session",authorization:cookie ? nil:token,cookie:cookie ? token:nil)
        guard object["authenticated"] as? Bool == true, let user = object["user"] as? [String:Any],
              let id = MediaPolicy.accountID(user["id"]), id == expectedID,
              let name = user["name"] as? String, !name.isEmpty, name.count <= 300,
              let csrf = object["csrf"] as? String, MediaPolicy.secret(csrf) else { throw UserError.message("Не удалось подтвердить аккаунт. Войди заново.") }
    }
    private func request(_ path: String, body: [String:Any]? = nil, authorization: String? = nil, cookie: String? = nil) async throws -> ([String:Any],HTTPURLResponse) {
        guard ["/api/desktop/start","/api/desktop/poll","/api/session"].contains(path) else { throw UserError.message("Неверный адрес входа.") }
        var request = URLRequest(url:URL(string:path,relativeTo:MediaPolicy.origin)!); request.timeoutInterval = 12
        request.setValue("application/json",forHTTPHeaderField:"Accept")
        if let body { request.httpMethod = "POST"; request.setValue("application/json",forHTTPHeaderField:"Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject:body) }
        if let authorization { request.setValue("Bearer "+authorization,forHTTPHeaderField:"Authorization") }
        if let cookie { request.setValue("__Host-lc_session="+cookie,forHTTPHeaderField:"Cookie") }
        let configuration = URLSessionConfiguration.ephemeral; configuration.httpShouldSetCookies = false; configuration.urlCache = nil; configuration.timeoutIntervalForResource = 12
        let transport = NoRedirects()
        let session = URLSession(configuration:configuration,delegate:transport,delegateQueue:nil); defer { session.invalidateAndCancel() }
        let (bytes,response) = try await session.bytes(for:request,delegate:transport)
        guard let http = response as? HTTPURLResponse else { throw UserError.message("Сервис входа не отвечает.") }
        guard http.statusCode == 200 else { throw UserError.message(http.statusCode == 410 ? "Код истёк. Начни вход заново.":http.statusCode == 429 ? "Слишком много проверок. Подожди минуту и начни вход заново.":"Не удалось проверить вход (HTTP \(http.statusCode)). Повтори попытку.") }
        guard http.mimeType == "application/json", http.expectedContentLength <= 128*1024 else { throw UserError.message("Сервис входа вернул неверный ответ.") }
        var data = Data()
        for try await byte in bytes { guard data.count < 128*1024 else { throw UserError.message("Сервис входа вернул слишком большой ответ.") }; data.append(byte) }
        guard let object = try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw UserError.message("Сервис входа вернул неверный ответ.") }
        return (object,http)
    }
    private func rollback(_ cookie: HTTPCookie,in jar: WKHTTPCookieStore) async {
        guard pendingCookie?.value == cookie.value else { return }
        let current = await jar.lolzCookies()
        guard current.contains(where: { $0.name == cookie.name && $0.domain == cookie.domain && $0.value == cookie.value }) else { return }
        await jar.lolzRemoveCookie(cookie)
        if let previousCookie { await jar.lolzStoreCookie(previousCookie) }
        if pendingCookie?.value == cookie.value { pendingCookie = nil; previousCookie = nil }
    }
}

extension WKHTTPCookieStore {
    func lolzCookies() async -> [HTTPCookie] { await withCheckedContinuation { continuation in getAllCookies { continuation.resume(returning:$0) } } }
    func lolzStoreCookie(_ cookie:HTTPCookie) async { await withCheckedContinuation { continuation in setCookie(cookie,completionHandler:{ continuation.resume() }) } }
    func lolzRemoveCookie(_ cookie:HTTPCookie) async { await withCheckedContinuation { continuation in delete(cookie,completionHandler:{ continuation.resume() }) } }
}
