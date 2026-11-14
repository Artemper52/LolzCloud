// Run with `swift ios/tools/CheckProject.swift`; this validates project inputs, not an Apple SDK build.
import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

enum ProjectCheckError: Error { case invalid(String) }
func require(_ value: Bool,_ message: String) throws { if !value { throw ProjectCheckError.invalid(message) } }
let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent()
let projectURL = root.appendingPathComponent("LolzCloud.xcodeproj/project.pbxproj")
let project = try PropertyListSerialization.propertyList(from:Data(contentsOf:projectURL),options:[],format:nil) as! [String:Any]
let objects = project["objects"] as! [String:[String:Any]], rootID = project["rootObject"] as! String
try require(objects[rootID]?["isa"] as? String == "PBXProject","Project root must resolve")
func references(_ value: Any) throws {
    if let string = value as? String, string.range(of:"^[A-F0-9]{24}$",options:.regularExpression) != nil {
        try require(objects[string] != nil,"Missing PBX reference: "+string)
    } else if let values = value as? [Any] { for item in values { try references(item) } }
    else if let values = value as? [String:Any] { for item in values.values { try references(item) } }
}
try references(project)
let targets = objects.filter { $0.value["isa"] as? String == "PBXNativeTarget" }
try require(targets.count == 1,"Expected one application target")
let target = targets.first!, phases = target.value["buildPhases"] as! [String]
let sources = phases.compactMap { objects[$0] }.first { $0["isa"] as? String == "PBXSourcesBuildPhase" }!
let built = (sources["files"] as! [String]).compactMap { objects[$0]?["fileRef"] as? String }.compactMap { objects[$0]?["path"] as? String }
let expected = Set(["App.swift","MediaPolicy.swift","NativePlayer.swift","AccountLogin.swift"])
try require(Set(built) == expected,"Every native source must enter the application target")
for filename in built { try require(FileManager.default.fileExists(atPath:root.appendingPathComponent("LolzCloud/"+filename).path),"Missing source: "+filename) }
let info = try PropertyListSerialization.propertyList(from:Data(contentsOf:root.appendingPathComponent("LolzCloud/Info.plist")),options:[],format:nil) as! [String:Any]
try require((info["UIBackgroundModes"] as? [String])?.contains("audio") == true,"Audio background mode is required")
try require(info["CFBundleIdentifier"] as? String == "$(PRODUCT_BUNDLE_IDENTIFIER)","Bundle identifier must come from build settings")
let schemeURL = root.appendingPathComponent("LolzCloud.xcodeproj/xcshareddata/xcschemes/LolzCloud.xcscheme"), scheme = try Data(contentsOf:schemeURL)
try require(XMLParser(data:scheme).parse(),"Shared scheme must be valid XML")
try require(String(data:scheme,encoding:.utf8)!.contains("BlueprintIdentifier=\""+target.key+"\""),"Shared scheme must resolve the application target")
let icon = try Data(contentsOf:root.appendingPathComponent("LolzCloud/Assets.xcassets/AppIcon.appiconset/icon.png"))
try require(Array(icon.prefix(8)) == [137,80,78,71,13,10,26,10],"App icon must be PNG")
let width = icon[16..<20].reduce(0) { ($0<<8)|Int($1) }, height = icon[20..<24].reduce(0) { ($0<<8)|Int($1) }
try require(width == 1024 && height == 1024,"App icon must be 1024×1024")
let report: [String:Any] = ["status":"passed","projectObjects":objects.count,"nativeSources":built.sorted(),"backgroundAudio":true,"sharedScheme":true,"iconWidth":width,"iconHeight":height,"appleSDKBuild":"pending","deviceRuntime":"pending"]
print(String(data:try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
