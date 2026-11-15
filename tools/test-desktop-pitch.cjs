'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'LolzCloud-pitch-test-'));
execFile(require('electron'),[path.join(__dirname,'../tests/desktop-pitch-ui.cjs')],{windowsHide:true,timeout:180000,maxBuffer:1048576,env:{...process.env,LOLZCLOUD_PITCH_TEST_PROFILE:temporary}},(error,stdout,stderr)=>{
 if(stdout)process.stdout.write(stdout);if(error){console.error(stderr||error.message);process.exitCode=1;}
 const target=path.resolve(temporary);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('LolzCloud-pitch-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
