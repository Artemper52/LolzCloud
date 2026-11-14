'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function version(value){const match=/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value||'');return match?match.slice(1).map(part=>Number(part||0)):null;}
function compare(a,b){for(let i=0;i<3;i++){const delta=a[i]-b[i];if(delta)return delta;}return 0;}
function candidates(names,minimum=26){return names.map(name=>{const match=/^Xcode_(\d+(?:\.\d+){0,2})\.app$/.exec(name);return match?{name,version:version(match[1])}:null;}).filter(row=>row&&row.version[0]>=minimum).sort((a,b)=>compare(b.version,a.version));}
function select({directory='/Applications',env=process.env,execute=execFileSync}={}){
 if(process.platform!=='darwin')throw Error('Xcode selection must run on the macOS builder.');
 const choices=candidates(fs.readdirSync(directory));if(!choices.length)throw Error('No installed stable Xcode 26 or newer. Use a current macOS runner image.');
 const selected=path.join(directory,choices[0].name,'Contents/Developer'),scoped={...env,DEVELOPER_DIR:selected};
 const read=args=>execute('/usr/bin/xcodebuild',args,{encoding:'utf8',env:scoped,timeout:60000}).trim();
 const description=read(['-version']),match=/^Xcode (\d+(?:\.\d+){0,2})$/m.exec(description);
 if(!match||version(match[1])[0]<26)throw Error('Selected Xcode does not meet the current App Store Connect minimum.');
 const deviceSDK=read(['-sdk','iphoneos','-show-sdk-version']),simulatorSDK=read(['-sdk','iphonesimulator','-show-sdk-version']);
 if(!version(deviceSDK)||version(deviceSDK)[0]<26||!version(simulatorSDK)||version(simulatorSDK)[0]<26)throw Error('Both Apple SDKs must be version 26 or newer.');
 if(env.GITHUB_ENV)fs.appendFileSync(env.GITHUB_ENV,'DEVELOPER_DIR='+selected+'\n');
 const report={developerDirectory:selected,xcode:match[1],deviceSDK,simulatorSDK,minimumDeployment:'16.4'};
 console.log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)select();
module.exports={version,compare,candidates};
