'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// A separate disposable project: the published project and four production
// Swift files are inputs only and are never rewritten by runtime verification.
function generate(output){
 const root=path.resolve(__dirname,'..'),folder=path.resolve(output),project=path.join(folder,'LolzCloudRuntime.xcodeproj');
 const id=name=>crypto.createHash('sha256').update('LolzCloud-runtime:'+name).digest('hex').slice(0,24).toUpperCase();
 const q=value=>JSON.stringify(value),objects=[],add=(name,type,body)=>objects.push(`${id(name)} = { isa = ${type}; ${body} };`);
 const appFiles=['App.swift','MediaPolicy.swift','NativePlayer.swift','AccountLogin.swift'];
 for(const file of appFiles){add(file,'PBXFileReference',`lastKnownFileType = sourcecode.swift; path = ${q(path.join(root,'LolzCloud',file))}; sourceTree = "<absolute>";`);add('build:'+file,'PBXBuildFile',`fileRef = ${id(file)};`);}
 add('test-file','PBXFileReference',`lastKnownFileType = sourcecode.swift; path = ${q(path.join(root,'RuntimeTests','NativeRuntimeTests.swift'))}; sourceTree = "<absolute>";`);
 add('test-build','PBXBuildFile',`fileRef = ${id('test-file')};`);
 add('mp3','PBXFileReference',`lastKnownFileType = audio.mp3; path = ${q(path.join(root,'RuntimeTests','Fixtures','tone.mp3'))}; sourceTree = "<absolute>";`);
 add('mp3-build','PBXBuildFile',`fileRef = ${id('mp3')};`);
 add('assets','PBXFileReference',`lastKnownFileType = folder.assetcatalog; path = ${q(path.join(root,'LolzCloud','Assets.xcassets'))}; sourceTree = "<absolute>";`);
 add('assets-build','PBXBuildFile',`fileRef = ${id('assets')};`);
 add('app-product','PBXFileReference','explicitFileType = wrapper.application; path = LolzCloud.app; includeInIndex = 0; sourceTree = BUILT_PRODUCTS_DIR;');
 add('test-product','PBXFileReference','explicitFileType = wrapper.cfbundle; path = LolzCloudRuntimeTests.xctest; includeInIndex = 0; sourceTree = BUILT_PRODUCTS_DIR;');
 add('products','PBXGroup',`children = (${id('app-product')},${id('test-product')}); name = Products; sourceTree = "<group>";`);
 add('main','PBXGroup',`children = (${appFiles.map(id).join(',')},${id('assets')},${id('test-file')},${id('mp3')},${id('products')}); sourceTree = "<group>";`);
 for(const [name,files] of [['app-sources',appFiles.map(file=>id('build:'+file))],['test-sources',[id('test-build')]]])add(name,'PBXSourcesBuildPhase',`buildActionMask = 2147483647; files = (${files.join(',')}); runOnlyForDeploymentPostprocessing = 0;`);
 for(const name of ['app-frameworks','test-frameworks'])add(name,'PBXFrameworksBuildPhase','buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;');
 add('app-resources','PBXResourcesBuildPhase',`buildActionMask = 2147483647; files = (${id('assets-build')}); runOnlyForDeploymentPostprocessing = 0;`);
 add('test-resources','PBXResourcesBuildPhase',`buildActionMask = 2147483647; files = (${id('mp3-build')}); runOnlyForDeploymentPostprocessing = 0;`);
 const base='CLANG_ENABLE_MODULES = YES; IPHONEOS_DEPLOYMENT_TARGET = 16.4; SDKROOT = iphoneos; SWIFT_VERSION = 5.0; SWIFT_STRICT_CONCURRENCY = targeted; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; DEBUG_INFORMATION_FORMAT = dwarf; CODE_SIGNING_ALLOWED = NO;';
 add('project-debug','XCBuildConfiguration',`buildSettings = { ${base} }; name = Debug;`);
 add('app-debug','XCBuildConfiguration',`buildSettings = { PRODUCT_NAME = LolzCloud; PRODUCT_MODULE_NAME = LolzCloud; PRODUCT_BUNDLE_IDENTIFIER = com.lolzcloud.ios; INFOPLIST_FILE = ${q(path.join(root,'LolzCloud','Info.plist'))}; GENERATE_INFOPLIST_FILE = NO; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTED_PLATFORMS = "iphonesimulator"; SUPPORTS_MACCATALYST = NO; ENABLE_TESTABILITY = YES; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; }; name = Debug;`);
 add('test-debug','XCBuildConfiguration','buildSettings = { PRODUCT_NAME = LolzCloudRuntimeTests; PRODUCT_BUNDLE_IDENTIFIER = com.lolzcloud.ios.runtime-tests; GENERATE_INFOPLIST_FILE = YES; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTED_PLATFORMS = "iphonesimulator"; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/LolzCloud.app/LolzCloud"; BUNDLE_LOADER = "$(TEST_HOST)"; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @loader_path/Frameworks"; }; name = Debug;');
 for(const name of ['project','app','test'])add(name+'-configs','XCConfigurationList',`buildConfigurations = (${id(name+'-debug')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug;`);
 add('app-target','PBXNativeTarget',`buildConfigurationList = ${id('app-configs')}; buildPhases = (${id('app-sources')},${id('app-frameworks')},${id('app-resources')}); buildRules = (); dependencies = (); name = LolzCloud; productName = LolzCloud; productReference = ${id('app-product')}; productType = "com.apple.product-type.application";`);
 add('proxy','PBXContainerItemProxy',`containerPortal = ${id('project')}; proxyType = 1; remoteGlobalIDString = ${id('app-target')}; remoteInfo = LolzCloud;`);
 add('test-dependency','PBXTargetDependency',`target = ${id('app-target')}; targetProxy = ${id('proxy')};`);
 add('test-target','PBXNativeTarget',`buildConfigurationList = ${id('test-configs')}; buildPhases = (${id('test-sources')},${id('test-frameworks')},${id('test-resources')}); buildRules = (); dependencies = (${id('test-dependency')}); name = LolzCloudRuntimeTests; productName = LolzCloudRuntimeTests; productReference = ${id('test-product')}; productType = "com.apple.product-type.bundle.unit-test";`);
 add('project','PBXProject',`attributes = { BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1600; TargetAttributes = { ${id('test-target')} = { TestTargetID = ${id('app-target')}; }; }; }; buildConfigurationList = ${id('project-configs')}; compatibilityVersion = "Xcode 14.0"; developmentRegion = ru; hasScannedForEncodings = 0; knownRegions = (ru,en,Base); mainGroup = ${id('main')}; productRefGroup = ${id('products')}; projectDirPath = ""; projectRoot = ""; targets = (${id('app-target')},${id('test-target')});`);
 fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,'project.pbxproj'),`// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`);
 const ref=(name,product,blueprint)=>`<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id(name)}" BuildableName="${product}" BlueprintName="${blueprint}" ReferencedContainer="container:LolzCloudRuntime.xcodeproj"/>`;
 const app=ref('app-target','LolzCloud.app','LolzCloud'),test=ref('test-target','LolzCloudRuntimeTests.xctest','LolzCloudRuntimeTests');
 const schemes=path.join(project,'xcshareddata/xcschemes');fs.mkdirSync(schemes,{recursive:true});
 fs.writeFileSync(path.join(schemes,'LolzCloudRuntime.xcscheme'),`<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${app}</BuildActionEntry><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${test}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${test}</TestableReference></Testables><MacroExpansion>${app}</MacroExpansion></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${app}</BuildableProductRunnable></LaunchAction><AnalyzeAction buildConfiguration="Debug"/></Scheme>\n`);
 return {project,scheme:'LolzCloudRuntime',sources:appFiles.map(file=>path.join(root,'LolzCloud',file))};
}
module.exports={generate};
if(require.main===module){if(!process.argv[2])throw Error('Provide an isolated output directory');console.log(JSON.stringify(generate(process.argv[2]),null,2));}
