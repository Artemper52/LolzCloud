import Foundation
import AVFoundation
import MediaToolbox

// All control and persistence stay on the main actor. Tap rendering and buffer
// lifetime are exclusively in C; the render callback never enters Swift/ARC.
@MainActor final class NativeAudioEffects {
    private(set) var settings = AudioEffectsSettings()
    private(set) var revision = 0
    private var document = ""
    private var serial: UInt32 = 1
    private var binding: AudioEffectsBinding?
    private var unavailable = ""
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: "native_audio_effects_v1"), data.count < 4096,
           let decoded = try? JSONDecoder().decode(AudioEffectsSettings.self, from: data),
           let valid = AudioEffectsSettings(decoded.object) { settings = valid }
    }

    @discardableResult func configure(_ object: [String:Any], revision next: Int, client: String) -> Bool {
        guard next > 0, next <= 9_007_199_254_740_991, let value = AudioEffectsSettings(object) else { return false }
        if document == client {
            guard next >= revision, next != revision || value == settings else { return false }
        }
        let changed = value != settings
        document = client; revision = next; settings = value
        if changed {
            serial &+= 1; if serial == 0 { serial = 1 }
            binding?.configure(settings, serial: serial)
            if let data = try? JSONEncoder().encode(settings) { defaults.set(data, forKey: "native_audio_effects_v1") }
        }
        return true
    }

    func clearItem() { binding = nil; unavailable = "" }
    func markUnavailable() { binding = nil; unavailable = "Для этого источника эквалайзер недоступен. Исходный звук сохранён." }

    func attach(to item: AVPlayerItem, tracks: [AVAssetTrack]) throws {
        guard !tracks.isEmpty, tracks.count <= 8 else { throw UserError.message("Неподдерживаемое число аудиодорожек.") }
        let next = try AudioEffectsBinding(tracks: tracks, settings: settings, serial: serial)
        item.audioMix = next.mix
        binding = next; unavailable = ""
    }

    // A genuine render measurement, also used by hosted runtime tests. Reading
    // it performs atomic loads; it does not fabricate frames or process audio.
    var measurement: LCDSPMetrics? {
        let rows = binding?.measurements ?? []
        return rows.first(where: { $0.processedFrames > 0 }) ?? rows.first
    }

    var status: [String:Any] {
        let rows = binding?.measurements ?? []
        let active = rows.filter { $0.processedFrames > 0 }
        let metric = active.first ?? rows.first
        let frames = active.reduce(UInt64(0)) { $0 &+ $1.processedFrames }
        let matched = !active.isEmpty && active.allSatisfy { $0.prepared != 0 && $0.appliedRevision == serial && $0.unavailableReason == 0 }
        var reason = unavailable
        if rows.contains(where: { $0.unavailableReason == 1 }) { reason = "Для формата этого файла эквалайзер недоступен. Исходный звук сохранён." }
        else if rows.contains(where: { $0.unavailableReason == 2 }) { reason = "Не удалось подготовить эквалайзер. Исходный звук сохранён." }
        else if rows.contains(where: { $0.unavailableReason == 3 }) { reason = "Выбранная полоса выше частоты этого файла. Уменьши её до нуля." }
        let state = !settings.enabled ? "bypassed" : !reason.isEmpty ? "unsupported" : matched ? "applied" : "pending"
        return ["revision":revision,"config":settings.object,
            "capabilities":["eq":true,"preamp":true,"reverb":false,"echo":false,"normalization":false,"pitch":false],
            "state":state,"appliedRevision":matched ? revision : 0,
            "sampleRate":metric?.sampleRate ?? 0,"channels":metric?.channels ?? 0,
            "processedFrames":frames,"activeBandMask":metric?.activeBandMask ?? 0,
            "headroomDb":metric?.headroomDb ?? 0,"error":reason]
    }
}

private final class AudioEffectsBinding {
    let mix: AVAudioMix
    private let cores: [OpaquePointer]
    init(tracks: [AVAssetTrack], settings: AudioEffectsSettings, serial: UInt32) throws {
        var created: [OpaquePointer] = []
        var parameters: [AVAudioMixInputParameters] = []
        do {
            for track in tracks {
                guard let core = LCDSPCreate() else { throw UserError.message("Не удалось подготовить эквалайзер.") }
                created.append(core)
                let gains = settings.gains.map(Float.init)
                let valid = gains.withUnsafeBufferPointer { LCDSPConfigure(core, settings.enabled ? 1 : 0, $0.baseAddress, $0.count, Float(settings.preampDb), serial) }
                guard valid != 0, let tap = LCNativeAudioTapCreate(core) else { throw UserError.message("Не удалось подключить эквалайзер.") }
                let input = AVMutableAudioMixInputParameters(track: track)
                input.audioTapProcessor = tap
                parameters.append(input)
            }
            let result = AVMutableAudioMix(); result.inputParameters = parameters
            mix = result; cores = created
        } catch { created.forEach { LCDSPRelease($0) }; throw error }
    }
    func configure(_ settings: AudioEffectsSettings, serial: UInt32) {
        let gains = settings.gains.map(Float.init)
        gains.withUnsafeBufferPointer { buffer in
            for core in cores { _ = LCDSPConfigure(core, settings.enabled ? 1 : 0, buffer.baseAddress, buffer.count, Float(settings.preampDb), serial) }
        }
    }
    var measurements: [LCDSPMetrics] { cores.map { LCDSPReadMetrics($0) } }
    deinit { cores.forEach { LCDSPRelease($0) } }
}
