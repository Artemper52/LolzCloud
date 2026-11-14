'use strict';
// GitHub can mirror the exact device-tested APK without receiving the local
// signing key. Source identity, APK bytes and the update certificate must agree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
async function main(){
 require('../android/tools/sync-room-assets.cjs').syncRoomAssets();
 const source=require('../android/tools/source-digest.cjs').sourceDigest(),version=require('../android/version.json');
 const manifestResponse=await fetch('https://lolzcloud.com/downloads/android-update.json',{redirect:'error',signal:AbortSignal.timeout(20000)});if(!manifestResponse.ok)throw Error('Published Android manifest is unavailable');
 const text=await manifestResponse.text();if(text.length>20000)throw Error('Android manifest is too large');const manifest=JSON.parse(text);
 const name=`LolzCloud-Android-${version.versionName}.apk`,expectedCertificate='84305e6af2473179b6e124a1822eb82c0343e9bba0b5480cd5a91ecc0dceaa44';
 if(manifest.versionName!==version.versionName||manifest.versionCode!==version.versionCode||manifest.packageName!=='com.lolzcloud.mobile'||manifest.sourceSha256!==source.sha256||manifest.certificateSha256!==expectedCertificate||manifest.url!=='https://lolzcloud.com/downloads/'+name||!Number.isSafeInteger(manifest.size)||manifest.size<100000||manifest.size>40000000||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('The published APK does not match this source/signing identity; publish and verify Android first');
 const response=await fetch(manifest.url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Published APK is unavailable');
 let length=0;const chunks=[];for await(const chunk of response.body){length+=chunk.length;if(length>manifest.size)throw Error('Unexpected Android APK size');chunks.push(Buffer.from(chunk));}const bytes=Buffer.concat(chunks);
 if(length!==manifest.size||crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('Published APK integrity mismatch');
 const output=path.resolve(process.env.LOLZCLOUD_ANDROID_MIRROR_OUTPUT||'dist/github-android');fs.mkdirSync(output,{recursive:true});const file=path.join(output,name);fs.writeFileSync(file,bytes);
 const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;if(!sdk)throw Error('Set ANDROID_HOME to verify the Android signing certificate');
 const folders=fs.readdirSync(path.join(sdk,'build-tools')).filter(name=>/^\d+\.\d+\.\d+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
 const signer=folders.map(folder=>path.join(sdk,'build-tools',folder,'lib/apksigner.jar')).find(file=>fs.existsSync(file));if(!signer)throw Error('Google apksigner was not found');
 const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin','java'+(process.platform==='win32'?'.exe':'')):'java';
 const checked=spawnSync(java,['-jar',signer,'verify','--print-certs',file],{encoding:'utf8',windowsHide:true,timeout:30000});if(checked.error||checked.status!==0||!checked.stdout.includes('certificate SHA-256 digest: '+expectedCertificate))throw Error('Android certificate verification failed');
 fs.writeFileSync(path.join(output,'android-update.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(file+'.sha256',manifest.sha256+'  '+name+'\n');
 console.log('Verified published Android '+version.versionName+': exact source, bytes and update certificate');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
