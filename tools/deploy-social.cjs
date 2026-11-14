'use strict';
// Stage a reviewable release, retain server-side backups, switch only after smoke checks.
// No provider credentials or session files leave the server.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), version = require('../server/package.json').version;
const sshHost = process.env.LOLZCLOUD_DEPLOY_SSH_HOST || 'lolzcloud';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(sshHost)) throw Error('Use a configured SSH host alias');
const release = '20261114-social-' + version + '-' + crypto.randomBytes(4).toString('hex');
if (!/^20261114-social-\d+\.\d+\.\d+-[a-f0-9]{8}$/.test(release)) throw Error('Invalid release');
const base = 'D:/LolzCloud-Android-Toolchain/server-releases', directory = path.join(base, release), stage = path.join(directory, 'server');
fs.mkdirSync(stage, { recursive: true });
for (const name of ['core.cjs', 'index.cjs', 'social.cjs', 'room-engine.cjs', 'player-services.cjs', 'catalog.cjs', 'soundcloud-client.cjs', 'package.json', 'README.md', '.env.example']) fs.copyFileSync(path.join(root, 'server', name), path.join(stage, name));
for (const folder of ['public', 'ops']) fs.cpSync(path.join(root, 'server', folder), path.join(stage, folder), { recursive: true });
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.error || result.status) throw result.error || Error(result.stdout + result.stderr);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  return result.stdout;
}
const archive = path.join(directory, release + '.tar.gz');
run('tar.exe', ['-czf', archive, '-C', stage, '.']);
const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const smoke = String.raw`'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const dir=process.argv[2],{createServer}=require(path.join(dir,'index.cjs')),{CloudStore}=require(path.join(dir,'core.cjs'));
const server=createServer({store:new CloudStore(),clientId:''});
server.listen(0,'127.0.0.1',async()=>{try{const origin='http://127.0.0.1:'+server.address().port;
const health=await(await fetch(origin+'/api/health')).json();assert.equal(health.socialProtocol,1);assert.equal(health.version,'@@VERSION@@');
const social=await fetch(origin+'/social?tab=notifications',{redirect:'manual'});assert.equal(social.status,303);assert.match(social.headers.get('location'),/^\/login\?next=/);
for(const file of ['social.js','social.css']){const response=await fetch(origin+'/cloud/'+file);assert.equal(response.status,200);assert.ok((await response.text()).length>100);}
const page=await fetch(origin+'/app/');assert.equal(page.status,200);assert.ok((await page.text()).includes('imports.js'));
for(const file of ['core.js','offline.js','imports.js','app.js','sw.js']){const response=await fetch(origin+'/app/'+file);assert.equal(response.status,200);assert.ok((await response.text()).length>100);}
assert.equal((await fetch(origin+'/api/social/me')).status,401);console.log('Staged social smoke PASS');
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();server.close();}});
`.replaceAll('@@VERSION@@', version);
const smokeFile = path.join(directory, release + '-smoke.cjs'); fs.writeFileSync(smokeFile, smoke);
const script = String.raw`#!/bin/sh
set -eu
release='@@RELEASE@@'
root=/opt/lolzcloud-server
dest="$root/releases/$release"
backup="/var/backups/lolzcloud/$release"
archive="$root/uploads/$release.tar.gz"
test ! -e "$dest"
test -x /opt/lolzcloud-runtime/node
test -d /var/lib/lolzcloud
previous=$(readlink -f "$root/current")
case "$previous" in /opt/lolzcloud-server/releases/*) ;; *) echo 'Unexpected current release'; exit 1;; esac
printf '%s  %s\n' '@@SHA@@' "$archive" | sha256sum -c -
mkdir -m 0755 "$dest"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$dest"
find "$dest" -type d -exec chmod 0755 {} \;
find "$dest" -type f -exec chmod 0644 {} \;
for file in "$dest"/*.cjs; do /opt/lolzcloud-runtime/node --check "$file"; done
/opt/lolzcloud-runtime/node "$root/uploads/$release-smoke.cjs" "$dest"
mkdir -p -m 0700 "$backup"
chmod 0700 "$backup"
cp /etc/nginx/snippets/lolzcloud-proxy.conf "$backup/nginx-proxy.conf"
printf '%s\n' "$previous" > "$backup/previous-release.txt"
complete=0
rollback() {
  if test "$complete" = 0; then
    ln -s "$previous" "$root/current.rollback-$release"
    mv -Tf "$root/current.rollback-$release" "$root/current"
    cp "$backup/nginx-proxy.conf" /etc/nginx/snippets/lolzcloud-proxy.conf
    nginx -t && systemctl reload nginx || true
    systemctl restart lolzcloud || true
    echo 'Code/config rolled back; current user data retained. Private state backup remains on server.'
  fi
}
trap rollback EXIT
systemctl stop lolzcloud
tar -czf "$backup/state.tar.gz" -C /var/lib/lolzcloud .
chmod 0600 "$backup/state.tar.gz" "$backup/previous-release.txt" "$backup/nginx-proxy.conf"
ln -s "$dest" "$root/current.next-$release"
mv -Tf "$root/current.next-$release" "$root/current"
cp "$dest/ops/nginx-proxy.conf" /etc/nginx/snippets/lolzcloud-proxy.conf
nginx -t
systemctl start lolzcloud
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:4387/api/health > "$backup/health.json"; then break; fi
  sleep 1
done
/opt/lolzcloud-runtime/node -e 'const h=require(process.argv[1]);if(h.version!=="@@VERSION@@"||h.socialProtocol!==1||h.roomProtocol!==2)process.exit(1)' "$backup/health.json"
systemctl reload nginx
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  social_status=$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' 'https://lolzcloud.com/social?tab=notifications')
  if test "$social_status" = 303; then break; fi
  sleep 1
done
test "$social_status" = 303
test "$(curl --max-time 8 -s -o /dev/null -w '%{http_code}' https://lolzcloud.com/api/social/me)" = 401
curl -fsS https://lolzcloud.com/api/health > "$backup/public-health.json"
/opt/lolzcloud-runtime/node -e 'const h=require(process.argv[1]);if(h.version!=="@@VERSION@@"||h.socialProtocol!==1||!h.oauthConfigured)process.exit(1)' "$backup/public-health.json"
complete=1
echo "DEPLOYED $release"
cat "$backup/public-health.json"
printf '\nBACKUP %s\n' "$backup"
`.replaceAll('@@RELEASE@@', release).replaceAll('@@SHA@@', digest).replaceAll('@@VERSION@@', version);
const scriptFile = path.join(directory, release + '.sh'); fs.writeFileSync(scriptFile, script);
const receipt = { release, version, archive, archiveSha256: digest, hostAlias: sshHost, status: 'staged-local' };
fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('Reviewable server release: ' + directory);
if (process.argv.includes('--deploy')) {
  const jump=require('./deploy-transport.cjs').jumpOptions;
  const ssh = [...jump,'-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', sshHost];
  run('ssh.exe', [...ssh, 'mkdir -p -m 0750 /opt/lolzcloud-server/uploads']);
  for (const file of [archive, scriptFile, smokeFile]) run('scp.exe', [...jump,'-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', file, sshHost + ':/opt/lolzcloud-server/uploads/' + path.basename(file)]);
  run('ssh.exe', [...ssh, 'sh -n /opt/lolzcloud-server/uploads/' + release + '.sh']);
  const output = run('ssh.exe', [...ssh, 'sh /opt/lolzcloud-server/uploads/' + release + '.sh']);
  if (!output.includes('DEPLOYED ' + release)) throw Error('Missing deployment receipt');
  Object.assign(receipt, { status: 'deployed', backup: '/var/backups/lolzcloud/' + release, deployedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  fs.writeFileSync(path.join(base, 'latest-deployment.json'), JSON.stringify(receipt, null, 2) + '\n');
}
