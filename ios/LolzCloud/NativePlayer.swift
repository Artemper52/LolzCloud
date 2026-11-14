import Foundation
import AVFoundation
import MediaPlayer
import UIKit
import Combine

@MainActor final class NativePlayer: ObservableObject {
    @Published private(set) var tracks: [SavedTrack] = []
    @Published private(set) var current: SavedTrack?
    @Published private(set) var state = "paused"
    @Published private(set) var error = ""
    var emit: ((String, [String: Any]) -> Void)?
    private let player = AVPlayer()
    private var tick: Any?
    private var itemObservation: NSKeyValueObservation?
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var audioObservers: [NSObjectProtocol] = []
    private var intent = PlaybackIntent()
    private var generation: Int { intent.generation }
    private var offlineQueue = false
    private var queue = QueuePolicy()
    private var clientIntent = NativeClientIntent()
    private var preparationTask: Task<Void,Never>?
    private var needsPreparation = false
    private var requestedPosition: Double = 0
    private var settings = PlaybackSettings()
    private var sleepTask: Task<Void,Never>?
    private var watchdog: Task<Void,Never>?
    private var downloadTasks: [String: Task<Void, Never>] = [:]
    private var downloadTickets: [String: UUID] = [:]
    private var importTask: Task<Void,Never>?
    private var importTicket: UUID?
    var importing: Bool { importTask != nil }
    private let directory: URL
    private let index: URL
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Offline", isDirectory: true)
        index = directory.appendingPathComponent("index.json")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: index), data.count <= 1_000_000,
           let saved = try? JSONDecoder().decode([SavedTrack].self, from: data) {
            tracks = saved.filter { LocalAudioFiles.existing($0,in:directory) != nil }
        }
        tracks = LocalAudioFiles.recover(in:directory,index:index,registered:tracks)
        tick = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.publish() }
        }
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in
                guard let self, self.current != nil, self.state != "error", self.state != "ended", !self.needsPreparation else { return }
                self.state = !self.intent.wantsPlay ? "paused" : self.player.timeControlStatus == .playing ? "playing" : self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate ? "loading" : "paused"
                if self.state == "loading" { self.watch() } else { self.watchdog?.cancel(); self.watchdog = nil }
                self.publish()
            }
        }
        observeAudio(); configureRemote()
    }
    private func file(_ track: SavedTrack) -> URL { directory.appendingPathComponent(LocalAudioFiles.filename(track)!) }
    private func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
    }
    func acceptClientIntent(client: String?, request: Int?, handshake: Bool) -> Bool {
        guard let client, let request else { return clientIntent.clientID == nil }
        return clientIntent.accept(client:client,request:request,handshake:handshake)
    }
    private func transportEvent(_ name: String,_ detail: [String:Any]) { emit?(name,detail.merging(clientIntent.fields) { _,new in new }) }
    func configureQueue(_ tracks: [SavedTrack], index: Int, repeatMode: String, shuffle: Bool) {
        let resolved = tracks.map { track -> SavedTrack in
            guard track.isLocal else { return track }
            return self.tracks.first { $0.id == track.id && $0.isLocal } ?? track
        }
        guard queue.configure(resolved,index:index,repeatMode:repeatMode,shuffle:shuffle,currentID:current?.id ?? queue.current?.id) else { return }
        if let selected = queue.current, selected.id == current?.id { current = selected }
        publish()
    }
    func play(_ requested: SavedTrack, position: Double = 0, localQueue: Bool = false, prepare: Bool = false, queueIndex: Int? = nil) {
        if let queueIndex { guard queue.tracks.indices.contains(queueIndex), queue.tracks[queueIndex].id == requested.id, queue.tracks[queueIndex].audioUrl == requested.audioUrl else { return } }
        let ticket = intent.select()
        queue.select(requested.id,index:queueIndex); preparationTask?.cancel(); preparationTask = nil
        offlineQueue = localQueue; watchdog?.cancel(); watchdog = nil
        player.pause(); itemObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver); self.endObserver = nil }
        player.replaceCurrentItem(with: nil)
        current = requested; state = "loading"; error = ""
        let track: SavedTrack
        if requested.isLocal {
            guard let registered = tracks.first(where: { $0.id == requested.id && $0.isLocal }), LocalAudioFiles.existing(registered,in:directory) != nil else { fail("Локальный файл не найден. Импортируй его заново."); return }
            track = registered; current = track
        } else { track = requested }
        requestedPosition = position.isFinite ? max(0,position) : 0
        needsPreparation = prepare && !tracks.contains(where: { $0.id == track.id })
        if needsPreparation {
            publish()
            preparationTask = Task { [weak self] in
                guard let self else { return }
                let background = NativeBackgroundTime()
                background.start(name:"LolzCloud audio preparation") { [weak self] in
                    guard let self, self.generation == ticket, self.needsPreparation else { return }
                    self.preparationTask?.cancel(); self.fail("Вернись в приложение и нажми «Продолжить», чтобы подготовить трек.")
                }
                defer { background.end(); if self.generation == ticket { self.preparationTask = nil } }
                do {
                    try await AudioPreparation.awaitReady(audio:track.audioUrl,request:{ endpoint, timeout in try await self.prepareRequest(endpoint,timeout:timeout,expected:track.audioUrl) })
                    try Task.checkCancellation()
                    guard self.generation == ticket, self.intent.wantsPlay else { return }
                    self.needsPreparation = false; self.install(track,ticket:ticket,position:self.requestedPosition)
                } catch is CancellationError { }
                catch { if self.generation == ticket, self.intent.wantsPlay { self.fail((error as? UserError)?.localizedDescription ?? "Не удалось подготовить аудио. Повтори попытку.") } }
            }
            return
        }
        install(track,ticket:ticket,position:requestedPosition)
    }
    private func install(_ track: SavedTrack,ticket: Int,position: Double) {
        do { try activate() } catch { fail("Не удалось включить аудио. Повтори попытку."); return }
        let source: URL
        if let registered = tracks.first(where: { $0.id == track.id }), let saved = LocalAudioFiles.existing(registered,in:directory) { source = saved }
        else if track.isLocal { fail("Локальный файл не найден. Импортируй его заново."); return }
        else { source = URL(string:track.audioUrl)! }
        let item = AVPlayerItem(url: source); player.replaceCurrentItem(with: item)
        itemObservation = item.observe(\.status, options: [.initial,.new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self, self.generation == ticket, self.player.currentItem === item else { return }
                if item.status == .failed { self.fail("Не удалось открыть аудио. Проверь сеть и повтори попытку.") }
                if item.status == .readyToPlay {
                    let duration = item.duration.seconds
                    let position = self.requestedPosition
                    let seek = min(position, duration.isFinite ? max(0,duration-0.1) : position)
                    if seek > 0 { self.player.seek(to: CMTime(seconds: seek, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
                    self.publish()
                }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in guard let self, self.intent.ended(ticket) else { return }; self.state = "ended"; self.publish(); if self.offlineQueue || self.queue.current?.id == self.current?.id { self.advance(1,automatic:true) } }
        }
        player.defaultRate = Float(settings.rate); player.play(); watch(); publish()
    }
    func playOffline(_ track: SavedTrack) { play(track,localQueue:true) }
    func pause() { intent.pause(); preparationTask?.cancel(); watchdog?.cancel(); watchdog = nil; player.pause(); state = "paused"; publish() }
    func resume() {
        guard let current else { return }
        let position = MediaPolicy.replayPosition(ended:state == "ended",position:player.currentItem == nil ? requestedPosition : player.currentTime().seconds,duration:player.currentItem?.duration.seconds ?? 0)
        if player.currentItem == nil || player.currentItem?.status == .failed { play(current,position:position,localQueue:offlineQueue,prepare:needsPreparation); return }
        do { try activate(); intent.resume(); if position == 0 { seek(0) }; error = ""; state = "loading"; player.defaultRate = Float(settings.rate); player.play(); watch(); publish() }
        catch { fail("Аудиосистема временно недоступна. Повтори попытку.") }
    }
    func stop() {
        intent.stop(); preparationTask?.cancel(); preparationTask = nil; needsPreparation = false; requestedPosition = 0; watchdog?.cancel(); watchdog = nil; player.pause(); itemObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver); self.endObserver = nil }
        player.replaceCurrentItem(with: nil); current = nil; state = "paused"
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation); publish()
    }
    func seek(_ seconds: Double) {
        guard seconds.isFinite else { return }
        requestedPosition = max(0,seconds)
        let duration = player.currentItem?.duration.seconds ?? 0
        player.seek(to: CMTime(seconds: min(max(0,seconds),duration.isFinite && duration > 0 ? duration : max(0,seconds)), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
    func volume(_ value: Double) { player.volume = Float(value.isFinite ? min(1,max(0,value)) : 1) }
    func rate(_ value: Double) {
        guard settings.setRate(value) else { return }
        player.defaultRate = Float(settings.rate)
        if intent.wantsPlay, player.rate > 0 { player.rate = Float(settings.rate) }
        publish()
    }
    func sleep(minutes: Int) {
        guard settings.setSleep(minutes:minutes,now:Date().timeIntervalSince1970*1000) else { return }
        sleepTask?.cancel(); sleepTask = nil
        if minutes > 0 {
            let deadline = settings.sleepDeadline
            sleepTask = Task { [weak self] in
                do { try await Task.sleep(nanoseconds:UInt64(minutes)*60_000_000_000) } catch { return }
                guard let self, !Task.isCancelled, self.settings.expireSleep(deadline) else { return }
                self.sleepTask = nil; self.error = ""; self.pause()
            }
        }
        publish()
    }
    func publish() {
        if settings.sleepDeadline > 0, Date().timeIntervalSince1970*1000 >= settings.sleepDeadline,
           settings.expireSleep(settings.sleepDeadline) { sleepTask?.cancel(); sleepTask = nil; error = ""; pause(); return }
        let time = player.currentTime().seconds, duration = player.currentItem?.duration.seconds ?? 0
        let queueOwned = queue.current?.id == current?.id && current != nil
        if queueOwned, let selected = queue.current { transportEvent("selection",["index":queue.index,"track":selected.object,"queue":true]) }
        if !offlineQueue { transportEvent("playback",["id":current?.id ?? "","state":state,"time":time.isFinite ? max(0,time):requestedPosition,"duration":duration.isFinite && duration > 0 ? duration:(current?.duration ?? 0),"error":error,"queue":queueOwned,"rate":settings.rate,"sleepDeadline":settings.sleepDeadline]) }
        guard let track = current else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle:track.title,MPMediaItemPropertyArtist:track.artist,MPMediaItemPropertyPlaybackDuration:duration.isFinite && duration > 0 ? duration:track.duration,MPNowPlayingInfoPropertyElapsedPlaybackTime:time.isFinite ? max(0,time):0,MPNowPlayingInfoPropertyPlaybackRate:player.rate]
    }
    private func fail(_ message: String) { intent.pause(); watchdog?.cancel(); watchdog = nil; player.pause(); state = "error"; error = message; publish() }
    private func watch() {
        guard watchdog == nil else { return }; let ticket = generation
        watchdog = Task { [weak self] in
            do { try await Task.sleep(nanoseconds:30_000_000_000) } catch { return }
            guard let self, !Task.isCancelled, self.generation == ticket else { return }
            self.watchdog = nil
            if self.state == "loading" { self.fail("Подготовка аудио заняла слишком много времени. Проверь сеть и повтори попытку.") }
        }
    }
    private func advanceOffline(_ step: Int) {
        guard let id = current?.id, let index = tracks.firstIndex(where: { $0.id == id }) else { return }
        if step < 0, player.currentTime().seconds > 3 { seek(0); return }
        let next = index+step
        guard next >= 0, next < tracks.count else { if step > 0 { pause() }; return }
        playOffline(tracks[next])
    }
    private func advance(_ step: Int,automatic: Bool = false) {
        if offlineQueue { advanceOffline(step); return }
        if step < 0, player.currentTime().seconds > 3 { seek(0); publish(); return }
        guard let selected = queue.step(step,automatic:automatic) else { if !automatic { pause() }; return }
        play(selected,prepare:true)
    }
    private func prepareRequest(_ endpoint: URL,timeout: TimeInterval,expected: String) async throws -> AudioPreparation.Reply {
        var request = URLRequest(url:endpoint); request.timeoutInterval = max(0.1,timeout); request.setValue("application/json",forHTTPHeaderField:"Accept")
        let configuration = URLSessionConfiguration.ephemeral; configuration.urlCache = nil; configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForResource = max(0.1,timeout)
        let transport = NoRedirects(), session = URLSession(configuration:configuration,delegate:transport,delegateQueue:nil)
        defer { session.invalidateAndCancel() }
        let (bytes,response) = try await session.bytes(for:request,delegate:transport)
        guard let http = response as? HTTPURLResponse, http.mimeType == "application/json", http.expectedContentLength <= 16*1024 else { throw UserError.message("Аудиосервис вернул неверный ответ.") }
        var data = Data()
        for try await byte in bytes { guard data.count < 16*1024 else { throw UserError.message("Ответ аудиосервиса слишком большой.") }; data.append(byte) }
        return try AudioPreparation.parse(status:http.statusCode,data:data,expected:expected)
    }
    private func observeAudio() {
        audioObservers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let options = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            Task { @MainActor in
                guard let self else { return }
                if type == AVAudioSession.InterruptionType.began.rawValue { self.intent.interrupt(); self.watchdog?.cancel(); self.watchdog = nil; self.player.pause(); self.state = "paused"; self.publish() }
                else if type == AVAudioSession.InterruptionType.ended.rawValue, self.intent.finishInterruption(shouldResume:AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)) { self.resume() }
            }
        })
        audioObservers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { Task { @MainActor in self?.pause() } }
        })
    }
    private func configureRemote() {
        let remote = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ action: @escaping @MainActor () -> Void) {
            command.isEnabled = true
            let token = command.addTarget { _ in Task { @MainActor in action() }; return .success }
            remoteTargets.append((command,token))
        }
        add(remote.playCommand) { [weak self] in self?.resume() }
        add(remote.pauseCommand) { [weak self] in self?.pause() }
        add(remote.togglePlayPauseCommand) { [weak self] in guard let self else { return }; self.player.rate > 0 ? self.pause():self.resume() }
        add(remote.nextTrackCommand) { [weak self] in self?.advance(1) }
        add(remote.previousTrackCommand) { [weak self] in self?.advance(-1) }
        let target = remote.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(event.positionTime) }; return .success
        }
        remote.changePlaybackPositionCommand.isEnabled = true; remoteTargets.append((remote.changePlaybackPositionCommand,target))
    }
    func listDownloads() { emit?("download",["state":"list","tracks":tracks.map(\.object)]); publish() }
    func download(_ track: SavedTrack) {
        if track.isLocal { listDownloads(); return }
        if tracks.contains(where: { $0.id == track.id }) { emit?("download",["id":track.id,"state":"ready","tracks":tracks.map(\.object)]); return }
        guard downloadTasks[track.id] == nil else { return }
        emit?("download",["id":track.id,"state":"loading"])
        let ticket = UUID(); downloadTickets[track.id] = ticket
        downloadTasks[track.id] = Task { [weak self] in
            guard let self else { return }
            let background = NativeBackgroundTime()
            background.start { [weak self] in if self?.downloadTickets[track.id] == ticket { self?.downloadTasks[track.id]?.cancel() } }
            defer { background.end(); if self.downloadTickets[track.id] == ticket { self.downloadTasks.removeValue(forKey:track.id); self.downloadTickets.removeValue(forKey:track.id) } }
            do {
                let size = self.storedBytes()
                guard size < 256*1024*1024 else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные загрузки.") }
                var request = URLRequest(url: URL(string:track.audioUrl)!); request.timeoutInterval = 125
                let transport = NoRedirects(maximumDownloadBytes:20_000_000)
                let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForResource = 125; configuration.urlCache = nil; configuration.httpShouldSetCookies = false
                let session = URLSession(configuration:configuration,delegate:transport,delegateQueue:nil)
                defer { session.invalidateAndCancel() }
                let (temporary,response) = try await session.download(for:request,delegate:transport)
                defer { try? FileManager.default.removeItem(at:temporary) }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200, http.mimeType == "audio/mpeg" else { throw UserError.message("Аудио ещё не готово. Запусти трек и повтори сохранение.") }
                let bytes = (try FileManager.default.attributesOfItem(atPath:temporary.path)[.size] as? NSNumber)?.int64Value ?? 0
                guard bytes > 128, bytes <= 20_000_000, size+bytes <= 256*1024*1024,
                      response.expectedContentLength < 0 || response.expectedContentLength == bytes else { throw UserError.message("Аудиофайл получен не полностью или превышает лимит загрузки.") }
                let handle = try FileHandle(forReadingFrom:temporary); let header = try handle.read(upToCount:3) ?? Data(); try handle.close()
                guard header.starts(with:Data("ID3".utf8)) || header.count >= 2 && header[0] == 0xff && header[1] & 0xe0 == 0xe0 else { throw UserError.message("Сервер не вернул MP3.") }
                let duration = try await AVURLAsset(url:temporary).load(.duration).seconds
                guard duration.isFinite, duration > 0, track.duration <= 20 || duration >= track.duration*0.8 else { throw UserError.message("Источник отдал только отрывок. Загрузка не сохранена.") }
                try Task.checkCancellation()
                let committedBytes = self.storedBytes()
                guard committedBytes+bytes <= 256*1024*1024 else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные загрузки.") }
                let updated = self.tracks+[track]
                try OfflineCommit.install(temporary:temporary,destination:self.file(track),index:self.index,data:try JSONEncoder().encode(updated))
                self.tracks = updated; self.emit?("download",["id":track.id,"state":"ready","tracks":updated.map(\.object)])
            } catch { self.emit?("download",["id":track.id,"state":"error","error":(error as? UserError)?.localizedDescription ?? "Не удалось сохранить трек. Проверь сеть и свободное место."]) }
        }
    }
    func removeDownload(_ id: String) {
        guard let removed = tracks.first(where: { $0.id == id }) else { return }
        downloadTasks[id]?.cancel()
        let remaining = tracks.filter { $0.id != id }
        do {
            try JSONEncoder().encode(remaining).write(to:index,options:.atomic)
            tracks = remaining; try? FileManager.default.removeItem(at:file(removed)); listDownloads()
        } catch { emit?("download",["id":id,"state":"error","error":"Не удалось удалить загрузку. Повтори попытку."]) }
    }
    private func storedBytes() -> Int64 {
        LocalAudioFiles.storedBytes(in:directory)
    }
    func importCancelled() { emit?("download",["state":"cancelled","import":true,"importing":false]) }
    func importAudio(_ urls: [URL]) {
        if importTask != nil { emit?("download",["state":"error","import":true,"importing":true,"error":"Дождись окончания текущего импорта."]); return }
        guard !urls.isEmpty, urls.count <= 20 else { emit?("download",["state":"error","import":true,"importing":false,"error":"Выбери до 20 аудиофайлов."]); return }
        let ticket = UUID(); importTicket = ticket
        emit?("download",["state":"loading","import":true,"importing":true])
        importTask = Task { [weak self] in
            guard let self else { return }
            let background = NativeBackgroundTime()
            background.start(name:"LolzCloud audio import") { [weak self] in if self?.importTicket == ticket { self?.importTask?.cancel() } }
            defer { background.end(); if self.importTicket == ticket { self.importTask = nil; self.importTicket = nil }; self.emit?("download",["state":"list","import":true,"importing":false,"tracks":self.tracks.map(\.object)]) }
            for url in urls {
                do {
                    try Task.checkCancellation()
                    let budget = min(LocalAudioFiles.maximumBytes,LocalAudioFiles.quota-self.storedBytes())
                    guard budget > 128 else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные записи.") }
                    let importDirectory = self.directory
                    let copy = Task.detached(priority:.userInitiated) { try copyImportedAudio(url,to:importDirectory,maximum:budget) }
                    let staged = try await withTaskCancellationHandler(operation:{ try await copy.value },onCancel:{ copy.cancel() })
                    defer { try? FileManager.default.removeItem(at:staged.url) }
                    try Task.checkCancellation()
                    let asset = AVURLAsset(url:staged.url)
                    let playable = try await asset.load(.isPlayable), duration = try await asset.load(.duration).seconds
                    let audio = try await asset.loadTracks(withMediaType:.audio)
                    guard playable, !audio.isEmpty, duration.isFinite, duration > 0, duration <= 86400,
                          let track = SavedTrack.imported(id:staged.id,title:staged.title,artist:"Локальная музыка",duration:duration,fileExtension:staged.fileExtension) else { throw UserError.message("iOS не может воспроизвести этот аудиофайл.") }
                    try Task.checkCancellation()
                    guard self.storedBytes()+staged.bytes <= LocalAudioFiles.quota else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные записи.") }
                    self.tracks = try LocalAudioFiles.commit(track,temporary:staged.url,in:self.directory,index:self.index,registered:self.tracks)
                    self.emit?("download",["id":track.id,"state":"ready","import":true,"importing":true,"tracks":self.tracks.map(\.object)])
                } catch is CancellationError { self.importCancelled(); break }
                catch { self.emit?("download",["state":"error","import":true,"importing":true,"error":(error as? UserError)?.localizedDescription ?? "Не удалось импортировать аудио. Проверь доступ к файлу и свободное место."]) }
            }
        }
    }
}

private func copyImportedAudio(_ url: URL,to directory: URL,maximum: Int64) throws -> LocalAudioFiles.Staged {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let coordinator = NSFileCoordinator(filePresenter:nil)
    var failure: NSError?, result: Result<LocalAudioFiles.Staged,Error>?
    coordinator.coordinate(readingItemAt:url,options:[],error:&failure) { source in result = Result { try LocalAudioFiles.stage(source,in:directory,maximum:maximum) } }
    if let failure { throw failure }
    guard let result else { throw UserError.message("Не удалось открыть выбранный файл.") }
    return try result.get()
}

@MainActor private final class NativeBackgroundTime {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    func start(name: String = "LolzCloud download",expired: @escaping @MainActor () -> Void) {
        identifier = UIApplication.shared.beginBackgroundTask(withName:name) { [weak self] in
            Task { @MainActor in expired(); self?.end() }
        }
    }
    func end() {
        guard identifier != .invalid else { return }
        let previous = identifier; identifier = .invalid
        UIApplication.shared.endBackgroundTask(previous)
    }
}
