'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=require('../android/version.json'),host=process.env.LOLZCLOUD_DEPLOY_SSH_HOST||'lolzcloud';if(!/^[\w.-]+$/.test(host))throw Error('Use a configured SSH alias');
const name='LolzCloud-Android-'+version.versionName+'.apk',apk=path.join(root,'android/output',name),bytes=fs.readFileSync(apk);if(bytes.length>150*1024**2)throw Error('APK is too large');
const java=path.join(process.env.JAVA_HOME||'C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot','bin/java.exe'),sdk=process.env.ANDROID_HOME||'D:/LolzCloud-Android-Toolchain/sdk';
function run(file,args,options={}){const r=spawnSync(file,args,{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:1048576,...options});if(r.error||r.status)throw r.error||Error(r.stdout+r.stderr);return r.stdout;}
const signer=run(java,['-jar',path.join(sdk,'build-tools/36.0.0/lib/apksigner.jar'),'verify','--print-certs',apk]);const cert=signer.match(/certificate SHA-256 digest: ([a-f0-9]{64})/)?.[1];if(!cert)throw Error('APK signer was not verified');
const badging=run(path.join(sdk,'build-tools/36.0.0/aapt2.exe'),['dump','badging',apk]),pkg=badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);assert.ok(pkg);assert.equal(pkg[1],'com.lolzcloud.mobile');assert.equal(Number(pkg[2]),version.versionCode);assert.equal(pkg[3],version.versionName);
const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),manifest={versionName:version.versionName,versionCode:version.versionCode,packageName:pkg[1],url:'https://lolzcloud.com/downloads/'+name,size:bytes.length,sha256,certificateSha256:cert,sourceSha256:require('../android/tools/source-digest.cjs').sourceDigest().sha256};
const directory=path.resolve('D:/LolzCloud-Android-Toolchain/android-release-'+version.versionName);fs.mkdirSync(directory,{recursive:true});fs.copyFileSync(apk,path.join(directory,name));fs.writeFileSync(path.join(directory,'android-update.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(directory,name+'.sha256'),sha256+'  '+name+'\n');
const names=[name,name+'.sha256','android-update.json'];const checks=names.map(n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,n))).digest('hex')+'  '+n).join('\n')+'\n';fs.writeFileSync(path.join(directory,'checksums.txt'),checks);
const id=new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-android-'+version.versionName+'-'+crypto.randomBytes(4).toString('hex');
const merge=String.raw`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),d=process.argv[2],names=JSON.parse(process.argv[3]),file=path.join(d,'SHA256SUMS.txt');const old=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split(/\r?\n/):[];const rows=old.filter(l=>{const m=l.match(/^[a-f0-9]{64}\s+\*?(.+)$/i);return m&&!names.includes(m[1]);});for(const n of names){if(path.basename(n)!==n)throw Error('Invalid asset');rows.push(crypto.createHash('sha256').update(fs.readFileSync(path.join(d,n))).digest('hex')+'  '+n);}fs.writeFileSync(file+'.new',rows.join('\n')+'\n',{mode:0o644});fs.renameSync(file+'.new',file);`;
fs.writeFileSync(path.join(directory,'merge.cjs'),merge);
const script=String.raw`#!/bin/sh
set -eu
id='@@ID@@'
link=/srv/lolzcloud/current/downloads
previous=$(readlink -f "$link")
case "$previous" in /srv/lolzcloud/releases/*/downloads) ;; *) exit 1;;esac
test -L "$link"
dest="/srv/lolzcloud/releases/$id/downloads"
uploads="/opt/lolzcloud-server/uploads/$id"
backup="/var/backups/lolzcloud-updates/$id"
test ! -e "$dest"
test ! -e "$previous/@@APK@@"
mkdir -p -m 0755 "/srv/lolzcloud/releases/$id"
mkdir -p -m 0700 "$backup"
printf '%s\n' "$previous" > "$backup/previous-downloads.txt"
cp -al "$previous" "$dest"
for name in '@@APK@@' '@@APK@@.sha256' android-update.json;do install -m 0644 "$uploads/$name" "$dest/$name.next";mv -Tf "$dest/$name.next" "$dest/$name";done
cd "$dest"
sha256sum -c "$uploads/checksums.txt"
/opt/lolzcloud-runtime/node "$uploads/merge.cjs" "$dest" '@@NAMES@@'
test "$(readlink -f "$link")" = "$previous"
complete=0
rollback() {
 if test "$complete" = 0;then ln -s "$previous" "$link.rollback-$id";mv -Tf "$link.rollback-$id" "$link";fi
}
trap rollback EXIT
ln -s "$dest" "$link.next-$id"
mv -Tf "$link.next-$id" "$link"
curl --max-time 20 -fsS https://lolzcloud.com/downloads/android-update.json > "$backup/public.json"
/opt/lolzcloud-runtime/node -e 'const m=require(process.argv[1]);if(m.versionCode!==@@CODE@@||m.sha256!=="@@SHA@@")process.exit(1)' "$backup/public.json"
complete=1
echo "PUBLISHED $id"
`.replaceAll('@@ID@@',id).replaceAll('@@APK@@',name).replaceAll('@@NAMES@@',JSON.stringify(names)).replaceAll('@@CODE@@',String(version.versionCode)).replaceAll('@@SHA@@',sha256);
fs.writeFileSync(path.join(directory,'publish.sh'),script);const receipt={release:id,status:'staged',manifest};fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log('Prepared verified Android update '+version.versionName+' SHA256 '+sha256);
if(process.argv.includes('--deploy')){const jump=require('./deploy-transport.cjs').jumpOptions;const ssh=[...jump,'-o','BatchMode=yes','-o','ConnectTimeout=18','-o','StrictHostKeyChecking=yes',host],remote='/opt/lolzcloud-server/uploads/'+id;run('ssh.exe',[...ssh,'mkdir -p -m 0700 '+remote]);run('scp.exe',[...jump,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',...[...names,'checksums.txt','merge.cjs','publish.sh'].map(file=>path.join(directory,file)),host+':'+remote+'/']);run('ssh.exe',[...ssh,'sh -n '+remote+'/publish.sh']);const output=run('ssh.exe',[...ssh,'sh '+remote+'/publish.sh']);assert.ok(output.includes('PUBLISHED '+id));console.log(output.trim());receipt.status='published';receipt.publishedAt=new Date().toISOString();receipt.backup='/var/backups/lolzcloud-updates/'+id;fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));}
