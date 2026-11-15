/* Bounded local tags only; audio validity/duration are checked by the media probe.
   ID3: https://id3.org/id3v2.3.0 / id3v2.4.0-structure / ID3v1
   FLAC Vorbis comments: https://www.rfc-editor.org/rfc/rfc9639.html */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudAudioMetadata=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const MAX_PREFIX=262144,MAX_TEXT=16384,MAX_ENTRIES=128,TIMEOUT=2000;
  const clean=(value,max)=>String(value||'').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,max);
  const ascii=(data,start,length)=>String.fromCharCode(...data.subarray(start,start+length));
  function integer(data,at,little=false){if(at<0||at+4>data.length)return NaN;return new DataView(data.buffer,data.byteOffset+at,4).getUint32(0,little);}
  function synchsafe(data,at){if(at<0||at+4>data.length||data.subarray(at,at+4).some(byte=>byte&128))return NaN;return data[at]*2097152+data[at+1]*16384+data[at+2]*128+data[at+3];}
  function unsync(data){const output=new Uint8Array(data.length);let length=0;for(let i=0;i<data.length;i++){output[length++]=data[i];if(data[i]===255&&data[i+1]===0)i++;}return output.subarray(0,length);}
  function decode(data,encoding){
    if(!data.length||data.length>MAX_TEXT)return'';
    try{
      if(encoding===0){let value='';for(const byte of data)value+=String.fromCharCode(byte);return value;}
      if(encoding===1){if(data.length<2)return'';const name=data[0]===255&&data[1]===254?'utf-16le':data[0]===254&&data[1]===255?'utf-16be':'';if(!name||(data.length-2)%2)return'';return new TextDecoder(name,{fatal:true}).decode(data.subarray(2));}
      if(encoding===2){if(data.length%2)return'';return new TextDecoder('utf-16be',{fatal:true}).decode(data);}
      return encoding===3?new TextDecoder('utf-8',{fatal:true}).decode(data):'';
    }catch{return'';}
  }
  function id3(prefix){
    const result={};if(prefix.length<10||ascii(prefix,0,3)!=='ID3'||![3,4].includes(prefix[3])||prefix[4]===255)return result;
    const version=prefix[3],flags=prefix[5],declared=synchsafe(prefix,6);if(!Number.isFinite(declared)||(flags&(version===3?31:15)))return result;
    let body=prefix.subarray(10,Math.min(prefix.length,10+declared));if(version===3&&(flags&128))body=unsync(body);
    let at=0;if(flags&64){const size=version===4?synchsafe(body,0):integer(body,0);at=version===4?size:size+4;if(!Number.isFinite(size)||size<6||at>body.length)return result;}
    for(let count=0;count<MAX_ENTRIES&&at+10<=body.length;count++){
      const name=ascii(body,at,4),size=version===4?synchsafe(body,at+4):integer(body,at+4),format=body[at+9];
      if(!/^[A-Z0-9]{4}$/.test(name)||!Number.isFinite(size)||size<1||at+10+size>body.length)break;
      let payload=body.subarray(at+10,at+10+size);at+=10+size;
      if(!['TIT2','TPE1'].includes(name)||size>MAX_TEXT+8||format&(version===3?223:188))continue;
      if(version===4&&((flags&128)||(format&2)))payload=unsync(payload);
      if(format&(version===3?32:64))payload=payload.subarray(1);
      if(version===4&&(format&1)){const length=synchsafe(payload,0);if(!Number.isFinite(length)||length!==payload.length-4)continue;payload=payload.subarray(4);}
      if(payload.length<2)continue;const field=name==='TIT2'?'title':'artist',value=clean(decode(payload.subarray(1),payload[0]).split('\0')[0],field==='title'?300:200);
      if(value&&!result[field])result[field]=value;if(result.title&&result.artist)break;
    }
    return result;
  }
  function flac(prefix){
    const result={};if(ascii(prefix,0,4)!=='fLaC')return result;
    for(let at=4,count=0;count<MAX_ENTRIES&&at+4<=prefix.length;count++){
      const last=!!(prefix[at]&128),type=prefix[at]&127,size=prefix[at+1]*65536+prefix[at+2]*256+prefix[at+3],start=at+4,end=start+size;
      if(end>prefix.length)break;
      if(type===4){
        let cursor=start;const vendor=integer(prefix,cursor,true);cursor+=4;if(!Number.isFinite(vendor)||cursor+vendor+4>end)break;cursor+=vendor;
        const entries=integer(prefix,cursor,true);cursor+=4;
        for(let i=0;i<Math.min(entries,MAX_ENTRIES)&&cursor+4<=end;i++){
          const length=integer(prefix,cursor,true);cursor+=4;if(!Number.isFinite(length)||cursor+length>end)break;
          if(length>0&&length<=MAX_TEXT){const text=decode(prefix.subarray(cursor,cursor+length),3),separator=text.indexOf('='),key=text.slice(0,separator).toUpperCase(),field=key==='TITLE'?'title':key==='ARTIST'?'artist':'';if(separator>0&&field&&!result[field]){const value=clean(text.slice(separator+1),field==='title'?300:200);if(value)result[field]=value;}}
          cursor+=length;if(result.title&&result.artist)break;
        }
      }
      if(last||result.title&&result.artist)break;at=end;
    }
    return result;
  }
  function parse(prefix,tail=new Uint8Array()){
    if(!(prefix instanceof Uint8Array)||prefix.length>MAX_PREFIX||!(tail instanceof Uint8Array)||tail.length>128)return Object.freeze({});
    const isFlac=ascii(prefix,0,4)==='fLaC',result=isFlac?flac(prefix):id3(prefix),mp3=ascii(prefix,0,3)==='ID3'||prefix[0]===255&&(prefix[1]&224)===224;
    if(mp3&&tail.length===128&&ascii(tail,0,3)==='TAG')for(const[field,start]of[['title',3],['artist',33]])if(!result[field]){const value=clean(decode(tail.subarray(start,start+30),0).split('\0')[0],field==='title'?300:200);if(value)result[field]=value;}
    return Object.freeze(result);
  }
  function read(file,{signal}={}){
    return new Promise(resolve=>{
      let closed=false;const finish=value=>{if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);},abort=()=>finish(Object.freeze({}));
      const timer=setTimeout(abort,TIMEOUT);if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
      (async()=>{
        if(!file||typeof file.slice!=='function'||!Number.isSafeInteger(file.size)||file.size<=0)return finish(Object.freeze({}));
        const prefix=new Uint8Array(await file.slice(0,Math.min(file.size,MAX_PREFIX)).arrayBuffer());if(closed)return;
        const value=parse(prefix),mp3=ascii(prefix,0,3)==='ID3'||prefix[0]===255&&(prefix[1]&224)===224;
        if(!mp3||value.title&&value.artist||file.size<128)return finish(value);
        const tail=new Uint8Array(await file.slice(file.size-128,file.size).arrayBuffer());if(closed)return;finish(parse(prefix,tail));
      })().catch(()=>finish(Object.freeze({})));
    });
  }
  return Object.freeze({read,parse,MAX_PREFIX,TIMEOUT});
});
