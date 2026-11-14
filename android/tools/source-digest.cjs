'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function sourceDigest(){
 const files=['version.json','app/src/main/AndroidManifest.xml'];
 const walk=directory=>{for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){const name=directory+'/'+entry.name;if(entry.isDirectory())walk(name);else if(entry.isFile())files.push(name);else throw Error('Unexpected link in Android source inputs');}};
 for(const directory of ['app/src/main/java','app/src/main/res','app/src/main/assets'])walk(directory);
 const hash=crypto.createHash('sha256');
 for(const name of files.sort()){
   let bytes=fs.readFileSync(path.join(root,name));
   if(/\.(?:java|xml|json|html|js|css|svg|txt)$/.test(name))bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n?/g,'\n'));
   hash.update(name+'\0'+bytes.length+'\0');hash.update(bytes);
 }
 return{sha256:hash.digest('hex'),files:files.length};
}
if(require.main===module){require('./sync-room-assets.cjs').syncRoomAssets();console.log(JSON.stringify(sourceDigest()));}
module.exports={sourceDigest};
