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
    @Published private(set) var playbackPosition: Double = 0
    @Published private(set) var playbackDuration: Double = 0
    @Published private(set) var offlineRepeatMode = "off"
    @Published private(set) var offlineShuffle = false
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
    private var selectionAlias: String?
    private var clientIntent = NativeClientIntent()
    private var roomBinding = NativeRoomBinding()
    private var roomCommands = [String:NativeRoomCommand]()
    private var roomCommandTasks = [String:Task<Void,Never>]()
    private var roomSampledAt = ProcessInfo.processInfo.systemUptime
    private var preparationTask: Task<Void,Never>?
    private var effectsTask: Task<Void,Never>?
    private var needsEffectsPreparation = false
    let audioEffects = NativeAudioEffects()
    private var needsPreparation = false
    private var requestedPosition: Double = 0
    private var settings = PlaybackSettings()
    private var rateBinding = NativeRateBinding()
    private let rateDefaults: UserDefaults
    private var sleepTask: Task<Void,Never>?
    private var watchdog: Task<Void,Never>?
    private var downloadTasks: [String: Task<Void, Never>] = [:]
    private var downloadTickets: [String: UUID] = [:]
    private var importTask: Task<Void,Never>?
    private var importTicket: UUID?
    var importing: Bool { importTask != nil }
    var isOfflineQueue: Bool { offlineQueue }
    var hasRoomOwner: Bool { roomBinding.current != nil }
    struct OfflineHandoff {
        fileprivate let generation: Int
        fileprivate let client: String?
        fileprivate let request: Int?
    }
    func offlineHandoff() -> OfflineHandoff { OfflineHandoff(generation:roomBinding.generation,client:clientIntent.clientID,request:clientIntent.requestID) }
    @discardableResult func finishOfflineHandoff(_ ticket: OfflineHandoff) -> Bool {
        guard clientIntent.clientID==ticket.client,clientIntent.requestID==ticket.request,
              roomBinding.retireForOffline(expectedGeneration:ticket.generation) else { return false }
        clearRoomCommands();pause();return true
    }
    func parentDocumentReplaced() { roomBinding.parentDocumentReplaced();clearRoomCommands();publish() }
    private let directory: URL
    private let index: URL
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    init(defaults: UserDefaults = .standard) {
        rateDefaults = defaults
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Offline", isDirectory: true)
        index = directory.appendingPathComponent("index.json")
        if let data = defaults.data(forKey:"native_rate_settings_v1"), data.count <= 1024,
           let saved = try? JSONDecoder().decode(NativeRatePreferences.self,from:data) {
            _ = settings.setRate(saved.value,preservesPitch:saved.preservesPitch)
        }
        player.defaultRate = Float(settings.rate)
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
                guard let self, !self.roomBinding.soloBlocked, self.current != nil, self.state != "error", self.state != "ended", !self.needsPreparation, !self.needsEffectsPreparation else { return }
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
    func ownsClientIntent(client: String, request: Int) -> Bool { clientIntent.clientID == client && clientIntent.requestID == request }
    var capabilities: [String:Any] { clientIntent.fields.merging(["catalogReferences":1,"profileExport":1,"effectsSchema":2,"maxEffectsSchema":3,"independentPitch":1,"preservesPitch":1,"roomTransport":1]) { _,new in new } }
    @discardableResult func configureRoom(_ object: [String:Any],client: String,request: Int) -> Bool {
        guard ownsClientIntent(client:client,request:request),let snapshot=NativeRoomTransport(object),
              let change=roomBinding.accept(snapshot,client:client,request:request) else { return false }
        if change == .acquired {
            let position=player.currentTime().seconds
            if player.currentItem != nil,position.isFinite,position>=0 { requestedPosition=position }
            // Fence every old prepare, ready, EOF and interruption callback.
            intent.stop();preparationTask?.cancel();preparationTask=nil;effectsTask?.cancel();effectsTask=nil
            watchdog?.cancel();watchdog=nil;player.pause();itemObservation=nil
            if let endObserver { NotificationCenter.default.removeObserver(endObserver);self.endObserver=nil }
            player.replaceCurrentItem(with:nil);needsEffectsPreparation=false;audioEffects.clearItem()
            needsPreparation=current?.isLocal != true;state="paused";error=""
            clearRoomCommands()
        } else if change == .released { clearRoomCommands() }
        roomSampledAt=ProcessInfo.processInfo.systemUptime;publish();return true
    }
    private func clearRoomCommands() {
        for task in roomCommandTasks.values { task.cancel() };roomCommandTasks.removeAll();roomCommands.removeAll()
    }
    func canDeliverRoomCommand(_ detail: [String:Any]) -> Bool {
        guard let id=detail["id"] as? String,let command=roomCommands[id] else { return false }
        return roomBinding.owns(command,now:ProcessInfo.processInfo.systemUptime) && ownsClientIntent(client:command.client,request:command.request)
    }
    @discardableResult func roomCommandResult(_ detail: [String:Any],client: String,request: Int) -> Bool {
        guard ownsClientIntent(client:client,request:request),let id=detail["id"] as? String,var command=roomCommands[id],
              command.client==client,command.request==request,roomBinding.owns(command,now:ProcessInfo.processInfo.systemUptime),
              let current=roomBinding.current,current.matches(detail),current.documentID==command.transport.documentID,
              current.epoch==command.transport.epoch,let ok=NativeRoomTransport.boolean(detail["ok"]),
              detail["error"]==nil || detail["error"] is String else { return false }
        let error=detail["error"] as? String ?? "";guard error.count<=300 else { return false }
        let pending: Bool
        if let value=detail["pending"] { guard let flag=NativeRoomTransport.boolean(value) else { return false };pending=flag }
        else { pending=false }
        if pending {
            guard ok else { return false };let accepted=command.acceptedDelivery
            guard command.acceptDelivery(now:ProcessInfo.processInfo.systemUptime) else { return false }
            roomCommands[id]=command
            if !accepted { scheduleRoomTimeout(command) }
            return true
        }
        roomCommands.removeValue(forKey:id);roomCommandTasks.removeValue(forKey:id)?.cancel()
        if !ok { emitRoomResult(command,state:"error",error:error.isEmpty ? "Комната не выполнила команду.":error) }
        return true
    }
    private func refreshRemoteAvailability() {
        let remote=MPRemoteCommandCenter.shared(),room=roomBinding.current,solo = !roomBinding.soloBlocked
        remote.playCommand.isEnabled=room?.capabilities["play"] ?? solo
        remote.pauseCommand.isEnabled=room?.capabilities["pause"] ?? solo
        remote.togglePlayPauseCommand.isEnabled=room != nil ? (room!.capabilities["play"]==true || room!.capabilities["pause"]==true):solo
        remote.nextTrackCommand.isEnabled=room?.capabilities["next"] ?? solo
        remote.previousTrackCommand.isEnabled=room?.capabilities["previous"] ?? solo
        remote.changePlaybackPositionCommand.isEnabled=room?.capabilities["seek"] ?? solo
    }
    private func emitRoomResult(_ command: NativeRoomCommand,state: String,error: String="") {
        var detail=command.detail;detail["state"]=state;if !error.isEmpty { detail["error"]=error };emit?("room-command-result",detail)
    }
    private func scheduleRoomTimeout(_ command: NativeRoomCommand) {
        roomCommandTasks.removeValue(forKey:command.id)?.cancel()
        let remaining=max(0,command.deadline-ProcessInfo.processInfo.systemUptime)
        roomCommandTasks[command.id]=Task { [weak self] in
            do { try await Task.sleep(nanoseconds:UInt64(remaining*1_000_000_000)) } catch { return }
            guard !Task.isCancelled,let self,let expired=self.roomCommands[command.id],expired.deadline==command.deadline else { return }
            self.roomCommands.removeValue(forKey:command.id);self.roomCommandTasks.removeValue(forKey:command.id)
            self.emitRoomResult(expired,state:"expired",error:"Команда комнаты не выполнена вовремя. Вернись в комнату и повтори.")
        }
    }
    @discardableResult func mediaCommand(_ command: String,value: Double?=nil) -> Bool {
        if roomBinding.current != nil {
            guard roomCommands.count<8,let next=roomBinding.command(command,value:value,now:ProcessInfo.processInfo.systemUptime) else { return false }
            roomCommands[next.id]=next
            scheduleRoomTimeout(next)
            emit?("room-command",next.detail)
            return true
        }
        guard !roomBinding.soloBlocked else { return false }
        switch command {
        case "play":resume()
        case "pause":pause()
        case "next":advance(1)
        case "previous":advance(-1)
        case "seek":guard let value,value.isFinite,value>=0 else { return false };seek(value)
        default:return false
        }
        return true
    }
    @discardableResult func configureEffects(_ config: [String:Any], revision: Int, client: String, request: Int) -> Bool {
        // Settings acknowledge the current transport owner; they cannot advance
        // its request ID, change playback generation, cancel prepare or resume.
        guard clientIntent.clientID == client, clientIntent.requestID == request,
              audioEffects.configure(config,revision:revision,client:client,request:request) else { return false }
        emit?("effects",effectsStatus); return true
    }
    private var effectsStatus: [String:Any] {
        var result = audioEffects.status
        result["catalogReferences"] = 1
        result["preservesPitch"] = 1
        result["roomTransport"] = 1
        if var normalization = result["normalization"] as? [String:Any] {
            normalization["key"] = current?.id ?? ""; result["normalization"] = normalization
        }
        return result
    }
    private func transportEvent(_ name: String,_ detail: [String:Any]) { emit?(name,detail.merging(clientIntent.fields) { _,new in new }) }
    func configureQueue(_ tracks: [SavedTrack], index: Int, repeatMode: String, shuffle: Bool) {
        let resolved = tracks.map { track -> SavedTrack in
            guard track.isLocal else { return track }
            return self.tracks.first { $0.id == track.id && $0.isLocal } ?? track
        }
        guard queue.configure(resolved,index:index,repeatMode:repeatMode,shuffle:shuffle,currentID:current?.id ?? queue.current?.id) else { return }
        if let selected = queue.current, selected.id == current?.id { current = selected }
        if resolved.indices.contains(queue.index), resolved[queue.index].isCatalogReference,
           let current, resolved[queue.index].sameCatalogIdentity(as:current) { selectionAlias = resolved[queue.index].id }
        publish()
    }
    func play(_ requested: SavedTrack, position: Double = 0, localQueue: Bool = false, prepare: Bool = false, queueIndex: Int? = nil) {
        guard roomBinding.current==nil else { return }
        var selected = requested
        if let queueIndex {
            guard queue.tracks.indices.contains(queueIndex), queue.tracks[queueIndex].sameCatalogIdentity(as:requested) else { return }
            let slot = queue.tracks[queueIndex]
            // Canonicalize this explicit occurrence only. A stale web ref must
            // not force a second lookup or move to the first equal duplicate.
            if requested.isCatalogReference, !slot.isCatalogReference { selected = slot }
            _ = queue.select(slot.id,index:queueIndex)
            if !selected.isLocal, !selected.isCatalogReference { guard queue.refreshCurrent(selected,expectedID:slot.id) else { return } }
        }
        _ = roomBinding.chooseSolo();clearRoomCommands()
        let ticket = intent.select()
        queue.select(selected.id,index:queueIndex); selectionAlias = requested.isCatalogReference ? requested.id : nil
        preparationTask?.cancel(); preparationTask = nil
        effectsTask?.cancel(); effectsTask = nil; needsEffectsPreparation = false; audioEffects.clearItem()
        offlineQueue = localQueue; watchdog?.cancel(); watchdog = nil
        player.pause(); itemObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver); self.endObserver = nil }
        player.replaceCurrentItem(with: nil)
        current = selected; state = "loading"; error = ""
        let track: SavedTrack
        if selected.isLocal {
            guard let registered = tracks.first(where: { $0.id == selected.id && $0.isLocal }), LocalAudioFiles.existing(registered,in:directory) != nil else { fail("Локальный файл не найден. Импортируй его заново."); return }
            track = registered; current = track
        } else { track = selected }
        requestedPosition = position.isFinite ? max(0,position) : 0
        needsPreparation = track.isCatalogReference || (prepare && !tracks.contains(where: { $0.id == track.id }))
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
                    let resolved = try await NativeCatalog.resolve(track)
                    try Task.checkCancellation()
                    guard self.generation == ticket, self.intent.wantsPlay, self.current?.sameCatalogIdentity(as:track) == true else { return }
                    if track.isCatalogReference {
                        if self.queue.current?.sameCatalogIdentity(as:track) == true { guard self.queue.refreshCurrent(resolved,expectedID:self.queue.current!.id) else { throw UserError.message("Очередь изменилась. Выбери трек ещё раз.") } }
                        self.selectionAlias = track.id; self.current = resolved; self.publish()
                    }
                    if !self.tracks.contains(where:{ $0.id == resolved.id && LocalAudioFiles.existing($0,in:self.directory) != nil }) {
                        try await AudioPreparation.awaitReady(audio:resolved.audioUrl,request:{ endpoint, timeout in try await self.prepareRequest(endpoint,timeout:timeout,expected:resolved.audioUrl) })
                    }
                    try Task.checkCancellation()
                    guard self.generation == ticket, self.intent.wantsPlay else { return }
                    self.needsPreparation = false; self.install(resolved,ticket:ticket,position:self.requestedPosition)
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
        else { guard let address = MediaPolicy.audio(track.audioUrl) else { fail("Не удалось восстановить сохранённый трек. Повтори попытку."); return }; source = address }
        let item = AVPlayerItem(url: source)
        item.audioTimePitchAlgorithm = settings.preservesPitch ? .spectral : .varispeed
        player.replaceCurrentItem(with: item)
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
        needsEffectsPreparation = true; watch(); publish()
        effectsTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == ticket { self.effectsTask = nil } }
            do {
                let tracks = try await item.asset.loadTracks(withMediaType:.audio)
                try Task.checkCancellation()
                guard self.generation == ticket, self.player.currentItem === item, self.intent.wantsPlay else { return }
                try self.audioEffects.attach(to:item,tracks:tracks)
            } catch is CancellationError { return }
            catch {
                guard self.generation == ticket, self.player.currentItem === item, self.intent.wantsPlay else { return }
                self.audioEffects.markUnavailable()
            }
            guard self.generation == ticket, self.player.currentItem === item, self.intent.wantsPlay, !Task.isCancelled else { return }
            self.needsEffectsPreparation = false
            self.player.defaultRate = Float(self.settings.rate); self.player.play(); self.watch(); self.publish()
        }
    }
    func playOffline(_ track: SavedTrack) {
        guard roomBinding.current==nil,let index=tracks.firstIndex(where:{$0.id==track.id}),
              queue.configure(tracks,index:index,repeatMode:offlineRepeatMode,shuffle:offlineShuffle,currentID:nil) else { return }
        play(tracks[index],localQueue:true,queueIndex:index)
    }
    func configureOffline(repeatMode: String,shuffle: Bool) {
        guard ["off","all","one"].contains(repeatMode) else { return }
        offlineRepeatMode=repeatMode;offlineShuffle=shuffle
        if offlineQueue { _=queue.configure(queue.tracks,index:queue.index,repeatMode:repeatMode,shuffle:shuffle,currentID:current?.id) }
        publish()
    }
    func pause() { intent.pause(); preparationTask?.cancel(); effectsTask?.cancel(); watchdog?.cancel(); watchdog = nil; player.pause(); state = "paused"; publish() }
    func resume() {
        guard roomBinding.current==nil else { return }
        guard let current else { return }
        _ = roomBinding.chooseSolo()
        let position = MediaPolicy.replayPosition(ended:state == "ended",position:player.currentItem == nil || needsEffectsPreparation ? requestedPosition : player.currentTime().seconds,duration:player.currentItem?.duration.seconds ?? 0)
        if player.currentItem == nil || player.currentItem?.status == .failed || needsEffectsPreparation { play(current,position:position,localQueue:offlineQueue,prepare:needsPreparation); return }
        do { try activate(); intent.resume(); if position == 0 { seek(0) }; error = ""; state = "loading"; player.defaultRate = Float(settings.rate); player.play(); watch(); publish() }
        catch { fail("Аудиосистема временно недоступна. Повтори попытку.") }
    }
    func stop() {
        intent.stop(); preparationTask?.cancel(); preparationTask = nil; needsPreparation = false; requestedPosition = 0; watchdog?.cancel(); watchdog = nil; player.pause(); itemObservation = nil
        effectsTask?.cancel(); effectsTask = nil; needsEffectsPreparation = false; audioEffects.clearItem()
        if let endObserver { NotificationCenter.default.removeObserver(endObserver); self.endObserver = nil }
        player.replaceCurrentItem(with: nil); current = nil; selectionAlias = nil; state = "paused"
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation); publish()
    }
    func seek(_ seconds: Double) {
        guard seconds.isFinite else { return }
        requestedPosition = max(0,seconds)
        let duration = player.currentItem?.duration.seconds ?? 0
        player.seek(to: CMTime(seconds: min(max(0,seconds),duration.isFinite && duration > 0 ? duration : max(0,seconds)), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        playbackPosition=duration.isFinite && duration>0 ? min(max(0,seconds),duration):max(0,seconds)
    }
    func volume(_ value: Double) { player.volume = Float(value.isFinite ? min(1,max(0,value)) : 1) }
    func rate(_ value: Double) {
        guard settings.setRate(value) else { return }
        rateBinding.clear(); applyRatePreferences()
    }
    @discardableResult func configureRate(_ object: [String:Any], client: String?, request: Int?) -> Bool {
        if let client, let request { guard ownsClientIntent(client:client,request:request) else { return false } }
        else { guard client == nil, request == nil, clientIntent.clientID == nil else { return false } }
        if object["preservesPitch"] != nil || object["revision"] != nil {
            guard let client, let request, let revision = MediaPolicy.requestID(object["revision"]),
                  let rawValue = object["value"], let flag = object["preservesPitch"],
                  let next = NativeRatePreferences(["value":rawValue,"preservesPitch":flag]),
                  rateBinding.accept(next,revision:revision,client:client,request:request) else { return false }
            _ = settings.setRate(next.value,preservesPitch:next.preservesPitch)
        } else {
            guard rateBinding.acceptsLegacy(client:client), let value = MediaPolicy.number(object["value"]), settings.setRate(value) else { return false }
        }
        applyRatePreferences(); return true
    }
    private func applyRatePreferences() {
        // Never call play(), seek(), acceptClientIntent() or cancel preparation
        // here. Changing the algorithm while paused must leave it paused.
        let wasPlaying = intent.wantsPlay && player.rate > 0
        let algorithm: AVAudioTimePitchAlgorithm = settings.preservesPitch ? .spectral : .varispeed
        if player.currentItem?.audioTimePitchAlgorithm != algorithm { player.currentItem?.audioTimePitchAlgorithm = algorithm }
        if player.defaultRate != Float(settings.rate) { player.defaultRate = Float(settings.rate) }
        if wasPlaying, player.rate != Float(settings.rate) { player.rate = Float(settings.rate) }
        if let data = try? JSONEncoder().encode(settings.ratePreferences), rateDefaults.data(forKey:"native_rate_settings_v1") != data { rateDefaults.set(data,forKey:"native_rate_settings_v1") }
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
                self.sleepTask = nil; self.error = ""; _ = self.mediaCommand("pause")
            }
        }
        publish()
    }
    func publish() {
        refreshRemoteAvailability()
        if settings.sleepDeadline > 0, Date().timeIntervalSince1970*1000 >= settings.sleepDeadline,
           settings.expireSleep(settings.sleepDeadline) { sleepTask?.cancel(); sleepTask = nil; error = ""; _ = mediaCommand("pause"); return }
        if let room=roomBinding.current {
            let elapsed=room.position+(room.playing ? max(0,ProcessInfo.processInfo.systemUptime-roomSampledAt):0)
            MPNowPlayingInfoCenter.default().nowPlayingInfo=[MPMediaItemPropertyTitle:room.title.isEmpty ? "Комната LolzCloud":room.title,
                MPMediaItemPropertyArtist:room.artist,MPMediaItemPropertyPlaybackDuration:room.duration,
                MPNowPlayingInfoPropertyElapsedPlaybackTime:room.duration>0 ? min(elapsed,room.duration):elapsed,
                MPNowPlayingInfoPropertyPlaybackRate:room.playing ? 1:0]
            return
        }
        if roomBinding.soloBlocked { MPNowPlayingInfoCenter.default().nowPlayingInfo=nil;return }
        let time = player.currentTime().seconds, duration = player.currentItem?.duration.seconds ?? 0
        playbackPosition=time.isFinite ? max(0,time):requestedPosition
        playbackDuration=duration.isFinite && duration>0 ? duration:(current?.duration ?? 0)
        // Effects acknowledge their own last accepted request, never a newly
        // handshaken transport document that has not sent settings yet.
        emit?("effects",effectsStatus)
        let queueOwned = queue.current?.id == current?.id && current != nil
        if queueOwned, let selected = queue.current {
            var detail: [String:Any] = ["index":queue.index,"track":selected.object,"queue":true]
            if let selectionAlias { detail["previousId"] = selectionAlias }
            transportEvent("selection",detail)
        }
        if !offlineQueue {
            let applied = intent.wantsPlay && player.timeControlStatus == .playing &&
                abs(Double(player.rate)-settings.rate)<0.01 && player.currentItem?.status == .readyToPlay &&
                player.currentItem?.audioTimePitchAlgorithm == (settings.preservesPitch ? .spectral : .varispeed)
            var detail: [String:Any] = ["id":current?.id ?? "","state":state,"time":time.isFinite ? max(0,time):requestedPosition,"duration":duration.isFinite && duration > 0 ? duration:(current?.duration ?? 0),"error":error,"queue":queueOwned,"rate":settings.rate,"preservesPitch":settings.preservesPitch,"sleepDeadline":settings.sleepDeadline,"catalogReferences":1]
            detail.merge(rateBinding.acknowledgement(client:clientIntent.clientID,request:clientIntent.requestID,applied:applied)) { _,new in new }
            transportEvent("playback",detail)
        }
        guard let track = current else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle:track.title,MPMediaItemPropertyArtist:track.artist,MPMediaItemPropertyPlaybackDuration:duration.isFinite && duration > 0 ? duration:track.duration,MPNowPlayingInfoPropertyElapsedPlaybackTime:time.isFinite ? max(0,time):0,MPNowPlayingInfoPropertyPlaybackRate:player.rate]
    }
    private func fail(_ message: String) { intent.pause(); effectsTask?.cancel(); watchdog?.cancel(); watchdog = nil; player.pause(); state = "error"; error = message; publish() }
    private func watch() {
        guard watchdog == nil else { return }; let ticket = generation
        watchdog = Task { [weak self] in
            do { try await Task.sleep(nanoseconds:30_000_000_000) } catch { return }
            guard let self, !Task.isCancelled, self.generation == ticket else { return }
            self.watchdog = nil
            if self.state == "loading" { self.fail("Подготовка аудио заняла слишком много времени. Проверь сеть и повтори попытку.") }
        }
    }
    private func advance(_ step: Int,automatic: Bool = false) {
        guard !roomBinding.soloBlocked else { return }
        if step < 0, player.currentTime().seconds > 3 { seek(0); publish(); return }
        guard let selected = queue.step(step,automatic:automatic) else { if !automatic { pause() }; return }
        play(selected,localQueue:offlineQueue,prepare:!offlineQueue,queueIndex:queue.index)
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
                if type == AVAudioSession.InterruptionType.began.rawValue, self.roomBinding.current != nil { _ = self.mediaCommand("pause");return }
                if type == AVAudioSession.InterruptionType.began.rawValue { self.intent.interrupt(); self.watchdog?.cancel(); self.watchdog = nil; self.player.pause(); self.state = "paused"; self.publish() }
                else if type == AVAudioSession.InterruptionType.ended.rawValue, self.intent.finishInterruption(shouldResume:AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)) { self.resume() }
            }
        })
        audioObservers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { Task { @MainActor in _ = self?.mediaCommand("pause") } }
        })
    }
    private func configureRemote() {
        let remote = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ action: @escaping @MainActor () -> Void) {
            command.isEnabled = true
            let token = command.addTarget { _ in Task { @MainActor in action() }; return .success }
            remoteTargets.append((command,token))
        }
        add(remote.playCommand) { [weak self] in _ = self?.mediaCommand("play") }
        add(remote.pauseCommand) { [weak self] in _ = self?.mediaCommand("pause") }
        add(remote.togglePlayPauseCommand) { [weak self] in guard let self else { return }; _ = self.mediaCommand((self.roomBinding.current?.playing ?? (self.player.rate>0)) ? "pause":"play") }
        add(remote.nextTrackCommand) { [weak self] in _ = self?.mediaCommand("next") }
        add(remote.previousTrackCommand) { [weak self] in _ = self?.mediaCommand("previous") }
        let target = remote.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in _ = self?.mediaCommand("seek",value:event.positionTime) }; return .success
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
                let resolved = try await NativeCatalog.resolve(track)
                try Task.checkCancellation()
                guard self.downloadTickets[track.id] == ticket else { return }
                if self.tracks.contains(where:{ $0.id == resolved.id }) {
                    self.emit?("download",["id":track.id,"state":"ready","track":resolved.object,"previousId":track.id,"tracks":self.tracks.map(\.object)]); return
                }
                if track.isCatalogReference {
                    try await AudioPreparation.awaitReady(audio:resolved.audioUrl,request:{ endpoint,timeout in try await self.prepareRequest(endpoint,timeout:timeout,expected:resolved.audioUrl) })
                    try Task.checkCancellation()
                }
                let size = self.storedBytes()
                guard size < 256*1024*1024 else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные загрузки.") }
                guard let address = MediaPolicy.audio(resolved.audioUrl) else { throw UserError.message("Не удалось восстановить адрес аудио.") }
                var request = URLRequest(url:address); request.timeoutInterval = 125
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
                guard duration.isFinite, duration > 0, resolved.duration <= 20 || duration >= resolved.duration*0.8 else { throw UserError.message("Источник отдал только отрывок. Загрузка не сохранена.") }
                try Task.checkCancellation()
                let committedBytes = self.storedBytes()
                if self.tracks.contains(where:{ $0.id == resolved.id }) { self.listDownloads(); return }
                guard committedBytes+bytes <= 256*1024*1024 else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные загрузки.") }
                let updated = self.tracks+[resolved]
                try OfflineCommit.install(temporary:temporary,destination:self.file(resolved),index:self.index,data:try JSONEncoder().encode(updated))
                self.tracks = updated; self.emit?("download",["id":track.id,"state":"ready","track":resolved.object,"previousId":track.id,"tracks":updated.map(\.object)])
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
                    guard playable, !audio.isEmpty, duration.isFinite, duration > 0, duration <= 86400 else { throw UserError.message("iOS не может воспроизвести этот аудиофайл.") }
                    let metadata=await self.importedMetadata(asset,fallbackTitle:staged.title)
                    guard let track=SavedTrack.imported(id:staged.id,title:metadata.title,artist:metadata.artist,duration:duration,fileExtension:staged.fileExtension) else { throw UserError.message("Не удалось прочитать сведения об аудио.") }
                    try Task.checkCancellation()
                    guard self.storedBytes()+staged.bytes <= LocalAudioFiles.quota else { throw UserError.message("Офлайн-хранилище заполнено. Удали ненужные записи.") }
                    self.tracks = try LocalAudioFiles.commit(track,temporary:staged.url,in:self.directory,index:self.index,registered:self.tracks)
                    self.emit?("download",["id":track.id,"state":"ready","import":true,"importing":true,"tracks":self.tracks.map(\.object)])
                } catch is CancellationError { self.importCancelled(); break }
                catch { self.emit?("download",["state":"error","import":true,"importing":true,"error":(error as? UserError)?.localizedDescription ?? "Не удалось импортировать аудио. Проверь доступ к файлу и свободное место."]) }
            }
        }
    }
    private func importedMetadata(_ asset: AVAsset,fallbackTitle: String) async -> ImportedAudioMetadata {
        let fallback=ImportedAudioMetadata(title:nil,artist:nil,fallbackTitle:fallbackTitle)
        // Read only title/artist values, never artwork blobs. This is a local
        // private copy: all access stays within the existing import transaction.
        return await withTaskCancellationHandler(operation:{
            await withTaskGroup(of:ImportedAudioMetadata?.self) { group in
                group.addTask {
                    do {
                        let loaded=try await asset.load(.commonMetadata),items=Array(loaded.prefix(64))
                        var title: String?,artist: String?
                        for item in AVMetadataItem.metadataItems(from:items,filteredByIdentifier:.commonIdentifierTitle).prefix(4) {
                            try Task.checkCancellation();let value=try await item.load(.stringValue)
                            if let value,!value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty { title=value;break }
                        }
                        for item in AVMetadataItem.metadataItems(from:items,filteredByIdentifier:.commonIdentifierArtist).prefix(4) {
                            try Task.checkCancellation();let value=try await item.load(.stringValue)
                            if let value,!value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty { artist=value;break }
                        }
                        return ImportedAudioMetadata(title:title,artist:artist,fallbackTitle:fallbackTitle)
                    } catch { return fallback }
                }
                group.addTask {
                    do { try await Task.sleep(nanoseconds:3_000_000_000) } catch { return nil }
                    asset.cancelLoading();return nil
                }
                let result=await group.next() ?? nil;group.cancelAll()
                if result==nil { asset.cancelLoading() };return result ?? fallback
            }
        },onCancel:{ asset.cancelLoading() })
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
