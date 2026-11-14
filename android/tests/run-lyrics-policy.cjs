'use strict';
// Host-only checks. org.json is Android's built-in runtime library; this external jar is used only by host tests.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),checkDir=process.env.LOLZCLOUD_LYRICS_CHECK_DIR||'D:/LolzCloud-Android-Toolchain/lyrics-0.1.4-checks';
const sdk=process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk',jdk=process.env.JAVA_HOME||'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot';
const androidJar=path.join(sdk,'platforms/android-36/android.jar'),jsonJar=process.env.LOLZCLOUD_JSON_JAR||path.join(checkDir,'json-20240303.jar');
if(!fs.existsSync(jsonJar))throw new Error('Host tests need org.json only: https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar → '+jsonJar);
const classes=path.join(checkDir,'classes');fs.mkdirSync(classes,{recursive:true});
function run(tool,args){const result=spawnSync(path.join(jdk,'bin',tool+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2*1024*1024});if(result.error||result.status)throw result.error||new Error(result.stdout+result.stderr);return result.stdout;}
const cp=[classes,jsonJar,androidJar].join(path.delimiter),sources=['LyricsMetadata','LrcParser','LyricsProvider','LyricsRepository'].map(name=>path.join(repo,'android/app/src/main/java/com/lolzcloud/mobile',name+'.java'));
sources.push(...['LyricsMetadataTest','LrcParserTest','LyricsProviderTest'].map(name=>path.join(__dirname,name+'.java')));
const argsFile=path.join(checkDir,'host.args');fs.writeFileSync(argsFile,['-encoding UTF-8','-source 8','-target 8','-classpath "'+[jsonJar,androidJar].map(p=>p.replaceAll('\\','/')).join(path.delimiter)+'"','-d "'+classes.replaceAll('\\','/')+'"',...sources.map(p=>'"'+p.replaceAll('\\','/')+'"')].join('\n'));
run('javac',['@'+argsFile]);
const live=process.argv.includes('--live'),checks=[];
for(const name of ['LyricsMetadataTest','LrcParserTest','com.lolzcloud.mobile.LyricsProviderTest']){const output=run('java',['-cp',cp,name,...(live&&name.includes('Provider')?['--live']:[])]);process.stdout.write(output);const count=Number(output.match(/(\d+) behavior checks passed/)?.[1]);if(!count)throw new Error('Missing test result: '+name);checks.push({suite:name,count,passed:true});}
const report={status:'passed',generatedAt:new Date().toISOString(),checks,total:checks.reduce((n,row)=>n+row.count,0),livePublicHttps:live,scope:'Host metadata matching, genuine LRC timing, bounded declared API fixtures; optional live public metadata-only lookup. No commercial source text printed, no account login, no Android device.'};
fs.writeFileSync(path.join(repo,'android/output/android-lyrics-policy-verification.json'),JSON.stringify(report,null,2)+'\n');
