import Foundation
import CoreFoundation

// Persist only user audio preferences. A document's request/revision and a
// running sleep timer never survive an application restart.
struct NativeRatePreferences: Codable, Equatable {
    private(set) var value = 1.0
    // iOS previously used its pitch-correcting default algorithm. Keep that
    // behavior until a negotiated client explicitly chooses varispeed.
    private(set) var preservesPitch = true
    init() { }
    init?(value: Double, preservesPitch: Bool) {
        guard value.isFinite, (0.5...2).contains(value) else { return nil }
        self.value = value; self.preservesPitch = preservesPitch
    }
    init?(_ object: [String:Any]) {
        guard Set(object.keys) == Set(["value","preservesPitch"]),
              let value = MediaPolicy.number(object["value"]),
              let flag = object["preservesPitch"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { return nil }
        self.init(value:value,preservesPitch:flag.boolValue)
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy:CodingKeys.self)
        guard let valid = Self(value:try values.decode(Double.self,forKey:.value),
                               preservesPitch:try values.decode(Bool.self,forKey:.preservesPitch)) else {
            throw DecodingError.dataCorrupted(.init(codingPath:decoder.codingPath,debugDescription:"Invalid playback rate"))
        }
        self = valid
    }
    var object: [String:Any] { ["value":value,"preservesPitch":preservesPitch] }
}

// This is a settings binding, not a PlaybackIntent. Its caller must already
// own the exact current transport tag; accepting settings cannot advance it.
struct NativeRateBinding {
    private(set) var client = ""
    private(set) var request = 0
    private(set) var revision = 0
    private(set) var preferences = NativeRatePreferences()

    mutating func accept(_ value: NativeRatePreferences, revision next: Int, client: String, request: Int) -> Bool {
        guard MediaPolicy.localIdentifier("local:"+client), (1...9_007_199_254_740_991).contains(next),
              (1...9_007_199_254_740_991).contains(request) else { return false }
        if self.client == client {
            guard next >= revision, next != revision || value == preferences else { return false }
        }
        self.client = client; self.request = request; revision = next; preferences = value
        return true
    }
    func acceptsLegacy(client: String?) -> Bool { revision == 0 || client != self.client }
    func acknowledgement(client: String?, request: Int, applied: Bool) -> [String:Any] {
        guard revision > 0, self.client == client, self.request == request else { return [:] }
        return ["rateRevision":revision,"rateAppliedRevision":applied ? revision : 0,
                "rateState":applied ? "applied" : "pending"]
    }
    mutating func clear() { self = Self() }
}
