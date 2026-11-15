'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),output=process.env.LOLZCLOUD_LYRICS_OFFLINE_OUTPUT||'D:/LolzCloud-Android-Toolchain/android-lyrics-offline/policy';
const sdk=process.env.LOLZCLOUD_ANDROID_SDK||'D:/LolzCloud-Android-Toolchain/sdk',android=path.join(sdk,'platforms/android-36/android.jar');
const json=process.env.LOLZCLOUD_JSON_JAR||'D:/LolzCloud-Android-Toolchain/lyrics-0.1.4-checks/json-20240303.jar';
const jdk=process.env.JAVA_HOME||'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot',classes=path.join(output,'classes');
fs.mkdirSync(classes,{recursive:true});
function run(tool,args){const result=spawnSync(path.join(jdk,'bin',tool+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2*1024*1024,env:{...process.env,TEMP:output,TMP:output}});if(result.error||result.status!==0)throw result.error||Error(result.stdout+result.stderr);return result.stdout;}
const names=['LyricsMetadata','LrcParser','LyricsProvider','LyricsRepository','OfflineFiles','RoomTransportPolicy'],tests=['LyricsMetadataTest','LrcParserTest','LyricsProviderTest','OfflineFilesTest','RoomTransportPolicyTest'];
if(process.argv.includes('--compile-native')||process.argv.includes('--compile-instrumentation')){
  const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(row=>row.isDirectory()?walk(path.join(directory,row.name)):row.name.endsWith('.java')?[path.join(directory,row.name)]:[]);
  const production=walk(path.join(root,'android/app/src/main/java')),generated=path.join(root,'android/build/generated/com/lolzcloud/mobile/R.java'),nativeClasses=path.join(output,'native-classes');fs.mkdirSync(nativeClasses,{recursive:true});
  run('javac',['--release','8','-encoding','UTF-8','-classpath',android,'-d',nativeClasses,...production,generated]);
  console.log('PASS: '+production.length+' production Java files +generatedR compile; no APK build.');
  run('javac',['--release','8','-encoding','UTF-8','-classpath',[json,android,nativeClasses].join(path.delimiter),'-d',nativeClasses,path.join(__dirname,'RoomAssetsPolicyTest.java')]);process.stdout.write(run('java',['-cp',[json,nativeClasses,android].join(path.delimiter),'com.lolzcloud.mobile.RoomAssetsPolicyTest']));
  if(process.argv.includes('--compile-instrumentation')){const sources=walk(path.join(root,'android/tests/instrumentation/src')),testClasses=path.join(output,'instrumentation-classes');fs.mkdirSync(testClasses,{recursive:true});run('javac',['--release','8','-encoding','UTF-8','-classpath',[android,nativeClasses].join(path.delimiter),'-d',testClasses,...sources]);console.log('PASS: '+sources.length+' instrumentation Java files compile; no test APK build.');}
}
run('javac',['--release','8','-encoding','UTF-8','-classpath',[json,android].join(path.delimiter),'-d',classes,...names.map(name=>path.join(root,'android/app/src/main/java/com/lolzcloud/mobile',name+'.java')),...tests.map(name=>path.join(__dirname,name+'.java'))]);
const checks=[];for(const name of ['LyricsMetadataTest','LrcParserTest','com.lolzcloud.mobile.LyricsProviderTest','OfflineFilesTest','com.lolzcloud.mobile.RoomTransportPolicyTest']){const text=run('java',['-cp',[classes,json,android].join(path.delimiter),name,...(name==='OfflineFilesTest'?[output]:[])]);process.stdout.write(text);const count=Number(text.match(/(\d+) behavior checks passed/)?.[1]);if(!count)throw Error('Missing success count: '+name);checks.push({suite:name,count});}
fs.writeFileSync(path.join(output,'policy.json'),JSON.stringify({status:'passed',createdAt:new Date().toISOString(),checks,total:checks.reduce((n,row)=>n+row.count,0),scope:'Real host Java LRC words/timing/provider-cache policies and real private-fixture file-byte deletion. Android rendering, actual SharedPreferences/MediaPlayer/SAF require later instrumentation.'},null,2)+'\n');
