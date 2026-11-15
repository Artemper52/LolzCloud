'use strict';
// Provider pages and IPC are declared fixtures. Audio decoding, the injected
// preload, worklet, media clock and downstream MediaRecorder PCM are real.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),profile=process.env.LOLZCLOUD_PITCH_TEST_PROFILE;
assert.ok(profile&&path.isAbsolute(profile),'Use a task-owned test profile');
app.setPath('userData',profile);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{}); // Sequential hidden windows share this run.
const report={status:'failed',scope:'Real HTMLMediaElement/WebAudio/AudioWorklet/downstream MediaRecorder on declared provider and IPC fixtures; no personal account or physical audio test',cases:[],inputs:{},startedAt:new Date().toISOString()};
for(const file of ['source/plugins/pitch-worklet.js','source/plugins/sound-effects.js','source/app/lib/js/local-player.js','source/guest-preload.cjs','source/youtube-preload.cjs'])report.inputs[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function wav(){const rate=48000,frames=rate*9,bytes=Buffer.alloc(44+frames*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++)for(let c=0;c<2;c++)bytes.writeInt16LE(Math.round(.12*Math.sin(2*Math.PI*910*i/rate)*32767),44+i*4+c*2);return bytes;}
const tone=wav(),localFile=path.join(profile,'fixture-tone.wav'),localHTML=path.join(profile,'fixture-local.html');fs.writeFileSync(localFile,tone);
const assets=Object.fromEntries(['tempo-worklet.js','normalization-worklet.js','pitch-worklet.js'].map(n=>[n,fs.readFileSync(path.join(root,'source/plugins',n),'utf8')]));
const helpers=['tempo-worklet.js','normalization-worklet.js','pitch-worklet.js'].map(n=>'<script src="'+pathToFileURL(path.join(root,'source/plugins',n)).href+'"></script>').join('');
fs.writeFileSync(localHTML,'<!doctype html><html><body>'+helpers+'</body></html>');
const localSource=fs.readFileSync(path.join(root,'source/app/lib/js/local-player.js'),'utf8');
const baseConfig={enabled:false,gains:[0,0,0,0,0],preampDb:0,reverb:0,echo:0,rate:1,preservesPitch:true,pitch:1,transportEnabled:true};
async function render(mode,settings){
 const partition='pitch-'+mode+'-'+crypto.randomBytes(4).toString('hex'),ses=session.fromPartition(partition);
 await ses.protocol.handle('https',request=>{const u=new URL(request.url),name=path.basename(u.pathname);if(name==='tone.wav')return new Response(tone,{headers:{'Content-Type':'audio/wav','Access-Control-Allow-Origin':'*'}});if(assets[name])return new Response(assets[name],{headers:{'Content-Type':'text/javascript'}});return new Response('<!doctype html><html><body>Isolated provider audio fixture</body></html>',{headers:{'Content-Type':'text/html'}});});
 const win=new BrowserWindow({show:false,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,...(mode!=='local'?{preload:path.join(root,'source',mode==='youtube'?'youtube-preload.cjs':'guest-preload.cjs')}:{})}});
 try{
  if(mode==='local')await win.loadFile(localHTML);else await win.loadURL(mode==='youtube'?'https://music.youtube.com/watch?v=abcdefghijk':'https://soundcloud.com/pitch/fixture');
  const value=await win.webContents.executeJavaScript(`(async()=>{
    const mode=${JSON.stringify(mode)},config=${JSON.stringify({...baseConfig,...settings})},NativeContext=window.AudioContext;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ctx,capture,media,handlers=new Map(),position,state,configure,pause,seek,stop;
    if(mode==='local'){
      const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...args){return Reflect.apply(connect,this,[destination===ctx?.destination?capture:destination,...args]);};
      window.AudioContext=class extends NativeContext{constructor(...args){super(...args);ctx=this;capture=this.createMediaStreamDestination();}};
      Function('require',${JSON.stringify(localSource)})(()=>({ipcRenderer:{on:(n,h)=>handlers.set(n,h),send(){}}}));
      handlers.get('lolzcloud:dsp')({},config);
      handlers.get('lolzcloud:local-play')({},{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',token:1,source:${JSON.stringify(pathToFileURL(localFile).href)},volume:.5});
      media=document.querySelector('audio');position=()=>window.LolzCloudLocal.position();state=()=>window.LolzCloudLocal.pitchState();configure=c=>handlers.get('lolzcloud:dsp')({},c);pause=()=>window.LolzCloudLocal.command({command:'pause'});seek=v=>window.LolzCloudLocal.command({command:'seek',value:v});stop=()=>window.LolzCloudLocal.shutdown();
    }else{
      ctx=new NativeContext();capture=ctx.createMediaStreamDestination();media=mode==='youtube'?document.createElement('video'):new Audio();media.src=new URL('/tone.wav',location.href).href;document.body.append(media);
      const source=ctx.createMediaElementSource(media),gain=ctx.createGain();gain.gain.value=.5;source.connect(gain);gain.connect(capture);
      if(typeof window.__lolzcloudSetAudioFX!=='function')throw Error('Actual preload missing');window.__lolzcloudSetAudioFX(config);await ctx.resume();await media.play();
      position=()=>media.currentTime;state=()=>window.__lolzcloudGetAudioState().pitch;configure=c=>window.__lolzcloudSetAudioFX(c);pause=()=>media.pause();seek=v=>{media.currentTime=v;};stop=()=>{media.pause();return ctx.close();};
    }
    const wanted=(config.enabled||config.transportEnabled)&&config.preservesPitch?config.pitch:1;let meter,waited=0;
    for(;waited<5000;waited+=50){await sleep(50);meter=state();if(!media.paused&&ctx?.state==='running'&&(wanted===1||meter?.applied))break;}
    if(waited>=5000)throw Error('Real player/processor not ready: '+JSON.stringify({paused:media.paused,context:ctx?.state,meter}));
    const mime='audio/webm;codecs=opus';if(!MediaRecorder.isTypeSupported(mime))throw Error('No downstream recording format');
    const recorder=new MediaRecorder(capture.stream,{mimeType:mime,audioBitsPerSecond:192000}),chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};const ended=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject;});
    const before=position(),wall=performance.now();recorder.start();await sleep(1350);recorder.stop();const seconds=(performance.now()-wall)/1000,advanced=position()-before;await ended;
    const pcm=await ctx.decodeAudioData(await new Blob(chunks,{type:mime}).arrayBuffer()),data=pcm.getChannelData(0),rate=pcm.sampleRate,start=Math.round(rate*.2),end=Math.min(data.length,Math.round(rate*1.1));let energy=0,peak=0,invalid=0;
    for(let i=start;i<end;i++){if(!Number.isFinite(data[i]))invalid++;energy+=data[i]*data[i];peak=Math.max(peak,Math.abs(data[i]));}
    const expected=910*(config.preservesPitch?config.pitch:config.rate);let best=0,frequency=0;
    for(let f=expected-9;f<=expected+9;f+=.25){let re=0,im=0;const step=2*Math.PI*f/rate,wr=Math.cos(step),wi=Math.sin(step);let cr=Math.cos(start*step),ci=Math.sin(start*step);for(let i=start;i<end;i++){re+=data[i]*cr;im+=data[i]*ci;const nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr;}const power=re*re+im*im;if(power>best){best=power;frequency=f;}}
    meter=state();pause();await sleep(80);const pausedAt=position();configure({...config,pitch:config.pitch===1.25?.75:1.25});await sleep(100);const afterEdit=position(),paused=media.paused;seek(2);await sleep(120);const afterSeek=position(),stillPaused=media.paused;await stop();
    return{mode,config,frequency,expected,rms:Math.sqrt(energy/Math.max(1,end-start)),peak,invalid,decodedSamples:data.length,sampleRate:rate,seconds,advanced,meter,paused,pausedAt,afterEdit,afterSeek,stillPaused};
  })()`,true);
  assert.equal(value.invalid,0);assert.ok(value.rms>.015&&value.rms<.09,'Audible bounded downstream PCM: '+JSON.stringify(value));assert.ok(Math.abs(value.frequency-value.expected)<=1.5,'Actual tone frequency: '+JSON.stringify(value));assert.ok(Math.abs(value.advanced/value.seconds-value.config.rate)<.15,'Media clock must follow tempo: '+JSON.stringify(value));
  assert.equal(value.paused,true);assert.equal(value.stillPaused,true);assert.ok(Math.abs(value.afterEdit-value.pausedAt)<.035,'Tone edit may not advance paused transport');assert.ok(Math.abs(value.afterSeek-2)<.08,'Paused seek must remain exact');
  if(value.config.preservesPitch&&value.config.pitch!==1){assert.equal(value.meter.available,true);assert.equal(value.meter.applied,true);assert.ok(value.meter.processedFrames>0);}
  report.cases.push(value);console.log('PASS '+mode+' tempo '+value.config.rate+' tone '+value.config.pitch+' preserve '+value.config.preservesPitch+' -> '+value.frequency.toFixed(2)+' Hz');
 }finally{win.destroy();await ses.protocol.unhandle('https');}
}
app.whenReady().then(async()=>{
 try{
  const modes=(process.env.LOLZCLOUD_PITCH_TEST_MODES||'soundcloud,youtube,local').split(',');assert.ok(modes.every(m=>['soundcloud','youtube','local'].includes(m)));
  for(const mode of modes){await render(mode,{rate:1.5,pitch:.75});await render(mode,{rate:.75,pitch:1.5});await render(mode,{rate:1.5,pitch:.75,preservesPitch:false});}
  for(const[file,hash]of Object.entries(report.inputs))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,'Runtime input changed during PCM verification: '+file);
  report.status='passed';console.log(JSON.stringify({status:'passed',cases:report.cases.length,scope:report.scope}));
 }catch(e){report.error=e.stack;console.error(e.stack);}
 finally{report.finishedAt=new Date().toISOString();const out=process.env.LOLZCLOUD_PITCH_TEST_OUTPUT;if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');app.exit(report.status==='passed'?0:1);}
});
