'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,host=process.env.LOLZCLOUD_DEPLOY_SSH_HOST||'lolzcloud';
if(!/^[\w.-]+$/.test(host))throw Error('Use a configured SSH alias');
const id=new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-website-'+version+'-'+crypto.randomBytes(4).toString('hex');
const directory=path.join('D:/LolzCloud-Android-Toolchain/website-releases',id);fs.mkdirSync(directory,{recursive:true});
const names=['index.html','app.js','site-config.js','style.css','downloads.css','install.html','install.js',...fs.readdirSync(path.join(root,'website/assets')).map(name=>'assets/'+name)];
const files=names.map(name=>{const file=path.join(root,'website',name);if(!fs.lstatSync(file).isFile())throw Error('Website input must be a regular file');return{name,size:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};});
const run=(file,args,options={})=>{const result=spawnSync(file,args,{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,...options});if(result.error||result.status!==0)throw result.error||Error(result.stderr||result.stdout);return result.stdout;};
const archive=path.join(directory,'website.tar.gz');run('tar.exe',['-czf',archive,'-C',path.join(root,'website'),...names]);
const plan={id,version,archiveSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),files};fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2));
const script=String.raw`'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'plan.json'),'utf8')),base='/srv/lolzcloud',link=base+'/current';
if(!/^\d{8}T\d{6}-website-\d+\.\d+\.\d+-[a-f0-9]{8}$/.test(plan.id))throw Error('Invalid website release');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),archive=path.join(__dirname,'website.tar.gz');if(hash(archive)!==plan.archiveSha256)throw Error('Website archive integrity mismatch');
const previous=fs.realpathSync(link),downloads=fs.realpathSync(link+'/downloads'),destination=base+'/releases/'+plan.id;
if(!fs.lstatSync(link).isSymbolicLink()||!previous.startsWith(base+'/releases/')||!downloads.startsWith(base+'/releases/')||fs.existsSync(destination))throw Error('Unexpected site snapshot');
for(const row of plan.files)if(!/^(?:[a-z0-9-]+\.(?:html|js|css)|assets\/[a-z0-9-]+\.(?:png|svg))$/.test(row.name))throw Error('Unexpected website filename');
const contents=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);if(JSON.stringify(contents.sort())!==JSON.stringify(plan.files.map(row=>row.name).sort()))throw Error('Unexpected website archive entries');
fs.mkdirSync(destination);execFileSync('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',destination]);
for(const row of plan.files){const file=path.join(destination,row.name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size!==row.size||hash(file)!==row.sha256)throw Error('Website file verification failed: '+row.name);fs.chmodSync(file,0o644);}
fs.chmodSync(path.join(destination,'assets'),0o755);fs.symlinkSync(downloads,path.join(destination,'downloads'));
if(fs.existsSync(previous+'/source')){const source=fs.realpathSync(previous+'/source');if(source.startsWith(base+'/releases/'))fs.symlinkSync(source,path.join(destination,'source'));}
const html=fs.readFileSync(path.join(destination,'index.html'),'utf8');for(const platform of ['windows','android','ios','linux'])if(!html.includes('data-platform-card="'+platform+'"'))throw Error('Platform card missing');
for(const name of ['LolzCloud-0.9.15-win-x64-Setup.exe','LolzCloud-Android-0.1.5.apk','LolzCloud-0.9.15-linux-x64.AppImage','LolzCloud-0.9.15-linux-arm64.tar.gz','LolzCloud-0.9.15-r2-source.zip','LolzCloud-iOS-0.1.1-source.zip'])if(!fs.existsSync(path.join(downloads,name)))throw Error('Website download is not published: '+name);
const backup='/var/backups/lolzcloud-website/'+plan.id;fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.writeFileSync(backup+'/previous-site.txt',previous+'\n',{mode:0o600});
execFileSync('nginx',['-t'],{stdio:['ignore','pipe','pipe']});fs.symlinkSync(destination,link+'.next-'+plan.id);fs.renameSync(link+'.next-'+plan.id,link);
console.log(JSON.stringify({status:'published',release:plan.id,version:plan.version,previous,destination,downloads,files:plan.files}));
`;
fs.writeFileSync(path.join(directory,'publish.cjs'),script);fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify({status:'staged',...plan},null,2));console.log('Website staged: '+id);
if(process.argv.includes('--deploy')){const options=[...require('./deploy-transport.cjs').jumpOptions,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=18'],remote='/opt/lolzcloud-server/uploads/'+id;run('ssh.exe',[...options,host,'mkdir -p -m 0700 '+remote]);run('scp.exe',[...options,archive,path.join(directory,'plan.json'),path.join(directory,'publish.cjs'),host+':'+remote+'/']);const receipt=JSON.parse(run('ssh.exe',[...options,host,'/opt/lolzcloud-runtime/node '+remote+'/publish.cjs']).trim());if(receipt.status!=='published'||receipt.release!==id)throw Error('Missing site publication receipt');fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log('PUBLISHED '+id);}
