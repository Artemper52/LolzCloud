'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),host=process.env.LOLZCLOUD_DEPLOY_SSH_HOST||'lolzcloud';if(!/^[\w.-]+$/.test(host))throw Error('Use a configured SSH alias');
const privateFile=process.env.LOLZCLOUD_MUSIC_CONFIG||'D:/LolzCloud-Android-Toolchain/private/music-service.json';
if(path.resolve(privateFile).toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('Keep credentials outside the checkout');
fs.mkdirSync(path.dirname(privateFile),{recursive:true});let config=fs.existsSync(privateFile)?JSON.parse(fs.readFileSync(privateFile,'utf8')):{secret:crypto.randomBytes(32).toString('hex')};if(!/^[a-f0-9]{64}$/.test(config.secret||''))throw Error('Invalid music media secret');fs.writeFileSync(privateFile,JSON.stringify(config),{mode:0o600});
function run(file,args,options={}){const r=spawnSync(file,args,{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:1048576,...options});if(r.error||r.status)throw r.error||Error(r.stdout+r.stderr);if(r.stdout.trim())process.stdout.write(r.stdout);return r.stdout;}
require('../music/index.cjs');
const id=new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-music-'+crypto.randomBytes(4).toString('hex'),base='D:/LolzCloud-Android-Toolchain/music-releases',directory=path.join(base,id),stage=path.join(directory,'release');fs.mkdirSync(stage,{recursive:true});
for(const file of Object.keys(require.cache)){const name=path.relative(root,file).replaceAll('\\','/');if(!/^(music|telegram|source)\//.test(name)||name.includes('/node_modules/'))continue;const target=path.join(stage,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
for(const folder of ['music/ops','telegram/assets'])fs.cpSync(path.join(root,folder),path.join(stage,folder),{recursive:true});fs.copyFileSync(path.join(root,'music/README.md'),path.join(stage,'music/README.md'));
fs.cpSync(path.dirname(require.resolve('@xmldom/xmldom/package.json')),path.join(stage,'node_modules/@xmldom/xmldom'),{recursive:true});
run(process.execPath,['-e','require(process.argv[1])',path.join(stage,'music/index.cjs')]);
const archive=path.join(directory,id+'.tar.gz');run('tar.exe',['-czf',archive,'-C',stage,'.']);const digest=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const envFile=path.join(directory,id+'.env');fs.writeFileSync(envFile,`LOLZCLOUD_MUSIC_SECRET=${config.secret}\nLOLZCLOUD_MUSIC_STATE=/var/lib/lolzcloud-music\nLOLZCLOUD_MUSIC_PORT=4389\n`,{mode:0o600});
if(process.platform==='win32')for(const file of [privateFile,envFile])run('icacls.exe',[file,'/inheritance:r','/grant:r',`${process.env.USERNAME}:(F)`,'SYSTEM:(F)']);
const smoke=String.raw`const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');const root=process.argv[2];const {BotState,MediaLinks}=require(path.join(root,'telegram/state.cjs')),{BotCatalog}=require(path.join(root,'telegram/catalog.cjs')),{AudioCache}=require(path.join(root,'telegram/media.cjs'));const env=Object.fromEntries(fs.readFileSync('/etc/lolzcloud-music/credentials.env','utf8').trim().split(/\r?\n/).map(l=>{const at=l.indexOf('=');return[l.slice(0,at),l.slice(at+1)];}));(async()=>{const state=new BotState('/var/lib/lolzcloud-music/music-state.json','lolzcloud-public-music-v1'),catalog=new BotCatalog(state),links=new MediaLinks('https://lolzcloud.com',env.LOLZCLOUD_MUSIC_SECRET,{prefix:'/music'}),found=await catalog.search('тёмный принц гной');assert.ok(found.tracks.length);const cache=new AudioCache({directory:'/var/lib/lolzcloud-music/audio',state,provider:catalog.provider}),at=Date.now(),audio=await cache.prepare(found.tracks[0].id),coldMs=Date.now()-at,bytes=fs.readFileSync(audio.file);assert.equal(bytes.toString('ascii',0,3),'ID3');assert.equal((await cache.prepare(audio.track.id)).cached,true);state.save();const receipt={status:'passed',results:found.tracks.length,coldMs,track:{id:audio.track.id,title:audio.track.title,artist:audio.track.artist,duration:audio.track.duration,audioUrl:links.audio(audio.track.id),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};fs.writeFileSync('/var/lib/lolzcloud-music/live-verification.json',JSON.stringify(receipt));console.log(JSON.stringify(receipt));cache.close();})().catch(()=>{console.error('Music source verification failed');process.exitCode=1;});`;
const smokeFile=path.join(directory,id+'-smoke.cjs');fs.writeFileSync(smokeFile,smoke);
const script=String.raw`#!/bin/sh
set -eu
id='@@ID@@'
root=/opt/lolzcloud-music
dest="$root/releases/$id"
backup="/var/backups/lolzcloud-music/$id"
test -x /usr/bin/ffmpeg
test ! -e "$dest"
mkdir -p -m 0700 "$backup" /etc/lolzcloud-music
chmod 0700 "$backup" /etc/lolzcloud-music
cp /etc/nginx/snippets/lolzcloud-proxy.conf "$backup/main-nginx.conf"
if test -f /etc/lolzcloud-music/credentials.env;then cp /etc/lolzcloud-music/credentials.env "$backup/credentials.env";fi
previous=$(readlink -f "$root/current" || true)
case "$previous" in ''|/opt/lolzcloud-music/current|/opt/lolzcloud-music/releases/*) ;; *) exit 1;;esac
if ! id lolzcloud-music >/dev/null 2>&1;then useradd --system --user-group --home-dir /var/lib/lolzcloud-music --shell /usr/sbin/nologin lolzcloud-music;fi
install -d -o lolzcloud-music -g lolzcloud-music -m 0700 /var/lib/lolzcloud-music
printf '%s  %s\n' '@@SHA@@' "$root/uploads/$id.tar.gz" | sha256sum -c -
mkdir -p -m 0755 "$dest"
tar -xzf "$root/uploads/$id.tar.gz" --no-same-owner --no-same-permissions -C "$dest"
find "$dest" -type d -exec chmod 0755 {} \;
find "$dest" -type f -exec chmod 0644 {} \;
/opt/lolzcloud-runtime/node -e 'require(process.argv[1])' "$dest/music/index.cjs"
complete=0
rollback() {
 if test "$complete" = 0;then
  systemctl stop lolzcloud-music || true
  cp "$backup/main-nginx.conf" /etc/nginx/snippets/lolzcloud-proxy.conf
  if test -f "$backup/credentials.env";then cp "$backup/credentials.env" /etc/lolzcloud-music/credentials.env;fi
  chown -R lolzcloud-music:lolzcloud-music /var/lib/lolzcloud-music
  case "$previous" in /opt/lolzcloud-music/releases/*) ln -s "$previous" "$root/current.rollback-$id";mv -Tf "$root/current.rollback-$id" "$root/current";systemctl restart lolzcloud-music || true;;esac
  nginx -t && systemctl reload nginx || true
 fi
}
trap rollback EXIT
systemctl stop lolzcloud-music 2>/dev/null || true
test ! -f /var/lib/lolzcloud-music/music-state.json || cp /var/lib/lolzcloud-music/music-state.json "$backup/state.json"
install -m 0600 "$root/uploads/$id.env" /etc/lolzcloud-music/credentials.env
rm "$root/uploads/$id.env"
/opt/lolzcloud-runtime/node "$root/uploads/$id-smoke.cjs" "$dest"
chown -R lolzcloud-music:lolzcloud-music /var/lib/lolzcloud-music
ln -s "$dest" "$root/current.next-$id"
mv -Tf "$root/current.next-$id" "$root/current"
install -m 0644 "$dest/music/ops/lolzcloud-music.service" /etc/systemd/system/lolzcloud-music.service
install -m 0644 "$dest/music/ops/nginx-proxy.conf" /etc/nginx/snippets/lolzcloud-music-proxy.conf
if ! grep -Fq 'include /etc/nginx/snippets/lolzcloud-music-*.conf;' /etc/nginx/snippets/lolzcloud-proxy.conf;then printf '\ninclude /etc/nginx/snippets/lolzcloud-music-*.conf;\n' >> /etc/nginx/snippets/lolzcloud-proxy.conf;fi
nginx -t
systemctl daemon-reload
systemctl enable --now lolzcloud-music
for n in 1 2 3 4 5 6 7 8 9 10;do if curl -fsS http://127.0.0.1:4389/music/health;then break;fi;sleep 1;done
systemctl reload nginx
for n in 1 2 3 4 5 6 7 8 9 10;do
 if curl --max-time 8 -fsS https://lolzcloud.com/music/health > "$backup/public-health.json";then break;fi
 sleep 1
done
/opt/lolzcloud-runtime/node -e 'const h=require(process.argv[1]);if(!h.ok||h.protocol!==1)process.exit(1)' "$backup/public-health.json"
complete=1
echo "DEPLOYED $id"
`.replaceAll('@@ID@@',id).replaceAll('@@SHA@@',digest);
const scriptFile=path.join(directory,id+'.sh');fs.writeFileSync(scriptFile,script);const receipt={release:id,archiveSha256:digest,status:'staged'};fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log('Staged independent music service');
if(process.argv.includes('--deploy')){const jump=require('./deploy-transport.cjs').jumpOptions;const ssh=[...jump,'-o','BatchMode=yes','-o','ConnectTimeout=18','-o','StrictHostKeyChecking=yes',host];run('ssh.exe',[...ssh,'mkdir -p -m 0700 /opt/lolzcloud-music/uploads']);run('scp.exe',[...jump,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',archive,envFile,smokeFile,scriptFile,host+':/opt/lolzcloud-music/uploads/']);run('ssh.exe',[...ssh,'sh -n /opt/lolzcloud-music/uploads/'+id+'.sh']);const output=run('ssh.exe',[...ssh,'sh /opt/lolzcloud-music/uploads/'+id+'.sh']);if(!output.includes('DEPLOYED '+id))throw Error('Missing music deployment receipt');receipt.status='deployed';receipt.deployedAt=new Date().toISOString();receipt.backup='/var/backups/lolzcloud-music/'+id;fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));fs.writeFileSync(path.join(base,'latest-deployment.json'),JSON.stringify(receipt,null,2));fs.rmSync(envFile);}
