'use strict';
// Add verified platform assets to the official mirror without rewriting older
// immutable releases. Mutable channel metadata is replaced on new inodes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const version=require('../package.json').version,host=process.env.LOLZCLOUD_DEPLOY_SSH_HOST||'lolzcloud';
if(!/^[\w.-]+$/.test(host))throw Error('Use a configured SSH alias');
const planFile=process.env.LOLZCLOUD_PLATFORM_PLAN;if(!planFile)throw Error('Set LOLZCLOUD_PLATFORM_PLAN to the reviewed public artifact plan');
const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
if(plan.version!==version||!Array.isArray(plan.files)||!plan.files.length)throw Error('Invalid platform artifact plan');
const base=process.env.LOLZCLOUD_PLATFORM_OUTPUT||'D:/LolzCloud-Android-Toolchain/platform-releases';
const resume=process.env.LOLZCLOUD_PLATFORM_RESUME||'';
if(resume&&!/^\d{8}T\d{6}-platforms-\d+\.\d+\.\d+-[a-f0-9]{8}$/.test(resume))throw Error('Invalid staged release to resume');
const id=resume||new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-platforms-'+version+'-'+crypto.randomBytes(4).toString('hex'),directory=path.join(base,id);
fs.mkdirSync(directory,{recursive:true});
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const seen=new Set(),rows=[];
for(const row of plan.files){
 if(typeof row.name!=='string'||path.basename(row.name)!==row.name||seen.has(row.name)||!/^(?:LolzCloud-[A-Za-z0-9_.-]+\.(?:zip|tar\.gz|AppImage|exe|blockmap|ipa)|LolzCloud-\d+\.\d+\.\d+-SHA256SUMS\.txt|legacy\.yml|update-legacy\.json|android-update\.json|platforms\.json)$/.test(row.name))throw Error('Unexpected public asset name');
 seen.add(row.name);
 if(row.local){const target=path.join(directory,row.name);fs.copyFileSync(path.resolve(row.local),target);rows.push({name:row.name,size:fs.statSync(target).size,sha256:digest(target),source:'upload'});}
 else {if(row.remote!==`/opt/lolzcloud-builds/release-${version}/dist/${row.name}`||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.size)||row.size<=0)throw Error('Invalid frozen Linux build reference');rows.push({name:row.name,remote:row.remote,size:row.size,sha256:row.sha256,source:'build'});}
}
const remote='/opt/lolzcloud-server/uploads/'+id;
const payload={id,version,files:rows};
if(resume&&(!fs.existsSync(path.join(directory,'plan.json'))||JSON.stringify(JSON.parse(fs.readFileSync(path.join(directory,'plan.json'),'utf8')))!==JSON.stringify(payload)))throw Error('A resumed upload must contain exactly the same verified artifact plan');
fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(payload,null,2));
const script=String.raw`'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const upload=__dirname,plan=JSON.parse(fs.readFileSync(path.join(upload,'plan.json'),'utf8'));
if(!/^\d{8}T\d{6}-platforms-\d+\.\d+\.\d+-[a-f0-9]{8}$/.test(plan.id)||!/^\d+\.\d+\.\d+$/.test(plan.version))throw Error('Invalid staged release');
const hash=file=>{const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024),sum=crypto.createHash('sha256');try{let bytes;while((bytes=fs.readSync(fd,buffer,0,buffer.length,null))>0)sum.update(buffer.subarray(0,bytes));return sum.digest('hex');}finally{fs.closeSync(fd);}};
const link='/srv/lolzcloud/current/downloads',previous=fs.realpathSync(link),release='/srv/lolzcloud/releases/'+plan.id,destination=path.join(release,'downloads');
if(!previous.startsWith('/srv/lolzcloud/releases/')||!fs.lstatSync(link).isSymbolicLink()||fs.existsSync(release))throw Error('Unexpected download snapshot');
fs.mkdirSync(release);fs.mkdirSync(destination);execFileSync('cp',['-al',previous+'/.',destination]);
const mutable=new Set(['legacy.yml','update-legacy.json','android-update.json','platforms.json']),published=[];
for(const row of plan.files){
 if(path.basename(row.name)!==row.name||!/^(?:LolzCloud-[A-Za-z0-9_.-]+\.(?:zip|tar\.gz|AppImage|exe|blockmap|ipa)|LolzCloud-\d+\.\d+\.\d+-SHA256SUMS\.txt|legacy\.yml|update-legacy\.json|android-update\.json|platforms\.json)$/.test(row.name))throw Error('Invalid artifact name');
 const source=row.source==='upload'?path.join(upload,row.name):row.remote;
 if(row.source!=='upload'&&source!==('/opt/lolzcloud-builds/release-'+plan.version+'/dist/'+row.name))throw Error('Invalid build input path');
 const sourceStat=fs.lstatSync(source);if(!sourceStat.isFile()||sourceStat.size!==row.size||hash(source)!==row.sha256)throw Error('Source hash/size mismatch: '+row.name);
 const target=path.join(destination,row.name);
 if(fs.existsSync(target)&&!mutable.has(row.name)){if(hash(target)!==row.sha256)throw Error('Published versioned asset is immutable: '+row.name);published.push(row);continue;}
 const temporary=target+'.new-'+plan.id;fs.copyFileSync(source,temporary,fs.constants.COPYFILE_EXCL);fs.chmodSync(temporary,0o644);fs.renameSync(temporary,target);published.push(row);
}
const legacy=path.join(destination,'update-legacy.json');
if(plan.files.some(row=>row.name==='android-update.json')){
 const manifest=JSON.parse(fs.readFileSync(path.join(destination,'android-update.json'),'utf8')),name='LolzCloud-Android-'+manifest.versionName+'.apk';
 if(!/^\d+\.\d+\.\d+$/.test(manifest.versionName)||!Number.isSafeInteger(manifest.versionCode)||manifest.versionCode<1||manifest.packageName!=='com.lolzcloud.mobile'||manifest.url!=='https://lolzcloud.com/downloads/'+name||manifest.certificateSha256!=='84305e6af2473179b6e124a1822eb82c0343e9bba0b5480cd5a91ecc0dceaa44'||!/^[a-f0-9]{64}$/.test(manifest.sourceSha256)||fs.statSync(path.join(destination,name)).size!==manifest.size||hash(path.join(destination,name))!==manifest.sha256)throw Error('Android manifest identity or APK mismatch');
}
if(plan.files.some(row=>row.name==='update-legacy.json')){
 const manifest=JSON.parse(fs.readFileSync(legacy,'utf8'));if(manifest.version!==plan.version)throw Error('Legacy version mismatch');
 for(const item of [manifest.archive,manifest.setup]){if(path.basename(item.name)!==item.name||item.url!=='https://lolzcloud.com/downloads/'+item.name)throw Error('Legacy download URL mismatch');const file=path.join(destination,item.name);if(fs.statSync(file).size!==item.size||hash(file)!==item.sha256)throw Error('Legacy artifact mismatch');}
 const yaml=fs.readFileSync(path.join(destination,'legacy.yml'),'utf8'),sha512=crypto.createHash('sha512').update(fs.readFileSync(path.join(destination,manifest.setup.name))).digest('base64');if(!yaml.includes('version: '+plan.version)||!yaml.includes('sha512: '+sha512))throw Error('Legacy updater checksum mismatch');
}
const sums=path.join(destination,'SHA256SUMS.txt'),old=fs.existsSync(sums)?fs.readFileSync(sums,'utf8').trim().split(/\r?\n/):[],names=new Set(published.map(row=>row.name));
const lines=old.filter(line=>{const m=line.match(/^[a-f0-9]{64}\s+\*?(.+)$/i);return m&&!names.has(m[1]);});for(const row of published)lines.push(row.sha256+'  '+row.name);
fs.writeFileSync(sums+'.new',lines.join('\n')+'\n',{mode:0o644});fs.renameSync(sums+'.new',sums);
const backup='/var/backups/lolzcloud-updates/'+plan.id;fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.writeFileSync(path.join(backup,'previous-downloads.txt'),previous+'\n',{mode:0o600});
const next=link+'.next-'+plan.id;fs.symlinkSync(destination,next);fs.renameSync(next,link);
const receipt={status:'published',release:plan.id,version:plan.version,previous,destination,files:published};fs.writeFileSync(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify(receipt));
`;
fs.writeFileSync(path.join(directory,'publish.cjs'),script);
const receipt={status:'staged',release:id,version,directory,files:rows};fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log('Staged verified public platform assets: '+rows.length);
if(process.argv.includes('--deploy')){
 const options=[...require('./deploy-transport.cjs').jumpOptions,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=18'];
 const run=(file,args)=>{const r=spawnSync(file,args,{encoding:'utf8',windowsHide:true,timeout:900000,maxBuffer:2*1024*1024});if(r.error||r.status!==0)throw r.error||Error(r.stderr||r.stdout);return r.stdout;};
 run('ssh.exe',[...options,host,'mkdir -p -m 0700 '+remote]);
 const inventory=JSON.parse(run('ssh.exe',[...options,host,"/opt/lolzcloud-runtime/node -e 'const fs=require(\"node:fs\"),path=require(\"node:path\"),dir=process.argv[1];console.log(JSON.stringify(Object.fromEntries(fs.readdirSync(dir).map(name=>[name,fs.statSync(path.join(dir,name)).size]))))' "+remote]).trim());
 const batch=rows.filter(row=>row.source==='upload').filter(row=>inventory[row.name]!==row.size).map(row=>{
   if(inventory[row.name]>row.size)throw Error('Unexpected oversized partial upload: '+row.name);
   return (inventory[row.name]===undefined?'put':'reput')+' "'+path.join(directory,row.name).replaceAll('\\','/')+'" "'+remote+'/'+row.name+'"';
 });
 for(const name of ['plan.json','publish.cjs'])batch.push('put "'+path.join(directory,name).replaceAll('\\','/')+'" "'+remote+'/'+name+'"');
 const batchFile=path.join(directory,'upload.sftp');fs.writeFileSync(batchFile,batch.join('\n')+'\n');
 run('sftp.exe',[...options,'-b',batchFile,host]);
 const result=JSON.parse(run('ssh.exe',[...options,host,'/opt/lolzcloud-runtime/node '+remote+'/publish.cjs']).trim());if(result.release!==id||result.status!=='published')throw Error('Missing publication receipt');fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(result,null,2));console.log('PUBLISHED '+id);
}
