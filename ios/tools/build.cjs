'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
if(process.platform!=='darwin')throw Error('The native iPhone/iPad build requires macOS with Xcode. Install the web application at https://lolzcloud.com/app/ on iOS, or use the iPhone and iPad GitHub Actions workflow.');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.env.LOLZCLOUD_IOS_OUTPUT||path.join(root,'output'));
const version=require('./version.cjs').version();
function run(file,args){const r=spawnSync(file,args,{cwd:root,stdio:'inherit',timeout:1200000});if(r.error||r.status)throw r.error||Error(file+' failed: '+r.status);}
require('./project.cjs');run('swift',['test','--package-path',root]);fs.mkdirSync(output,{recursive:true});
const archive=path.join(output,'LolzCloud.xcarchive'),simulator=path.join(output,'simulator');
run('xcodebuild',['-project',path.join(root,'LolzCloud.xcodeproj'),'-scheme','LolzCloud','-configuration','Debug','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',simulator,'CODE_SIGNING_ALLOWED=NO','build']);
run('xcodebuild',['-project',path.join(root,'LolzCloud.xcodeproj'),'-scheme','LolzCloud','-configuration','Release','-destination','generic/platform=iOS','-archivePath',archive,'CODE_SIGNING_ALLOWED=NO','archive']);
const payload=path.join(output,'Payload');if(fs.existsSync(payload))throw Error('Choose a fresh iOS output directory.');fs.mkdirSync(payload);
fs.cpSync(path.join(archive,'Products/Applications/LolzCloud.app'),path.join(payload,'LolzCloud.app'),{recursive:true});
run('ditto',['-c','-k','--sequesterRsrc','--keepParent',payload,path.join(output,`LolzCloud-iOS-${version}-unsigned.ipa`)]);
run('ditto',['-c','-k','--sequesterRsrc','--keepParent',path.join(simulator,'Build/Products/Debug-iphonesimulator/LolzCloud.app'),path.join(output,`LolzCloud-iOS-${version}-simulator.zip`)]);
console.log('Compiled iPhone/iPad builds: '+output+' (device IPA requires the recipient’s Apple signing).');
