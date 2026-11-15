'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { presetSound } = require('../source/integrations/sound-settings.cjs');
app.setPath('userData', process.env.LOLZCLOUD_AUDIO_TEST_PROFILE);
app.disableHardwareAcceleration();
const plugin = ['beat-tracker.js', 'tempo-worklet.js', 'normalization-worklet.js', 'pitch-worklet.js', 'sound-effects.js'].map(file => fs.readFileSync(path.join(__dirname, '../source/plugins', file), 'utf8')).join('\n');
const localPlugin=fs.readFileSync(path.join(__dirname,'../source/app/lib/js/local-player.js'),'utf8');
async function renderLocal(window,config,volume){
  await window.loadURL('https://soundcloud.com/lolzcloud-local-render-test');
  return window.webContents.executeJavaScript(`(async()=>{
    const offline=new OfflineAudioContext(2,48000,48000),handlers=new Map();let sources=0;
    window.AudioContext=class {constructor(){return new Proxy(offline,{get(target,key){if(key==='resume')return()=>Promise.resolve();if(key==='createMediaElementSource')return()=>{sources++;const source=offline.createBufferSource(),buffer=offline.createBuffer(2,48000,48000);for(let ch=0;ch<2;ch++){const samples=buffer.getChannelData(ch);for(let i=0;i<samples.length;i++)samples[i]=.12*Math.sin(2*Math.PI*1000*i/48000);}source.buffer=buffer;source.start();return source;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}};
    Function('require',${JSON.stringify(localPlugin)})(()=>({ipcRenderer:{on:(name,handler)=>handlers.set(name,handler),send(){}}}));
    handlers.get('lolzcloud:dsp')({},${JSON.stringify(config)});
    handlers.get('lolzcloud:local-play')({},{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',token:1,source:'file:///lolzcloud-render-fixture.wav',volume:${JSON.stringify(volume)}});
    await new Promise(resolve=>setTimeout(resolve,20));const media=document.querySelector('audio'),rate=media.playbackRate,pitch=media.preservesPitch;
    const rendered=await offline.startRendering(),samples=rendered.getChannelData(0);let energy=0;for(let i=24000;i<36000;i++)energy+=samples[i]**2;
    handlers.get('lolzcloud:dsp')({},{enabled:false,preampDb:-12,rate:2,preservesPitch:true});
    return{rms:Math.sqrt(energy/12000),sources,rate,pitch,mediaVolume:media.volume,resetRate:media.playbackRate};
  })()`);
}
async function render(window, config, opaque = false, owned = false, singleTone = false, protection = null, amplitude = .12, movingDuck = false) {
  await window.loadURL('https://soundcloud.com/lolzcloud-audio-render-test');
  return window.webContents.executeJavaScript(`(async () => {
    const offline = new OfflineAudioContext(2, 48000 * 3.5, 48000); let graphCount = 0; const mediaOwners = new WeakSet();
    Object.defineProperty(offline, 'state', { get: () => 'running' });
    window.AudioContext = class TestContext { constructor() { return new Proxy(offline, { get(target, key) {
      if (key === 'resume') return () => Promise.resolve();
      if (key === 'createMediaElementSource') return window.AudioContext.prototype.createMediaElementSource.bind(target);
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    }}); }
    createMediaElementSource(media) {
        if (mediaOwners.has(media)) throw new DOMException('Already owned by SoundCloud', 'InvalidStateError'); mediaOwners.add(media);
        graphCount++; const source = offline.createBufferSource(), buffer = offline.createBuffer(2, Math.round(48000 * (${JSON.stringify(movingDuck)} ? 3.4 : .3)), 48000);
        for (let ch = 0; ch < 2; ch++) { const data = buffer.getChannelData(ch); for (let i = 0; i < data.length; i++) data[i] = ${JSON.stringify(amplitude)} * ((${JSON.stringify(singleTone)} ? 0 : Math.sin(2*Math.PI*50*i/48000)) + Math.sin(2*Math.PI*1000*i/48000)); }
        source.buffer = buffer; source.start(0); return source;
    }};
    Function(${JSON.stringify(plugin)})();
    const media = new Audio(); media.src = ${JSON.stringify(opaque ? 'https://opaque.example/audio.mp3' : 'data:audio/wav;base64,UklGRg==')};
    Object.defineProperty(media, 'readyState', { get: () => 4 });
    Object.defineProperty(media, 'error', { get: () => null });
    Object.defineProperty(media, 'paused', { get: () => false }); Object.defineProperty(media, 'duration', { get: () => 3.5 });
    let sdkSource, sdkGain;
    if (${JSON.stringify(owned)}) { const sdk = new AudioContext(); sdkSource = sdk.createMediaElementSource(media); sdkGain = sdk.createGain(); sdkGain.gain.value = .5; sdkSource.connect(sdkGain); sdkGain.connect(sdk.destination); }
    if (${JSON.stringify(protection)}) window.__lolzcloudSetAudioSafety(${JSON.stringify(protection)});
    window.__lolzcloudSetAudioFX(${JSON.stringify(config)}); media.dispatchEvent(new Event('playing'));
    await new Promise(resolve => setTimeout(resolve, 140));
    if (sdkSource) { sdkSource.disconnect(sdkGain); sdkSource.connect(sdkGain); sdkSource.disconnect(); sdkSource.connect(sdkGain); }
    const rate = media.playbackRate, pitch = media.preservesPitch;
    let duckTask, restoreTask;
    if (${JSON.stringify(movingDuck)}) {
      window.__lolzcloudMediaCommand('volume', .37);
      duckTask = offline.suspend(.6).then(() => { window.__lolzcloudSetAudioSafety({duckGain:.2}); return offline.resume(); });
      restoreTask = offline.suspend(1.6).then(() => { window.__lolzcloudSetAudioSafety({duckGain:1}); return offline.resume(); });
    }
    const rendered = await offline.startRendering(), samples = rendered.getChannelData(0);
    await Promise.all([duckTask,restoreTask]);
    let tail = 0; for (let i = 48000 * .6; i < 48000 * 2; i++) tail += samples[i] ** 2;
    function amplitude(frequency, start = .2, end = .275) { let re = 0, im = 0; for (let i = Math.round(start*48000); i < Math.round(end*48000); i++) { re += samples[i]*Math.cos(2*Math.PI*frequency*i/48000); im += samples[i]*Math.sin(2*Math.PI*frequency*i/48000); } return Math.hypot(re, im); }
    let peak=0,maxJump=0;for(let i=1;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));if(i>4800&&i<48000*3.3)maxJump=Math.max(maxJump,Math.abs(samples[i]-samples[i-1]));}
    window.__lolzcloudSetAudioFX({enabled:false,gains:[0,0,0,0,0],rate:1,reverb:0,echo:0});
    return { rate, pitch, peak, maxJump, ducked:amplitude(1000,1.2,1.275)/amplitude(1000), restored:amplitude(1000,3.1,3.175)/amplitude(1000), volume:media.volume, resetRate:media.playbackRate, resetPitch:media.preservesPitch, tail:tail/(48000*1.4), bassRatio:amplitude(50)/(amplitude(1000)||1), amplitude:amplitude(1000), graphCount, attached:window.__lolzcloudAudioFX.attached, unavailable:window.__lolzcloudAudioFX.unavailable,reason:window.__lolzcloudAudioFX.reason, analysis:window.__lolzcloudGetAudioState().tempo.available, method:window.__lolzcloudGetAudioState().tempo.method, safety:window.__lolzcloudGetAudioState().safety };
  })()`);
}
app.whenReady().then(async () => {
  await session.defaultSession.protocol.handle('https', () => new Response('<html><body>Isolated audio test</body></html>', { headers: { 'Content-Type': 'text/html' } }));
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  try {
    const dry = await render(window, { ...presetSound('Original'), enabled: true });
    const wet = await render(window, presetSound('Slowed + Reverb'));
    const bass = await render(window, presetSound('Bass Boost'));
    const echo = await render(window, presetSound('Echo'));
    const opaque = await render(window, presetSound('Speed Up'), true);
    const sdkDry = await render(window, { ...presetSound('Original'), enabled: true }, false, true);
    const sdkBass = await render(window, presetSound('Bass Boost'), false, true);
    const sdkPreamp=await render(window,{...presetSound('Original'),enabled:true,preampDb:-6},false,true);
    const sdkDisabled=await render(window,presetSound('Original'),false,true);
    const sdkBypass=await render(window,{...presetSound('Original'),enabled:false,preampDb:-12,rate:2},false,true);
    const slow=await render(window,{...presetSound('Original'),enabled:true,rate:.5,preservesPitch:true});
    const fast=await render(window,{...presetSound('Original'),enabled:true,rate:2,preservesPitch:false});
    const original = await render(window, presetSound('Original'), false, true, true);
    const limited = await render(window, presetSound('Original'), false, true, true, {limiter:true,ceilingDb:-9,duckGain:1}, 2);
    const bypassed = await render(window, presetSound('Original'), false, true, true, {limiter:false,ceilingDb:-9,duckGain:1}, .6);
    const ducked = await render(window, presetSound('Original'), false, true, true, {limiter:true,ceilingDb:-3,duckGain:.2});
    const moving = await render(window, presetSound('Original'), false, true, true, {limiter:true,ceilingDb:-3,duckGain:1}, .12, true);
    assert.equal(limited.safety.limiterAvailable, true);
    const ceiling = 10 ** (-9 / 20) * .5;
    assert.ok(limited.peak <= ceiling + 1e-6 && limited.peak > ceiling * .97, 'The loud fixture must remain at the configured digital ceiling after SDK gain: ' + limited.peak);
    assert.ok(bypassed.peak > .29 && Math.abs(bypassed.amplitude / (108 * .6 / .12) - 1) < .01, 'Bypass must preserve the original signal: ' + JSON.stringify({ peak: bypassed.peak, amplitude: bypassed.amplitude, safety: bypassed.safety }));
    assert.ok(Math.abs(ducked.amplitude / original.amplitude - .2) < .01, 'Ducking must affect only its own output gain.');
    assert.ok(moving.ducked > .198 && moving.ducked < .205, 'Ducking attack must settle smoothly: ' + moving.ducked);
    assert.ok(moving.restored > .97 && moving.restored <= 1.001, 'Music must recover without overshoot: ' + moving.restored);
    assert.ok(moving.maxJump < .009, 'Gain changes must not introduce clicks: ' + moving.maxJump); assert.equal(moving.volume, .37);
    assert.equal(original.analysis, true); assert.equal(original.method, 'worklet'); assert.ok(Math.abs(original.amplitude / 108 - 1) < .01, 'Analysis and limiter must preserve the quiet steady-state tone (.12 amplitude × .5 SDK gain). Received ' + original.amplitude);
    assert.equal(sdkDry.graphCount, 1); assert.equal(sdkBass.graphCount, 1); assert.equal(sdkBass.attached, 1); assert.equal(sdkBass.unavailable, false);
    assert.ok(Math.abs(sdkDry.amplitude / dry.amplitude - .5) < .04, 'SoundCloud gain must be preserved without a duplicate audio path.');
    assert.ok(sdkBass.bassRatio > sdkDry.bassRatio * 1.3, 'Effects must process the existing SoundCloud source after reconnecting.');
    assert.ok(Math.abs(sdkPreamp.amplitude/sdkDry.amplitude-10**(-6/20))<.01,'A portable −6dB preamp must attenuate actual SoundCloud PCM.');
    assert.ok(Math.abs(sdkBypass.amplitude/sdkDisabled.amplitude-1)<.01,'Disabled effects must bypass the saved preamp.');assert.equal(sdkBypass.rate,1);assert.equal(sdkPreamp.volume,1);
    assert.equal(slow.rate,.5);assert.equal(slow.pitch,true);assert.equal(fast.rate,2);assert.equal(fast.pitch,false);
    assert.equal(wet.rate, .85); assert.equal(wet.pitch, false); assert.equal(wet.resetRate, 1); assert.equal(wet.resetPitch, true);
    assert.equal(dry.graphCount, 1); assert.equal(wet.graphCount, 1);
    assert.ok(wet.tail > dry.tail + 1e-8, 'Reverb must create an audible decay tail.');
    assert.ok(echo.tail > dry.tail + 1e-8, 'Echo must create delayed repetitions.');
    assert.ok(bass.bassRatio > dry.bassRatio * 1.3, 'Bass Boost must strengthen low frequencies relative to the voice range.');
    assert.equal(opaque.graphCount, 0); assert.equal(opaque.rate, 1.2); assert.equal(opaque.resetRate, 1);
    const localDry=await renderLocal(window,{enabled:true,preampDb:0,gains:[0,0,0,0,0],rate:1},.37),localPreamp=await renderLocal(window,{enabled:true,preampDb:-6,gains:[0,0,0,0,0],rate:2,preservesPitch:true},.37);
    assert.ok(localDry.rms>.02,'Local fixture must render audible PCM through its real graph.');assert.ok(Math.abs(localPreamp.rms/localDry.rms-10**(-6/20))<.005,'Local PCM must use the same portable −6dB preamp.');assert.equal(localPreamp.sources,1);assert.equal(localPreamp.mediaVolume,1);assert.equal(localPreamp.rate,2);assert.equal(localPreamp.pitch,true);assert.equal(localPreamp.resetRate,1);
    await window.loadURL('data:text/html,<html><body></body></html>');
    const cors = await window.webContents.executeJavaScript(`(() => { Function(${JSON.stringify(plugin)})(); const media = new Audio('https://playback.media-streaming.soundcloud.cloud/test.m3u8'); return {mode:media.crossOrigin,attached:window.__lolzcloudAudioFX.attached}; })()`);
    assert.equal(cors.mode, 'anonymous'); assert.equal(cors.attached, 0);
    const earlySession = session.fromPartition('lolzcloud-audio-preload-test');
    await earlySession.protocol.handle('https', () => new Response('<html><head><script>window.firstAudio=new Audio("https://playback.media-streaming.soundcloud.cloud/test.m3u8");window.firstMode=window.firstAudio.crossOrigin;window.remoteNode=typeof require;</script></head><body>Test</body></html>', { headers: { 'Content-Type': 'text/html' } }));
    const early = new BrowserWindow({ show: false, webPreferences: { session: earlySession, preload: path.join(__dirname, '../source/guest-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    await early.loadURL('https://soundcloud.com/lolzcloud-preload-test');
    const earlyState = await early.webContents.executeJavaScript('({mode:window.firstMode,node:window.remoteNode,hook:typeof window.__lolzcloudSetAudioFX})');
    assert.deepEqual(earlyState, { mode: 'anonymous', node: 'undefined', hook: 'function' }); early.destroy();
    console.log('Native Web Audio passed: actual SoundCloud/local −6dB portable preamp and bypass, full .5–2 rate, peak ceiling, smooth duck/recovery without volume changes, AudioWorklet tempo, effects and SoundCloud SDK reconnects.');
    console.log(JSON.stringify({dryTail:dry.tail,reverbTail:wet.tail,echoTail:echo.tail,bassRatioIncrease:bass.bassRatio/dry.bassRatio,soundCloudPreampRatio:sdkPreamp.amplitude/sdkDry.amplitude,localPreampRatio:localPreamp.rms/localDry.rms}));
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error.stack); window.destroy(); app.exit(1); }
});
