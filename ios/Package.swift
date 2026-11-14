// swift-tools-version: 5.9
import PackageDescription
let package = Package(name:"LolzCloudPolicy",platforms:[.macOS(.v12),.iOS("16.4")],products:[.library(name:"LolzCloudPolicy",targets:["LolzCloudPolicy"])],targets:[
    .target(name:"LolzCloudPolicy",path:"LolzCloud",exclude:["App.swift","NativePlayer.swift","AccountLogin.swift","NativeAudioEffects.swift","DSP","Info.plist","Assets.xcassets"],sources:["MediaPolicy.swift","AudioEffectsPolicy.swift"]),
    .target(name:"LolzCloudDSPCore",path:"LolzCloud/DSP",exclude:["NativeAudioTap.c","NativeAudioTap.h","NativeAudioEffectsBridge.h"],sources:["DSPCore.c"],publicHeadersPath:"include",linkerSettings:[.linkedLibrary("m")]),
    .testTarget(name:"LolzCloudPolicyTests",dependencies:["LolzCloudPolicy","LolzCloudDSPCore"],path:"Tests")
])
