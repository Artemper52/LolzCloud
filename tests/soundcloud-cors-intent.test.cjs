'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../source/plugins/sound-effects.js'),'utf8');
function fixture(youtube=false){
  class Media extends EventTarget{
    constructor(tag='AUDIO'){super();Object.assign(this,{tagName:tag,paused:true,readyState:0,duration:120,currentTime:42,volume:1,error:null,playbackRate:1,playCalls:0,loadCalls:0,crossOrigin:null,address:''});}
    get src(){return this.address;}set src(value){this.address=String(value);}
    play(){this.playCalls++;this.paused=false;return Promise.resolve();}
    pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
    load(){this.loadCalls++;this.currentTime=0;if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
    removeAttribute(name){if(name==='crossorigin')this.crossOrigin=null;}
    setAttribute(name,value){if(name==='src')this.address=String(value);}
  }
  class AudioNode{connect(){}disconnect(){}}
  const document={documentElement:{},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement:name=>new Media(name.toUpperCase())},window={__lolzcloudYouTube:youtube,Audio:Media};
  vm.runInNewContext(source,{window,document,AudioNode,HTMLMediaElement:Media,URL,location:{origin:youtube?'https://music.youtube.com':'https://soundcloud.com',href:'https://soundcloud.com/fixture/test'},MutationObserver:class{observe(){}},setTimeout(){},setInterval(){},console});
  const media=youtube?document.createElement('video'):new window.Audio();media.src='https://cf-media.sndcdn.com/fixture.mp3';
  return{window,media,error(){media.error={code:4};media.dispatchEvent(new Event('error'));assert.equal(window.__lolzcloudAudioFX.reason,'cors-fallback');},metadata(){media.dispatchEvent(new Event('loadedmetadata'));}};
}
for(const youtube of[false,true]){const label=youtube?'YouTube video':'SoundCloud audio';
  test(label+': CORS fallback resumes current wanted playback and restores its position',async()=>{const f=fixture(youtube);await f.media.play();f.error();assert.equal(f.media.paused,true);f.metadata();assert.equal(f.media.playCalls,2);assert.equal(f.media.paused,false);assert.equal(f.media.currentTime,42);});
  test(label+': a pause before a late CORS failure never restarts playback',async()=>{const f=fixture(youtube);await f.media.play();f.media.pause();f.error();f.metadata();assert.equal(f.media.paused,true);assert.equal(f.media.playCalls,1);});
  test(label+': a pause while fallback metadata is pending fences both resume and old seek',async()=>{const f=fixture(youtube);await f.media.play();f.error();f.media.pause();f.media.currentTime=7;f.metadata();assert.equal(f.media.paused,true);assert.equal(f.media.playCalls,1);assert.equal(f.media.currentTime,7);});
  test(label+': a newer play intent owns the same source and is not restarted or reseeked by old metadata',async()=>{const f=fixture(youtube);await f.media.play();f.error();await f.media.play();f.media.currentTime=13;f.metadata();assert.equal(f.media.playCalls,2);assert.equal(f.media.currentTime,13);});
  test(label+': source A→B→A does not revive a previous fallback operation',async()=>{const f=fixture(youtube);await f.media.play();const original=f.media.src;f.error();f.media.src='https://cf-media.sndcdn.com/second.mp3';f.media.setAttribute('src',original);f.media.currentTime=19;f.metadata();assert.equal(f.media.playCalls,1);assert.equal(f.media.paused,true);assert.equal(f.media.currentTime,19);});
  test(label+': an ended item cannot be restarted by a later source error',async()=>{const f=fixture(youtube);await f.media.play();f.media.paused=true;f.media.dispatchEvent(new Event('ended'));f.error();f.metadata();assert.equal(f.media.playCalls,1);assert.equal(f.media.paused,true);});
}
