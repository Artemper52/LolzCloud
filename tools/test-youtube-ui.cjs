'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'LolzCloud-youtube-ui-'));
execFile(require('electron'),[path.join(__dirname,'../tests/youtube-ui.cjs')],{windowsHide:true,timeout:60000,maxBuffer:100000,env:{...process.env,LOLZCLOUD_YOUTUBE_TEST_PROFILE:profile}},(error,out,err)=>{process.stdout.write(out);if(error){console.error(err||error.message);process.exitCode=1;}if(path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('LolzCloud-youtube-ui-'))fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
