import Foundation
import CoreFoundation

struct AudioEffectsSettings: Codable, Equatable {
    var enabled = false
    var gains = [Double](repeating: 0, count: 5)
    var preampDb = 0.0
    init() { }
    init?(_ object: [String:Any]) {
        guard Set(object.keys) == Set(["enabled","gains","preampDb"]),
              let flag = object["enabled"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(),
              let values = object["gains"] as? [Any], values.count == 5,
              let preamp = MediaPolicy.number(object["preampDb"]), (-12...0).contains(preamp) else { return nil }
        let parsed = values.compactMap(MediaPolicy.number)
        guard parsed.count == 5, parsed.allSatisfy({ (-12...12).contains($0) }) else { return nil }
        enabled = flag.boolValue; gains = parsed; preampDb = preamp
    }
    var object: [String:Any] { ["enabled":enabled,"gains":gains,"preampDb":preampDb] }
}
