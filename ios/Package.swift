// swift-tools-version: 5.9
import PackageDescription
let package = Package(name:"LolzCloudPolicy",platforms:[.macOS(.v12),.iOS("16.4")],products:[.library(name:"LolzCloudPolicy",targets:["LolzCloudPolicy"])],targets:[
    .target(name:"LolzCloudPolicy",path:"LolzCloud",exclude:["App.swift","NativePlayer.swift","AccountLogin.swift","Info.plist","Assets.xcassets"],sources:["MediaPolicy.swift"]),
    .testTarget(name:"LolzCloudPolicyTests",dependencies:["LolzCloudPolicy"],path:"Tests")
])
