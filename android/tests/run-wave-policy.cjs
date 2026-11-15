'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {fingerprints}=require('../../source/integrations/wave-history.cjs');
const root=path.resolve(__dirname,'../..'),output=process.env.LOLZCLOUD_WAVE_POLICY_OUTPUT||'D:/LolzCloud-Android-Toolchain/android-wave/policy',classes=path.join(output,'classes');fs.mkdirSync(classes,{recursive:true});
const vectors=[
 {url:'https://soundcloud.com/artist/track',id:123,title:'Song (Official Audio) HD',artist:'Artist'},
 {url:'https://www.soundcloud.com/artist/track/',id:123,title:'Song',artist:'ＡＲＴＩＳＴ'},
 {url:'https://soundcloud.com/артист/трек',id:null,title:'Тестaudioтрек (lyrics)',artist:'Ёлка & ЁЖ'},
 {url:'https://soundcloud.com/a/b',id:9007199254740991,title:'visualizer / HQ lyric Video',artist:'İSTANBUL'},
 {url:'https://soundcloud.com/a/b',id:null,title:'Fullwidth ＡＵＤＩＯ title',artist:'Café'},
 {url:'https://soundcloud.com/a/b',id:234,title:'title_hq other-audio song',artist:'Cafe\u0301'},
 {url:'',id:0,title:'Audio',artist:'Artist'},
 {url:'https://soundcloud.com/a/b',id:'9007199254740992',title:'𝔖𝔬𝔫𝔤',artist:'𝔄𝔯𝔱𝔦𝔰𝔱'},
 {url:'https://soundcloud.com/a/b',id:345,title:'Long ſong official K',artist:'Straße'},
 {url:'',id:null,title:'Яофициальный audio',artist:'Исполнитель 2020'}
];
// Native requests intentionally require canonical ASCII SoundCloud paths, like /music/wave.
for(const row of vectors)if(!/^https:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/[\w-]+\/?$/.test(row.url))row.url='';
const b64=value=>Buffer.from(String(value??''),'utf8').toString('base64');
const file=path.join(output,'pc-wave-vectors.tsv');fs.writeFileSync(file,vectors.map(row=>[b64(row.url),b64(row.id),b64(row.title),b64(row.artist),fingerprints(row).join(',')].join('\t')).join('\n')+'\n');
function run(tool,args){const binary=path.join(process.env.JAVA_HOME||'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot','bin',tool+(process.platform==='win32'?'.exe':'')),result=spawnSync(binary,args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});if(result.error||result.status!==0)throw result.error||Error(result.stdout+result.stderr);return result.stdout;}
run('javac',['--release','8','-encoding','UTF-8','-d',classes,path.join(root,'android/app/src/main/java/com/lolzcloud/mobile/WavePolicy.java'),path.join(__dirname,'WavePolicyTest.java')]);
const report=JSON.parse(run('java',['-cp',classes,'com.lolzcloud.mobile.WavePolicyTest',file]));report.checkedAt=new Date().toISOString();report.scope='Actual production Java policy against PC fingerprint vectors and request/occurrence cancellation rules. HTTP, SharedPreferences, service and audio are separate Android runtime checks.';fs.writeFileSync(path.join(output,'wave-policy-verification.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: '+report.checks.length+' Java/PC Wave policy checks');
