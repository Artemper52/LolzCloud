/* Plain data policy shared by the web graph, native adapter and tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudEffectsPolicy=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const FREQUENCIES=Object.freeze([60,230,910,3600,14000]);
  const DEFAULT=Object.freeze({enabled:false,gains:Object.freeze([0,0,0,0,0]),preampDb:0,reverb:0,echo:0,normalization:false});
  const PRESETS=Object.freeze({
    original:{label:'Исходный звук',...DEFAULT},
    bass:{label:'Bass Boost',...DEFAULT,enabled:true,gains:[7,4,0,-1,0]},
    deep:{label:'Deep Bass',...DEFAULT,enabled:true,gains:[11,6,-1,-2,-1]},
    vocal:{label:'Чистый вокал',...DEFAULT,enabled:true,gains:[-2,-1,4,3,-1]},
    night:{label:'Ночной',...DEFAULT,enabled:true,gains:[-4,-2,2,0,-3]},
    lofi:{label:'Lo-Fi',...DEFAULT,enabled:true,gains:[2,1,-1,-5,-9],reverb:.12},
    reverb:{label:'Reverb',...DEFAULT,enabled:true,reverb:.4},
    echo:{label:'Echo',...DEFAULT,enabled:true,echo:.32},
  });
  const flags=['eq','preamp','reverb','echo','normalization','pitch'];
  function validate(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT,k)))throw Error('Неверные настройки звука.');
    const result={...DEFAULT,gains:[...DEFAULT.gains]};
    for(const [key,input]of Object.entries(value)){
      if(key==='enabled'||key==='normalization'){if(typeof input!=='boolean')throw Error('Нужен переключатель звука.');}
      else if(key==='gains'){if(!Array.isArray(input)||input.length!==5||input.some(v=>!Number.isFinite(v)||v< -12||v>12))throw Error('Выбери уровни EQ от −12 до +12 дБ.');}
      else if(key==='preampDb'){if(!Number.isFinite(input)||input< -12||input>0)throw Error('Уровень до обработки — от −12 до 0 дБ.');}
      else if(!Number.isFinite(input)||input<0||input>.8)throw Error('Сила эффекта — от 0 до 80%.');
      result[key]=key==='gains'?[...input]:input;
    }
    return result;
  }
  function normalize(value){try{return validate(value);}catch{return validate({});}}
  function nativeConfig(value,schema=1){const c=validate(value);return{enabled:c.enabled,gains:[...c.gains],preampDb:c.preampDb,...(schema===2?{reverb:c.reverb,echo:c.echo,normalization:c.normalization}:{})};}
  function sameNative(a,b){return a&&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')&&Object.keys(b).every(key=>key==='gains'?Array.isArray(a.gains)&&a.gains.length===5&&a.gains.every((v,i)=>v===b.gains[i]):a[key]===b[key]);}
  function preset(key){const value=PRESETS[key];if(!value)throw Error('Неизвестный звуковой профиль.');const{label,...config}=value;return validate(config);}
  function selectedPreset(value,native=false){const config=validate(value);return Object.keys(PRESETS).find(key=>native?sameNative(nativeConfig(config),nativeConfig(preset(key)))&&(!preset(key).reverb&&!preset(key).echo):JSON.stringify(config)===JSON.stringify(preset(key)))||'custom';}
  function nativeAck(value,config,revision,intent,schema=1){
    if(!value||value.clientId!==intent.clientId||value.requestId!==intent.requestId||value.revision!==revision||!sameNative(value.config,nativeConfig(config,schema))||!['pending','applied','bypassed','unsupported'].includes(value.state))return null;
    const capabilities=Object.fromEntries(flags.map(key=>[key,value.capabilities?.[key]===true]));
    const supportedAdvanced=schema!==2||(!config.reverb||capabilities.reverb)&&(!config.echo||capabilities.echo)&&(!config.normalization||capabilities.normalization);
    const applied=value.appliedRevision===revision&&capabilities.eq&&capabilities.preamp&&supportedAdvanced&&Number.isFinite(value.processedFrames)&&value.processedFrames>0&&Number.isFinite(value.sampleRate)&&value.sampleRate>=8000&&value.sampleRate<=384000&&Number.isInteger(value.channels)&&value.channels>=1&&value.channels<=8;
    if(value.state==='applied'&&(!config.enabled||!applied)||value.state==='bypassed'&&config.enabled)return null;
    const meter=value.normalization,normalization=schema===2&&meter&&typeof meter.key==='string'&&typeof meter.enabled==='boolean'&&typeof meter.measured==='boolean'&&Number.isFinite(meter.gainDb)&&Math.abs(meter.gainDb)<=8&&Number.isFinite(meter.targetDb)&&Math.abs(meter.targetDb)<=8&&Number.isFinite(meter.processedFrames)&&meter.processedFrames>=0?{key:meter.key.slice(0,510),enabled:meter.enabled,measured:meter.measured,gainDb:meter.gainDb,targetDb:meter.targetDb,processedFrames:meter.processedFrames,loudness:Number.isFinite(meter.loudness)?meter.loudness:null}:null;
    return{state:value.state,capabilities,appliedRevision:value.state==='applied'&&applied?revision:0,processedFrames:Number.isFinite(value.processedFrames)?Math.max(0,value.processedFrames):0,sampleRate:Number.isFinite(value.sampleRate)?value.sampleRate:0,channels:Number.isInteger(value.channels)?value.channels:0,headroomDb:Number.isFinite(value.headroomDb)?value.headroomDb:0,normalization,peakDb:Number.isFinite(value.peakDb)?value.peakDb:-96,reductionDb:Number.isFinite(value.reductionDb)?Math.max(0,value.reductionDb):0,error:typeof value.error==='string'?value.error.slice(0,300):''};
  }
  return{FREQUENCIES,DEFAULT,PRESETS,validate,normalize,nativeConfig,nativeAck,preset,selectedPreset};
});
