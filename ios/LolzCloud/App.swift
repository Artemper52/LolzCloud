import SwiftUI
import WebKit
import UIKit
import UniformTypeIdentifiers

@main struct LolzCloudApp: App {
    @StateObject private var shell = AppShell()
    var body: some Scene {
        WindowGroup { AppScreen(shell:shell).preferredColorScheme(.dark) }
    }
}

@MainActor final class AppShell: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate {
    let player = NativePlayer()
    let login = AccountLogin()
    private(set) var webView: WKWebView!
    @Published var loadError = ""
    @Published var loading = true
    @Published var offline = false
    private var pendingAccount: [String:Any]?
    private var pendingDownloads: [String:[String:Any]] = [:]
    private weak var audioPicker: UIDocumentPickerViewController?
    override init() {
        super.init()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(self,name:"lolzcloud")
        webView = WKWebView(frame:.zero,configuration:configuration)
        webView.navigationDelegate = self; webView.uiDelegate = self
        webView.isOpaque = false; webView.backgroundColor = UIColor(red:0.055,green:0.075,blue:0.067,alpha:1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.allowsBackForwardNavigationGestures = true
        player.emit = { [weak self] name,detail in self?.event(name,detail) }
        login.completed = { [weak self] name,detail in self?.event(name,detail) }
        reload()
    }
    func reload() { offline = false; loadError = ""; loading = true; webView.load(URLRequest(url:MediaPolicy.origin.appendingPathComponent("app/"),cachePolicy:.useProtocolCachePolicy,timeoutInterval:25)) }
    private func event(_ name: String,_ detail: [String:Any]) {
        guard UIApplication.shared.applicationState == .active, !loading, MediaPolicy.bridgePage(webView.url) else {
            if name == "account" { pendingAccount = detail }
            else if name == "download", let id = detail["id"] as? String, pendingDownloads.count < 200 || pendingDownloads[id] != nil { pendingDownloads[id] = detail }
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject:detail), let json = String(data:data,encoding:.utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('lolzcloud:\(name)',{detail:\(json)}));",completionHandler:nil)
    }
    func foreground() {
        guard UIApplication.shared.applicationState == .active, !loading, MediaPolicy.bridgePage(webView.url) else { return }
        if let detail = pendingAccount { pendingAccount = nil; event("account",detail) }
        let downloads = pendingDownloads; pendingDownloads.removeAll()
        for detail in downloads.values { event("download",detail) }
        player.listDownloads()
    }
    func userContentController(_ userContentController: WKUserContentController,didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == "lolzcloud.com",
              [0,443].contains(message.frameInfo.securityOrigin.port), MediaPolicy.bridgePage(message.frameInfo.request.url),
              let object = message.body as? [String:Any], let action = object["action"] as? String else { return }
        let client = object["clientId"] as? String, request = MediaPolicy.requestID(object["requestId"])
        if object["clientId"] != nil || object["requestId"] != nil { guard client != nil, request != nil else { return } }
        guard player.acceptClientIntent(client:client,request:request,handshake:action == "queue" && object["handshake"] as? Bool == true) else { return }
        switch action {
        case "queue":
            if let rows = object["tracks"] as? [[String:Any]], rows.count <= 200,
               let index = object["index"] as? Int, let mode = object["repeat"] as? String, let shuffle = object["shuffle"] as? Bool {
                let tracks = rows.compactMap(SavedTrack.init)
                if tracks.count == rows.count { player.configureQueue(tracks,index:index,repeatMode:mode,shuffle:shuffle) }
            }
        case "play":
            let selected = MediaPolicy.queueIndex(object["queueIndex"])
            if object["queueIndex"] != nil && selected == nil { return }
            if let track = SavedTrack(object) { player.play(track,position:MediaPolicy.time(object["position"]),queueIndex:selected) }
        case "pause": player.pause()
        case "resume": player.resume()
        case "stop": player.stop()
        case "seek": player.seek(MediaPolicy.time(object["position"]))
        case "volume": if let value = object["value"] as? Double { player.volume(value) }
        case "rate": if let value = MediaPolicy.number(object["value"]) { player.rate(value) }
        case "sleep": if let value = MediaPolicy.number(object["minutes"]), [0,15,30,45,60].contains(value) { player.sleep(minutes:Int(value)) }
        case "download": if let row = object["track"] as? [String:Any], let track = SavedTrack(row) { player.download(track) }
        case "importAudio": openAudioImporter()
        case "removeDownload": if let id = object["id"] as? String { player.removeDownload(id) }
        case "downloads": player.listDownloads(); player.publish()
        case "login": login.start(webView)
        default: break
        }
    }
    func openAudioImporter() {
        guard audioPicker == nil, !login.presented else { return }
        if player.importing { player.importAudio([]); return }
        let window = webView.window ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first { $0.isKeyWindow }
        guard var presenter = window?.rootViewController else { player.importCancelled(); return }
        while let shown = presenter.presentedViewController { presenter = shown }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes:[.audio],asCopy:false)
        picker.allowsMultipleSelection = true; picker.shouldShowFileExtensions = true; picker.delegate = self
        audioPicker = picker; presenter.present(picker,animated:true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController,didPickDocumentsAt urls: [URL]) { audioPicker = nil; player.importAudio(urls) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { audioPicker = nil; player.importCancelled() }
    func webView(_ webView: WKWebView,decidePolicyFor navigationAction: WKNavigationAction,decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if MediaPolicy.ownPage(url) {
            if url.path == "/login" || url.path == "/auth/lolz" { decisionHandler(.cancel); login.start(self.webView); return }
            if navigationAction.targetFrame == nil { decisionHandler(.cancel); self.webView.load(navigationAction.request); return }
            decisionHandler(.allow); return
        }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if navigationAction.targetFrame?.isMainFrame == false, url.scheme == "https", ["w.soundcloud.com","www.youtube.com","www.youtube-nocookie.com"].contains(url.host ?? ""), url.user == nil, url.password == nil { decisionHandler(.allow); return }
        // Only an explicit top-level link can leave the application. Search,
        // audio and any script-triggered external navigation stay contained.
        if navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame != false,
           ["https","mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView,didFinish navigation: WKNavigation!) { loading = false; loadError = ""; foreground() }
    func webView(_ webView: WKWebView,didFailProvisionalNavigation navigation: WKNavigation!,withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView,didFail navigation: WKNavigation!,withError error: Error) { failed(error) }
    private func failed(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        loading = false; loadError = "Не удалось загрузить LolzCloud. Проверь соединение или открой сохранённую музыку."
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loading = false; loadError = "Экран приложения был выгружен iOS. Открой его снова; музыка продолжает играть." }
}

struct WebSurface: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context:Context) -> WKWebView { webView }
    func updateUIView(_ uiView:WKWebView,context:Context) { }
}

struct AppScreen: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var shell: AppShell
    @ObservedObject private var login: AccountLogin
    init(shell:AppShell) { self.shell = shell; self.login = shell.login }
    var body: some View {
        ZStack {
            Color(red:0.055,green:0.075,blue:0.067).ignoresSafeArea()
            if shell.offline { OfflineScreen(player:shell.player,back:{ shell.reload() },importAudio:shell.openAudioImporter) }
            else {
                WebSurface(webView:shell.webView).ignoresSafeArea(.container,edges:.bottom)
                if shell.loading { ProgressView("Открываем LolzCloud…").padding(24).background(.regularMaterial,in:RoundedRectangle(cornerRadius:16)) }
                if !shell.loadError.isEmpty {
                    VStack(spacing:20) {
                        Image(systemName:"wifi.slash").font(.largeTitle).foregroundStyle(.secondary)
                        Text(shell.loadError).multilineTextAlignment(.center).frame(maxWidth:380)
                        Button("Повторить",action:shell.reload).buttonStyle(.borderedProminent)
                        Button("Сохранённая музыка") { shell.offline = true }
                    }.padding(28).frame(maxWidth:.infinity,maxHeight:.infinity).background(Color(red:0.055,green:0.075,blue:0.067))
                }
            }
        }.tint(Color(red:0.47,green:0.85,blue:0.64))
        .onChange(of:scenePhase) { phase in if phase == .active { shell.foreground() } }
        .sheet(isPresented:Binding(get:{login.presented},set:{if !$0 { login.cancel() }})) { LoginScreen(login:login).presentationDetents([.medium,.large]) }
    }
}

struct LoginScreen: View {
    @ObservedObject var login: AccountLogin
    var body: some View {
        NavigationStack {
            VStack(spacing:24) {
                Image(systemName:"person.crop.circle.badge.checkmark").font(.system(size:48)).foregroundStyle(.mint)
                Text("Вход через Lolzteam").font(.title2.bold())
                Text(login.status).multilineTextAlignment(.center)
                if !login.code.isEmpty { Text(login.code).font(.system(.title,design:.monospaced).bold()).textSelection(.enabled).accessibilityLabel("Код подключения: "+login.code) }
                if login.verificationURL != nil { Button("Подтвердить в браузере",action:login.openBrowser).buttonStyle(.borderedProminent) }
                Text("Проверь код на странице подключения. Пароль Lolzteam остаётся в браузере.").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }.padding(28).toolbar { ToolbarItem(placement:.cancellationAction) { Button("Отмена") { login.cancel() } } }
        }.preferredColorScheme(.dark)
    }
}

struct OfflineScreen: View {
    @ObservedObject var player: NativePlayer
    let back: () -> Void
    let importAudio: () -> Void
    var body: some View {
        NavigationStack {
            List {
                if player.tracks.isEmpty { Text("Сохранённых треков пока нет. Вернись в приложение с интернетом и сохрани музыку заранее.").foregroundStyle(.secondary) }
                ForEach(player.tracks) { track in
                    Button { player.playOffline(track) } label: {
                        HStack(spacing:14) {
                            Image(systemName:player.current?.id == track.id && player.state == "playing" ? "waveform":"music.note").frame(width:28)
                            VStack(alignment:.leading,spacing:4) { Text(track.title).foregroundStyle(.primary); Text(track.artist).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Image(systemName:"play.fill")
                        }.padding(.vertical,6)
                    }.swipeActions { Button("Удалить",role:.destructive) { player.removeDownload(track.id) } }
                }
                if let current = player.current {
                    Section("Сейчас играет") {
                        Text(current.title)
                        if !player.error.isEmpty { Text(player.error).foregroundStyle(.orange) }
                        Button(player.state == "playing" ? "Пауза":"Продолжить") { player.state == "playing" ? player.pause():player.resume() }
                    }
                }
            }.navigationTitle("Сохранено").toolbar {
                ToolbarItem(placement:.navigationBarLeading) { Button("В приложение",action:back) }
                ToolbarItem(placement:.navigationBarTrailing) { Button("Импорт",action:importAudio) }
            }
        }
    }
}
