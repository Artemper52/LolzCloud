import Foundation
import CoreFoundation

struct AudioEffectsSettings: Codable, Equatable {
    var enabled = false
    var gains = [Double](repeating: 0, count: 5)
    var preampDb = 0.0
    var reverb = 0.0
    var echo = 0.0
    var normalization = false
    init() { }
    init?(_ object: [String:Any]) {
        let keys = Set(object.keys), legacy = keys == Set(["enabled","gains","preampDb"])
        guard legacy || keys == Set(["enabled","gains","preampDb","reverb","echo","normalization"]),
              let flag = object["enabled"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(),
              let values = object["gains"] as? [Any], values.count == 5,
              let preamp = MediaPolicy.number(object["preampDb"]), (-12...0).contains(preamp) else { return nil }
        let parsed = values.compactMap(MediaPolicy.number)
        guard parsed.count == 5, parsed.allSatisfy({ (-12...12).contains($0) }) else { return nil }
        enabled = flag.boolValue; gains = parsed; preampDb = preamp
        if !legacy {
            guard let room = MediaPolicy.number(object["reverb"]), (0...0.8).contains(room),
                  let delay = MediaPolicy.number(object["echo"]), (0...0.8).contains(delay),
                  let normal = object["normalization"] as? NSNumber, CFGetTypeID(normal) == CFBooleanGetTypeID() else { return nil }
            reverb = room; echo = delay; normalization = normal.boolValue
        }
    }
    private enum CodingKeys: String, CodingKey { case enabled, gains, preampDb, reverb, echo, normalization }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let object: [String:Any] = ["enabled":try values.decode(Bool.self,forKey:.enabled),
            "gains":try values.decode([Double].self,forKey:.gains),"preampDb":try values.decode(Double.self,forKey:.preampDb),
            "reverb":try values.decodeIfPresent(Double.self,forKey:.reverb) ?? 0,
            "echo":try values.decodeIfPresent(Double.self,forKey:.echo) ?? 0,
            "normalization":try values.decodeIfPresent(Bool.self,forKey:.normalization) ?? false]
        guard let valid = AudioEffectsSettings(object) else { throw DecodingError.dataCorrupted(.init(codingPath:decoder.codingPath,debugDescription:"Invalid audio effects")) }
        self = valid
    }
    var object: [String:Any] { ["enabled":enabled,"gains":gains,"preampDb":preampDb,"reverb":reverb,"echo":echo,"normalization":normalization] }
}
