'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto'),yauzl=require('yauzl');
const {sourceArchive}=require('../tools/source-archive.cjs');
function entries(filename){return new Promise((resolve,reject)=>{yauzl.open(filename,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);const files={};zip.on('error',reject);zip.on('end',()=>resolve(files));zip.on('entry',entry=>{if(entry.fileName.endsWith('/'))return zip.readEntry();zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{files[entry.fileName]=Buffer.concat(chunks);zip.readEntry();});});});zip.readEntry();});});}
test('a pinned source archive preserves compiled LF blobs under Windows checkout settings and ignores dirty files without touching the index',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lc-source-archive-')),root=path.join(directory,'repo');fs.mkdirSync(root);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git(['init','-q']);
 // Populate the public source archive namespaces; the interesting payloads are
 // Swift/C/header text that Windows checkout settings would otherwise rewrite.
 for(const folder of ['.github','source','tests','tools','config','docs','licenses','server','telegram','music','android','ios','website']){fs.mkdirSync(path.join(root,folder),{recursive:true});fs.writeFileSync(path.join(root,folder,'fixture.txt'),'Fixture\n');}
 for(const name of ['.gitignore','package-lock.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md'])fs.writeFileSync(path.join(root,name),'Fixture\n');
 fs.writeFileSync(path.join(root,'.gitattributes'),'* text=auto\n*.js text eol=lf\n');fs.writeFileSync(path.join(root,'package.json'),'{}\n');
 const expected={'source/main.js':'module.exports = "committed";\n','ios/App.swift':'import Foundation\nlet title = "Музыка"\n','ios/DSPCore.c':'#include "DSPCore.h"\nint level(void) { return 1; }\n','ios/DSPCore.h':'int level(void);\n'};
 for(const[name,data]of Object.entries(expected))fs.writeFileSync(path.join(root,name),data);
 git(['-c','core.autocrlf=false','add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Pinned source']);const ref=git(['rev-parse','HEAD']).trim();
 git(['config','core.autocrlf','true']);git(['config','core.eol','crlf']);fs.writeFileSync(path.join(root,'source/main.js'),'module.exports = "uncommitted";\r\n');
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),index=path.join(root,'.git/index'),before=hash(index),old=process.env.LOLZCLOUD_SOURCE_REF;
 let archive;try{process.env.LOLZCLOUD_SOURCE_REF=ref;archive=await sourceArchive({root,filename:path.join(directory,'source.zip')});}finally{if(old===undefined)delete process.env.LOLZCLOUD_SOURCE_REF;else process.env.LOLZCLOUD_SOURCE_REF=old;}
 const files=await entries(archive);for(const[name,data]of Object.entries(expected))assert.deepEqual(files[name],Buffer.from(data),name+' must be the committed compiler input');assert.equal(hash(index),before);assert.equal(git(['config','core.autocrlf']).trim(),'true');assert.equal(fs.readFileSync(path.join(root,'source/main.js'),'utf8'),'module.exports = "uncommitted";\r\n');
});
