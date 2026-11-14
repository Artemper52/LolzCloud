'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
if(process.platform!=='darwin')throw Error('Hosted runtime verification requires macOS, Xcode and an installed iOS Simulator runtime.');
const output=path.resolve(process.env.LOLZCLOUD_IOS_RUNTIME_OUTPUT||path.join(process.env.RUNNER_TEMP||require('node:os').tmpdir(),'lolzcloud-ios-runtime-'+Date.now()));
fs.mkdirSync(output,{recursive:true});
const report={status:'failed',checkedAt:new Date().toISOString(),scope:'Hosted XCTest on a fresh disposable iOS Simulator. No physical-device, external Document Provider, signing or personal-account verification.',version:require('./version.cjs').version(),commit:process.env.GITHUB_SHA||null};
let device;
function run(file,args,options={}){const r=spawnSync(file,args,{encoding:'utf8',timeout:900000,maxBuffer:8*1024*1024,...options});if(r.error||r.status)throw r.error||Error(file+' exited '+r.status+': '+(r.stderr||''));return r.stdout||'';}
try{
 report.commit=run('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..')}).trim();
 const {project,scheme,sources}=require('./runtime-project.cjs').generate(output);
 report.sourceHashes=Object.fromEntries(sources.map(file=>[path.basename(file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 const runtimes=JSON.parse(run('xcrun',['simctl','list','runtimes','available','--json'])).runtimes.filter(r=>r.isAvailable&&r.identifier.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-')).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
 if(!runtimes.length)throw Error('No installed available iOS Simulator runtime.');
 const types=JSON.parse(run('xcrun',['simctl','list','devicetypes','--json'])).devicetypes;
 const type=types.find(t=>t.identifier==='com.apple.CoreSimulator.SimDeviceType.iPhone-16')||types.find(t=>t.name==='iPhone 16 Pro')||types.filter(t=>t.name.startsWith('iPhone')).at(-1);
 if(!type)throw Error('No compatible iPhone simulator device type.');
 const created=run('xcrun',['simctl','create','LolzCloud-runtime-'+Date.now(),type.identifier,runtimes[0].identifier]).trim();
 if(!/^[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}$/.test(created))throw Error('Unexpected simulator UUID.');
 device=created;
 report.simulator={uuid:device,device:type.name,runtime:runtimes[0].name,version:runtimes[0].version};
 run('xcrun',['simctl','boot',device]);run('xcrun',['simctl','bootstatus',device,'-b'],{stdio:'inherit'});
 const result=path.join(output,'NativeRuntime.xcresult');report.xcresult=result;
 run('xcodebuild',['-project',project,'-scheme',scheme,'-configuration','Debug','-sdk','iphonesimulator','-destination','id='+device,'-derivedDataPath',path.join(output,'derived'),'-resultBundlePath',result,'-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','CODE_SIGNING_ALLOWED=NO','test'],{stdio:'inherit'});
 report.status='passed';
 try{report.tests=JSON.parse(run('xcrun',['xcresulttool','get','test-results','summary','--path',result]));}catch(error){report.summaryError=error.message;}
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 if(device){try{run('xcrun',['simctl','shutdown',device]);}catch{}try{run('xcrun',['simctl','delete',device]);}catch{}}
 fs.writeFileSync(path.join(output,'runtime-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
