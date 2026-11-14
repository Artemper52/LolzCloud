'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),host=process.env.LOLZCLOUD_DEPLOY_SSH_HOST||'lolzcloud';
if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(host))throw Error('Use a configured SSH host alias');
const configPath=process.env.LOLZCLOUD_TELEGRAM_CONFIG;
if(!configPath||!path.isAbsolute(configPath))throw Error('Set LOLZCLOUD_TELEGRAM_CONFIG to a private JSON file outside the checkout');
if(path.resolve(configPath).toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('Credentials must stay outside the checkout');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(!/^\d{6,}:[\w-]{30,}$/.test(config.token||''))throw Error('Invalid private bot token');
config.mediaSecret ||= crypto.randomBytes(32).toString('hex');
if(!/^[a-f0-9]{64}$/.test(config.mediaSecret))throw Error('Invalid media secret');
if(config.cacheChat&&!/^(?:-100\d{5,15}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(config.cacheChat))throw Error('Invalid cache channel');
fs.writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});
require('../telegram/index.cjs');
const release=new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-telegram-'+crypto.randomBytes(4).toString('hex');
const base=process.env.LOLZCLOUD_TELEGRAM_STAGE||'D:/LolzCloud-Android-Toolchain/telegram-releases',directory=path.resolve(base,release),stage=path.join(directory,'release');
fs.mkdirSync(stage,{recursive:true});
const names=new Set();
for(const file of Object.keys(require.cache)) {
 const rel=path.relative(root,file).replaceAll('\\','/');if(/^(?:telegram|source)\//.test(rel)&&!rel.includes('/node_modules/'))names.add(rel);
}
for(const name of ['telegram/README.md','telegram/.env.example','telegram/ops/lolzcloud-telegram.service','telegram/ops/nginx-proxy.conf'])names.add(name);
for(const name of names){const dest=path.join(stage,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,name),dest);}
fs.cpSync(path.join(root,'telegram/assets'),path.join(stage,'telegram/assets'),{recursive:true});
// Shared SoundCloud normalization also loads the existing lyric parser. Ship
// its pinned, pure JavaScript dependency and license instead of installing at deploy time.
const xmlPackage=path.dirname(require.resolve('@xmldom/xmldom/package.json'));
fs.cpSync(xmlPackage,path.join(stage,'node_modules/@xmldom/xmldom'),{recursive:true});
function run(file,args,options={}) {const r=spawnSync(file,args,{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,...options});if(r.error||r.status)throw r.error||Error((r.stdout+r.stderr).replace(/\b\d{6,}:[\w-]+/g,'[token]'));if(r.stdout.trim())process.stdout.write(r.stdout);return r.stdout;}
run(process.execPath,['-e','require(process.argv[1])',path.join(stage,'telegram/index.cjs')]);
const archive=path.join(directory,release+'.tar.gz');run('tar.exe',['-czf',archive,'-C',stage,'.']);const sha=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const credentials=path.join(directory,'credentials.env');
fs.writeFileSync(credentials,[`TELEGRAM_BOT_TOKEN=${config.token}`,`TELEGRAM_MEDIA_SECRET=${config.mediaSecret}`,'TELEGRAM_PUBLIC_ORIGIN=https://lolzcloud.com','TELEGRAM_PORT=4388','TELEGRAM_STATE=/var/lib/lolzcloud-telegram','TELEGRAM_FFMPEG=/usr/bin/ffmpeg','TELEGRAM_CACHE_BYTES=2147483648',`TELEGRAM_CACHE_CHAT=${config.cacheChat||''}`,`TELEGRAM_INLINE_ARTICLES=${config.inlineArticles===true?'1':'0'}`,''].join('\n'),{mode:0o600});
if(process.platform==='win32')run('icacls.exe',[credentials,'/inheritance:r','/grant:r',`${process.env.USERNAME}:(F)`,'SYSTEM:(F)']);
const smoke=String.raw`'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.argv[2],{BotState,MediaLinks}=require(path.join(root,'telegram/state.cjs')),{BotCatalog}=require(path.join(root,'telegram/catalog.cjs')),{AudioCache}=require(path.join(root,'telegram/media.cjs')),{TelegramApi}=require(path.join(root,'telegram/api.cjs'));
const env=Object.fromEntries(fs.readFileSync('/etc/lolzcloud-telegram/credentials.env','utf8').trim().split(/\r?\n/).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
(async()=>{const api=new TelegramApi(env.TELEGRAM_BOT_TOKEN),me=await api.call('getMe');assert.equal(me.username,'lolzcloudbot');assert.equal(me.supports_inline_queries,true);const hook=await api.call('getWebhookInfo');assert.equal(hook.url,'');
const state=new BotState('/var/lib/lolzcloud-telegram/telegram-state.json',String(me.id)),catalog=new BotCatalog(state),started=Date.now(),found=await catalog.search('тёмный принц гной');assert.ok(found.tracks.length);assert.equal(found.tracks[0].url,'https://soundcloud.com/darkprinceee/gnoy');const searchMs=Date.now()-started;
const cache=new AudioCache({directory:'/var/lib/lolzcloud-telegram/audio',state,provider:catalog.provider}),before=Date.now(),audio=await cache.prepare(found.tracks[0].id),coldMs=Date.now()-before;state.save();
const warmStart=Date.now(),again=await cache.prepare(audio.track.id);assert.equal(again.cached,true);const warmMs=Date.now()-warmStart;const reopened=new AudioCache({directory:cache.directory,state,provider:catalog.provider});assert.equal((await reopened.prepare(audio.track.id)).cached,true);
const data=fs.readFileSync(audio.file);assert.equal(data.toString('ascii',0,3),'ID3');const links=new MediaLinks('https://lolzcloud.com',env.TELEGRAM_MEDIA_SECRET);
const receipt={status:'passed',generatedAt:new Date().toISOString(),username:me.username,inlineEnabled:me.supports_inline_queries,results:found.tracks.length,searchMs,coldMs,warmMs,track:{id:audio.track.id,title:audio.track.title,artist:audio.track.artist,duration:audio.track.duration,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),audioUrl:links.audio(audio.track.id)},persistentCacheReopen:true};
fs.writeFileSync('/var/lib/lolzcloud-telegram/live-verification.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));cache.close();reopened.close();
})().catch(e=>{console.error(String(e.message||'Live verification failed').replace(/\b\d{6,}:[\w-]+/g,'[token]'));process.exitCode=1;});
`;
const smokeFile=path.join(directory,'live-smoke.cjs');fs.writeFileSync(smokeFile,smoke);
const script=String.raw`#!/bin/sh
set -eu
release='@@RELEASE@@'
root=/opt/lolzcloud-telegram
dest="$root/releases/$release"
backup="/var/backups/lolzcloud-telegram/$release"
test ! -e "$dest"
test -x /usr/bin/ffmpeg
test -x /opt/lolzcloud-runtime/node
printf '%s  %s\n' '@@SHA@@' "$root/uploads/$release.tar.gz" | sha256sum -c -
mkdir -p -m 0700 "$backup" /etc/lolzcloud-telegram
chmod 0700 "$backup" /etc/lolzcloud-telegram
cp /etc/nginx/snippets/lolzcloud-proxy.conf "$backup/main-nginx.conf"
if test -f /etc/nginx/snippets/lolzcloud-telegram-proxy.conf; then cp /etc/nginx/snippets/lolzcloud-telegram-proxy.conf "$backup/bot-nginx.conf"; fi
if test -f /etc/systemd/system/lolzcloud-telegram.service; then cp /etc/systemd/system/lolzcloud-telegram.service "$backup/bot.service"; fi
if test -f /etc/lolzcloud-telegram/credentials.env; then cp /etc/lolzcloud-telegram/credentials.env "$backup/credentials.env"; fi
previous=$(readlink -f "$root/current" || true)
case "$previous" in ''|/opt/lolzcloud-telegram/current|/opt/lolzcloud-telegram/releases/*) ;; *) echo 'Unexpected bot release path';exit 1;; esac
if ! id lolzcloud-telegram >/dev/null 2>&1; then useradd --system --user-group --home-dir /var/lib/lolzcloud-telegram --shell /usr/sbin/nologin lolzcloud-telegram; fi
install -d -o lolzcloud-telegram -g lolzcloud-telegram -m 0700 /var/lib/lolzcloud-telegram
mkdir -p -m 0755 "$dest"
tar -xzf "$root/uploads/$release.tar.gz" --no-same-owner --no-same-permissions -C "$dest"
find "$dest" -type d -exec chmod 0755 {} \;
find "$dest" -type f -exec chmod 0644 {} \;
for file in "$dest"/telegram/*.cjs; do /opt/lolzcloud-runtime/node --check "$file"; done
/opt/lolzcloud-runtime/node -e 'require(process.argv[1])' "$dest/telegram/index.cjs"
complete=0
rollback() {
 if test "$complete" = 0; then
  systemctl stop lolzcloud-telegram || true
  cp "$backup/main-nginx.conf" /etc/nginx/snippets/lolzcloud-proxy.conf
  if test -f "$backup/bot-nginx.conf"; then cp "$backup/bot-nginx.conf" /etc/nginx/snippets/lolzcloud-telegram-proxy.conf; fi
  if test -f "$backup/credentials.env"; then cp "$backup/credentials.env" /etc/lolzcloud-telegram/credentials.env; fi
  if test -f "$backup/bot.service"; then cp "$backup/bot.service" /etc/systemd/system/lolzcloud-telegram.service; fi
  chown -R lolzcloud-telegram:lolzcloud-telegram /var/lib/lolzcloud-telegram
  case "$previous" in /opt/lolzcloud-telegram/releases/*) ln -s "$previous" "$root/current.rollback-$release";mv -Tf "$root/current.rollback-$release" "$root/current";systemctl daemon-reload;systemctl start lolzcloud-telegram || true;; esac
  nginx -t && systemctl reload nginx || true
  echo 'Bot deployment rolled back; rooms service and user data retained.'
 fi
}
trap rollback EXIT
systemctl stop lolzcloud-telegram 2>/dev/null || true
if test -f /var/lib/lolzcloud-telegram/telegram-state.json; then cp /var/lib/lolzcloud-telegram/telegram-state.json "$backup/state.json"; fi
install -m 0600 "$root/uploads/$release.credentials.env" /etc/lolzcloud-telegram/credentials.env
rm "$root/uploads/$release.credentials.env"
/opt/lolzcloud-runtime/node "$root/uploads/$release-smoke.cjs" "$dest"
chown -R lolzcloud-telegram:lolzcloud-telegram /var/lib/lolzcloud-telegram
ln -s "$dest" "$root/current.next-$release"
mv -Tf "$root/current.next-$release" "$root/current"
install -m 0644 "$dest/telegram/ops/lolzcloud-telegram.service" /etc/systemd/system/lolzcloud-telegram.service
install -m 0644 "$dest/telegram/ops/nginx-proxy.conf" /etc/nginx/snippets/lolzcloud-telegram-proxy.conf
if ! grep -Fq 'include /etc/nginx/snippets/lolzcloud-telegram-*.conf;' /etc/nginx/snippets/lolzcloud-proxy.conf; then printf '\ninclude /etc/nginx/snippets/lolzcloud-telegram-*.conf;\n' >> /etc/nginx/snippets/lolzcloud-proxy.conf; fi
nginx -t
systemctl daemon-reload
systemctl enable --now lolzcloud-telegram
for n in 1 2 3 4 5 6 7 8 9 10; do if curl -fsS http://127.0.0.1:4388/telegram/health > "$backup/health.json";then break;fi;sleep 1;done
/opt/lolzcloud-runtime/node -e 'const h=require(process.argv[1]);if(!h.ok||h.bot!=="lolzcloudbot")process.exit(1)' "$backup/health.json"
systemctl reload nginx
for n in 1 2 3 4 5 6 7 8 9 10; do if curl -fsS https://lolzcloud.com/telegram/health > "$backup/public-health.json";then break;fi;sleep 1;done
/opt/lolzcloud-runtime/node -e 'const h=require(process.argv[1]);if(!h.ok||h.bot!=="lolzcloudbot")process.exit(1)' "$backup/public-health.json"
systemctl is-active lolzcloud
complete=1
echo "DEPLOYED $release"
cat "$backup/public-health.json"
` .replaceAll('@@RELEASE@@',release).replaceAll('@@SHA@@',sha);
const scriptFile=path.join(directory,release+'.sh');fs.writeFileSync(scriptFile,script);
const receipt={release,archiveSha256:sha,files:names.size,status:'staged',stage:directory};fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));
console.log('Staged Telegram release: '+directory);
if(process.argv.includes('--deploy')) {
 const ssh=['-o','BatchMode=yes','-o','ConnectTimeout=18','-o','StrictHostKeyChecking=yes',host];
 run('ssh.exe',[...ssh,'mkdir -p -m 0700 /opt/lolzcloud-telegram/uploads; chmod 0700 /opt/lolzcloud-telegram/uploads']);
 for(const [local,remote]of [[archive,release+'.tar.gz'],[credentials,release+'.credentials.env'],[scriptFile,release+'.sh'],[smokeFile,release+'-smoke.cjs']])run('scp.exe',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',local,host+':/opt/lolzcloud-telegram/uploads/'+remote]);
 run('ssh.exe',[...ssh,'sh -n /opt/lolzcloud-telegram/uploads/'+release+'.sh']);
 const output=run('ssh.exe',[...ssh,'sh /opt/lolzcloud-telegram/uploads/'+release+'.sh']);
 if(!output.includes('DEPLOYED '+release))throw Error('Missing deployment receipt');
 receipt.status='deployed';receipt.deployedAt=new Date().toISOString();receipt.backup='/var/backups/lolzcloud-telegram/'+release;
 fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));fs.writeFileSync(path.join(base,'latest-deployment.json'),JSON.stringify(receipt,null,2));
 fs.rmSync(credentials,{force:true});
}
