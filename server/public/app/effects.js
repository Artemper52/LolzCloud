/* One optional processing graph for the personal media element. Native audio
   stays in AVPlayer: the native branch only sends settings and validates ACKs. */
(function(root,factory){const policy=typeof module==='object'&&module.exports?require('./effects-policy.js'):root.LolzCloudEffectsPolicy;const api=factory(root,policy);if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudEffects=api;})(typeof globalThis==='object'?globalThis:this,function(root,P){
  'use strict';
  const moduleLoads=new WeakMap();
  const WEB_CAPABILITIES=Object.freeze({eq:true,preamp:true,reverb:true,echo:true,normalization:true,pitch:false});
  const NO_CAPABILITIES=Object.freeze({eq:false,preamp:false,reverb:false,echo:false,normalization:false,pitch:false});
  async function createGraph(context,{onMeter=()=>{},baseURL=root.location?.href}={}){
    if(!context.audioWorklet||typeof root.AudioWorkletNode!=='function')throw Error('В этом браузере обработка звука недоступна.');
    let modules=moduleLoads.get(context);
    if(!modules){modules=Promise.all(['normalization-worklet.js','limiter-worklet.js'].map(name=>context.audioWorklet.addModule(new URL('/app/'+name,baseURL).href))).catch(error=>{moduleLoads.delete(context);throw error;});moduleLoads.set(context,modules);}
    await modules;
    const input=context.createGain(),bypass=context.createGain(),processed=context.createGain(),output=context.createGain();
    const normalizer=new root.AudioWorkletNode(context,'lolzcloud-normalization',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
    const filters=P.FREQUENCIES.map((frequency,i)=>{const filter=context.createBiquadFilter();filter.type=i===0?'lowshelf':i===4?'highshelf':'peaking';filter.frequency.value=Math.min(frequency,context.sampleRate*.49);filter.Q.value=1;return filter;});
    const headroom=context.createGain(),dry=context.createGain(),wet=context.createGain(),echo=context.createGain(),feedback=context.createGain(),delay=context.createDelay(1),convolver=context.createConvolver(),mix=context.createGain();
    const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*1.2),context.sampleRate);let seed=143;
    for(let channel=0;channel<2;channel++){const samples=impulse.getChannelData(channel);for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(seed/2**31-1)*(1-i/samples.length)**3;}}
    convolver.buffer=impulse;delay.delayTime.value=.28;wet.gain.value=echo.gain.value=feedback.gain.value=0;processed.gain.value=0;
    const limiter=new root.AudioWorkletNode(context,'lolzcloud-limiter',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',parameterData:{ceilingDb:-3}});
    input.connect(bypass);bypass.connect(output);input.connect(normalizer);normalizer.connect(filters[0]);filters.forEach((filter,i)=>filter.connect(filters[i+1]||headroom));
    headroom.connect(dry);dry.connect(mix);headroom.connect(convolver);convolver.connect(wet);wet.connect(mix);headroom.connect(delay);delay.connect(echo);echo.connect(mix);delay.connect(feedback);feedback.connect(delay);mix.connect(limiter);limiter.connect(processed);processed.connect(output);
    normalizer.port.onmessage=event=>onMeter({kind:'normalization',...event.data});limiter.port.onmessage=event=>onMeter({kind:'limiter',...event.data});
    let config=P.normalize({}),track='',cachedGain=0,bypassConnected=true;
    const set=(parameter,value,immediate)=>{const now=context.currentTime;parameter.cancelScheduledValues(now);if(immediate)parameter.setValueAtTime(value,now);else parameter.setTargetAtTime(value,now,.025);};
    const graph={input,output,filters,normalizer,limiter,headroom,convolver,delay,
      apply(value,immediate=false){config=P.validate(value);if(config.enabled&&bypassConnected){input.disconnect(bypass);bypassConnected=false;}else if(!config.enabled&&!bypassConnected){input.connect(bypass);bypassConnected=true;}set(bypass.gain,config.enabled?0:1,immediate);set(processed.gain,config.enabled?1:0,immediate);filters.forEach((filter,i)=>set(filter.gain,config.gains[i],immediate));set(headroom.gain,10**((config.preampDb-Math.max(0,...config.gains))/20),immediate);set(dry.gain,Math.cos(config.reverb*Math.PI/2),immediate);set(wet.gain,Math.sin(config.reverb*Math.PI/2)*.7,immediate);set(echo.gain,config.echo*.6,immediate);set(feedback.gain,config.echo*.55,immediate);normalizer.port.postMessage({enabled:config.enabled&&config.normalization,key:track,gainDb:cachedGain});},
      track(id,gainDb=0){track=String(id||'').slice(0,100);cachedGain=Number.isFinite(gainDb)?Math.max(-8,Math.min(8,gainDb)):0;normalizer.port.postMessage({enabled:config.enabled&&config.normalization,key:track,gainDb:cachedGain});},
      volume(value,immediate=false){set(output.gain,Math.max(0,Math.min(1,Number(value)||0)),immediate);},
      disconnect(){for(const node of [input,bypass,processed,output,normalizer,...filters,headroom,dry,wet,echo,feedback,delay,convolver,mix,limiter])try{node.disconnect();}catch{}normalizer.port.onmessage=limiter.port.onmessage=null;normalizer.port.close();limiter.port.close();},
    };
    graph.apply(config,true);return graph;
  }
  function createController({audio,native=false,sendNative=()=>{},intent=()=>({}),wantedPlayback=()=>!audio.paused,onState=()=>{},onInterrupted=()=>{},storage=root.localStorage}={}){
    if(!audio)throw Error('Нужен источник аудио.');
    let config=P.normalize({}),gains={};
    try{config=P.normalize(JSON.parse(storage?.getItem('LolzCloud-effects-v1')||'{}'));}catch{}
    try{for(const[key,row]of Object.entries(JSON.parse(storage?.getItem('LolzCloud-effects-gains-v1')||'{}')).slice(-500))if(/^(?:[1-9][0-9]{0,15}|local:[a-f0-9-]{36})$/.test(key)&&Number.isFinite(row?.gainDb)&&Math.abs(row.gainDb)<=8)gains[key]={gainDb:row.gainDb,at:Number(row.at)||0};}catch{}
    let revision=1,nativeSchema=1,context=null,graph=null,source=null,building=null,sourceId='',volume=Number.isFinite(audio.volume)?audio.volume:1,lastNativeKey='',nativeTimer,lastMeterAt=0,lastGainSave=0,framesBeforeRevision=0,disposed=false;
    const supported=!native&&typeof(root.AudioContext||root.webkitAudioContext)==='function'&&typeof root.AudioWorkletNode==='function';
    let value={state:native?'pending':config.enabled?'pending':'bypassed',capabilities:native?{...NO_CAPABILITIES}:supported?{...WEB_CAPABILITIES}:{...NO_CAPABILITIES},appliedRevision:0,processedFrames:0,sampleRate:0,channels:0,headroomDb:0,error:'',normalization:null,peakDb:-96,reductionDb:0};
    function snapshot(){return{...value,config:P.validate(config),revision,effectsSchema:native?nativeSchema:2,engine:native?'native':'web',graphCreated:!!source,contextState:context?.state||'none',sourceId};}
    function emit(){if(!disposed)onState(snapshot());}
    function save(){try{storage?.setItem('LolzCloud-effects-v1',JSON.stringify(config));}catch{value.error='Настройки звука не сохранены: проверь свободное место.';}}
    function webState(){
      if(native)return;
      if(!config.enabled){value.state='bypassed';value.appliedRevision=0;}
      else if(!supported){value.state='unsupported';value.error='Браузер не поддерживает эту обработку. Играет исходный звук.';}
      else if(source&&context?.state==='running'&&!audio.paused&&value.processedFrames>framesBeforeRevision){value.state='applied';value.appliedRevision=revision;}
      else if(source&&['interrupted','closed'].includes(context?.state)){value.state='interrupted';value.appliedRevision=0;}
      else if(value.state!=='unsupported'&&value.state!=='error'){value.state='pending';value.appliedRevision=0;}
    }
    function meter(data){
      if(data.kind==='normalization'&&data.key===sourceId){value.normalization=data;if(data.measured&&config.enabled&&config.normalization&&Number.isFinite(data.targetDb)&&Math.abs(data.targetDb)<=8&&Date.now()-lastGainSave>20000){lastGainSave=Date.now();gains[sourceId]={gainDb:data.targetDb,at:Date.now()};gains=Object.fromEntries(Object.entries(gains).slice(-500));try{storage?.setItem('LolzCloud-effects-gains-v1',JSON.stringify(gains));}catch{}}}
      if(data.kind==='limiter'){if(Number.isFinite(data.processedFrames))value.processedFrames=Math.max(0,data.processedFrames);if(Number.isFinite(data.peakDb))value.peakDb=data.peakDb;if(Number.isFinite(data.reductionDb))value.reductionDb=data.reductionDb;}
      webState();if(Date.now()-lastMeterAt>500){lastMeterAt=Date.now();emit();}
    }
    async function resumeContext(){
      if(!context||context.state==='running')return;
      let timer;try{await Promise.race([context.resume(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new DOMException('Нажми Play, чтобы восстановить звук.','NotAllowedError')),1800);})]);}finally{clearTimeout(timer);}
      if(context.state!=='running')throw new DOMException('Нажми Play, чтобы восстановить звук.','NotAllowedError');
    }
    async function ensureGraph(){
      if(native||!supported)return false;
      if(source)return true;
      if(building)return building;
      building=(async()=>{
        const Constructor=root.AudioContext||root.webkitAudioContext;context||=new Constructor({latencyHint:'playback'});
        // Resume in the original Play gesture, before asynchronous module loads.
        // Settings changes while paused must leave the context suspended.
        let wakingError;const waking=wantedPlayback()?resumeContext().catch(error=>{wakingError=error;}):null;
        if('audioSession'in(root.navigator||{}))try{root.navigator.audioSession.type='playback';}catch{}
        context.onstatechange=()=>{webState();emit();if(source&&['suspended','interrupted','closed'].includes(context.state)&&!audio.paused)onInterrupted();};
        graph||=await createGraph(context,{onMeter:meter});
        if(disposed||!config.enabled){const unused=context;graph.disconnect();graph=null;context=null;unused.onstatechange=null;void unused.close().catch(()=>{});return false;}
        if(wantedPlayback()){if(waking)await waking;if(wakingError)throw wakingError;await resumeContext();}
        // Build and load all processors first. Until this point direct HTMLAudio
        // remains intact if a module or permission fails.
        graph.track(sourceId,gains[sourceId]?.gainDb);graph.apply(config);graph.volume(volume,true);
        source=context.createMediaElementSource(audio);audio.volume=1;source.connect(graph.input);graph.output.connect(context.destination);value.sampleRate=context.sampleRate;value.channels=2;value.error='';webState();emit();return true;
      })().catch(error=>{value.state=source?'interrupted':'unsupported';value.appliedRevision=0;value.error=source?'Звук прерван. Нажми Play ещё раз.':'Обработка недоступна. Исходный звук сохранён.';if(!source){
        // A failed addModule may remain failed in the worklet module map. No
        // media source has been attached yet, so a fresh context is safe here.
        const failed=context;graph?.disconnect();graph=null;context=null;if(failed){failed.onstatechange=null;void failed.close().catch(()=>{});}
      }emit();if(source)throw error;return false;}).finally(()=>{building=null;});
      return building;
    }
    function syncNativeIntent(){
      if(!native||disposed)return;
      const tag=intent(),key=tag.clientId+':'+tag.requestId+':'+revision;if(key===lastNativeKey)return;lastNativeKey=key;
      clearTimeout(nativeTimer);value.state=config.enabled?'pending':'bypassed';value.appliedRevision=0;value.error='';
      nativeTimer=setTimeout(()=>{value.state='unsupported';value.error='Обработка звука недоступна в этой версии приложения.';emit();},2200);emit();
      sendNative('effects',{config:P.nativeConfig(config,nativeSchema),revision});
    }
    const controller={
      snapshot,
      configure(patch){config=P.validate({...config,...patch});revision++;framesBeforeRevision=value.processedFrames;value.error='';value.appliedRevision=0;save();if(native){syncNativeIntent();return Promise.resolve();}if(graph){graph.apply(config);value.headroomDb=-Math.max(0,...config.gains);webState();emit();}else{webState();emit();}return config.enabled?ensureGraph().then(()=>{}):Promise.resolve();},
      syncNativeIntent,
      capabilities(message){if(!native||message?.effectsSchema!==2||nativeSchema===2)return false;const tag=intent();if(message.clientId!==tag.clientId||message.requestId!==tag.requestId)return false;nativeSchema=2;revision++;syncNativeIntent();return true;},
      receiveNative(message){if(!native)return false;const ack=P.nativeAck(message,config,revision,intent(),nativeSchema);if(!ack)return false;clearTimeout(nativeTimer);value={...value,...ack,normalization:ack.normalization?.key===sourceId?ack.normalization:null};emit();return true;},
      track(id){sourceId=String(id||'').slice(0,100);value.processedFrames=0;value.normalization=null;if(graph)graph.track(sourceId,gains[sourceId]?.gainDb);webState();emit();},
      prime(){if(native)return;if(source&&wantedPlayback())void resumeContext().catch(()=>{});else if(config.enabled)void ensureGraph().catch(()=>{});},
      async beforePlay(){if(native)return;if(config.enabled)await ensureGraph();if(source){await resumeContext();webState();emit();}},
      volume(next){volume=Math.max(0,Math.min(1,Number(next)||0));if(native)return;if(source)graph.volume(volume);else audio.volume=volume;},
      async dispose(){disposed=true;clearTimeout(nativeTimer);if(native)return;source?.disconnect();graph?.disconnect();if(context&&context.state!=='closed')await context.close();},
    };
    if(!native)for(const name of ['playing','pause','ended'])audio.addEventListener(name,()=>{webState();emit();});
    return controller;
  }
  return{createGraph,createController};
});
