'use strict';
// Publish verified modern artifacts to the existing official update mirror.
// All downloads are prepared in a sibling snapshot; one symlink commits the channel.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,host=process.env.LOLZCLOUD_DEPLOY_SSH_HOST||'lolzcloud';
if(!/^[\w.-]+$/.test(host)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release configuration');
const directory=path.resolve(process.env.LOLZCLOUD_UPDATE_DIRECTORY||'D:/LolzCloud-Android-Toolchain/update-mirror-'+version),installers=path.resolve(process.env.LOLZCLOUD_UPDATE_INSTALLERS||path.join(root,'dist/installers'));fs.mkdirSync(directory,{recursive:true});
function run(file,args,options={}){const r=spawnSync(file,args,{windowsHide:true,encoding:'utf8',timeout:240000,maxBuffer:1048576,...options});if(r.error||r.status)throw r.error||Error(r.stdout+r.stderr);if(r.stdout.trim())process.stdout.write(r.stdout);return r.stdout;}
const sha=(file,algorithm='sha256',encoding='hex')=>crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
const archive=`LolzCloud-${version}-win-x64.zip`,setup=`LolzCloud-${version}-win-x64-Setup.exe`,blockmap=setup+'.blockmap';
for(const name of [setup,blockmap,'latest.yml'])fs.copyFileSync(path.join(installers,name),path.join(directory,name));
assert.ok(fs.statSync(path.join(directory,archive)).size>1000000,'Prepare the full portable ZIP first');
const yaml=fs.readFileSync(path.join(directory,'latest.yml'),'utf8');assert.ok(yaml.includes('version: '+version));assert.ok(yaml.includes(sha(path.join(directory,setup),'sha512','base64')));
const manifest={version,tag:'v'+version,channel:'latest'};
for(const [kind,name]of [['archive',archive],['setup',setup]])manifest[kind]={name,url:'https://lolzcloud.com/downloads/'+name,size:fs.statSync(path.join(directory,name)).size,sha256:sha(path.join(directory,name))};
require('../source/integrations/app-updates.cjs').validateManifest(manifest);
fs.writeFileSync(path.join(directory,'update.json'),JSON.stringify(manifest,null,2)+'\n');
const names=[archive,setup,blockmap,'latest.yml','update.json'];
fs.writeFileSync(path.join(directory,'promote-checksums.txt'),names.map(n=>sha(path.join(directory,n))+'  '+n).join('\n')+'\n');
const release=new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-updates-'+version+'-'+crypto.randomBytes(4).toString('hex');
const merge=String.raw`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const d=process.argv[2],names=JSON.parse(process.argv[3]);const file=path.join(d,'SHA256SUMS.txt');const lines=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split(/\r?\n/):[];const keep=lines.filter(line=>{const m=line.match(/^[a-f0-9]{64}\s+\*?(.+)$/i);return m&&!names.includes(m[1]);});for(const n of names){if(path.basename(n)!==n)throw Error('Invalid asset');keep.push(crypto.createHash('sha256').update(fs.readFileSync(path.join(d,n))).digest('hex')+'  '+n);}fs.writeFileSync(file+'.new',keep.join('\n')+'\n',{mode:0o644});fs.renameSync(file+'.new',file);`;
const mergeFile=path.join(directory,'merge-checksums.cjs');fs.writeFileSync(mergeFile,merge);
const script=String.raw`#!/bin/sh
set -eu
id='@@ID@@'
base=/srv/lolzcloud
link="$base/current/downloads"
previous=$(readlink -f "$link")
case "$previous" in /srv/lolzcloud/releases/*/downloads) ;; *) echo 'Unexpected downloads path';exit 1;;esac
test -L "$link"
uploads="/opt/lolzcloud-server/uploads/$id"
dest="$base/releases/$id/downloads"
backup="/var/backups/lolzcloud-updates/$id"
test ! -e "$dest"
mkdir -p -m 0755 "$base/releases/$id"
cp -al "$previous" "$dest"
mkdir -p -m 0700 "$backup"
printf '%s\n' "$previous" > "$backup/previous-downloads.txt"
for name in update.json latest.yml SHA256SUMS.txt;do test ! -f "$previous/$name" || cp "$previous/$name" "$backup/$name";done
test ! -e "$dest/@@SETUP@@"
for name in '@@SETUP@@' '@@ZIP@@' '@@BLOCKMAP@@' latest.yml update.json;do install -m 0644 "$uploads/$name" "$dest/$name.next";mv -Tf "$dest/$name.next" "$dest/$name";done
cd "$dest"
sha256sum -c "$uploads/promote-checksums.txt"
/opt/lolzcloud-runtime/node "$uploads/merge-checksums.cjs" "$dest" '@@NAMES@@'
complete=0
rollback() {
 if test "$complete" = 0;then
  ln -s "$previous" "$link.rollback-$id"
  mv -Tf "$link.rollback-$id" "$link"
  echo 'Previous update mirror restored'
 fi
}
trap rollback EXIT
ln -s "$dest" "$link.next-$id"
mv -Tf "$link.next-$id" "$link"
for n in 1 2 3 4 5;do curl -fsS --max-time 15 https://lolzcloud.com/downloads/update.json > "$backup/public.json";if /opt/lolzcloud-runtime/node -e 'if(require(process.argv[1]).version!=="@@VERSION@@")process.exit(1)' "$backup/public.json";then break;fi;sleep 1;done
/opt/lolzcloud-runtime/node -e 'if(require(process.argv[1]).version!=="@@VERSION@@")process.exit(1)' "$backup/public.json"
complete=1
echo "PROMOTED $id"
`.replaceAll('@@ID@@',release).replaceAll('@@SETUP@@',setup).replaceAll('@@SETUPSHA@@',manifest.setup.sha256).replaceAll('@@ZIP@@',archive).replaceAll('@@BLOCKMAP@@',blockmap).replaceAll('@@VERSION@@',version).replaceAll('@@NAMES@@',JSON.stringify(names));
const scriptFile=path.join(directory,'promote.sh');fs.writeFileSync(scriptFile,script);
const receipt={release,version,manifest,files:names,status:'staged'};fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));
console.log('Prepared Windows update mirror '+version);
if(process.argv.includes('--deploy')){
 const jump=require('./deploy-transport.cjs').jumpOptions;
 const ssh=[...jump,'-o','BatchMode=yes','-o','ConnectTimeout=18','-o','StrictHostKeyChecking=yes',host],remote='/opt/lolzcloud-server/uploads/'+release;
 run('ssh.exe',[...ssh,'mkdir -p -m 0700 '+remote]);
 run('scp.exe',[...jump,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',...[setup,archive,blockmap,'latest.yml','update.json','promote-checksums.txt','merge-checksums.cjs','promote.sh'].map(name=>path.join(directory,name)),host+':'+remote+'/']);
 run('ssh.exe',[...ssh,'sh -n '+remote+'/promote.sh']);const output=run('ssh.exe',[...ssh,'sh '+remote+'/promote.sh']);assert.ok(output.includes('PROMOTED '+release));
 receipt.status='published';receipt.publishedAt=new Date().toISOString();receipt.backup='/var/backups/lolzcloud-updates/'+release;fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));
}
