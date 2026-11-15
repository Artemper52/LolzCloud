/* Bounded, metadata-only lyric adaptation. Timings are an estimate from full
   recording durations, never an acoustic tempo measurement or word invention. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudLyricTempo=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const FAST='(?:speed[\\s_-]*up|sped[\\s_-]*up|nightcore|ускоренн(?:ая|ый|ое|о)|ускорен(?:ная|ный|ное|о)|спид[\\s_-]*ап|спидап)',SLOW='(?:slow(?:ed)?(?:[\\s_-]*down)?|замедленн(?:ая|ый|ое|о)|замедлен(?:ная|ный|ное|о)|слоуд|слоуед)',SPACE='(?:reverb(?:ed)?|реверб(?:ерация)?|эхо|echo|8d(?:\\s*audio)?)';
  const MARKER=new RegExp('(?<![\\p{L}\\p{N}])(?:('+FAST+')|('+SLOW+')|('+SPACE+'))(?![\\p{L}\\p{N}])','giu');
  const EXPLICIT=/(?:[xх×]\s*(\d(?:[.,]\d{1,3})?)|(\d(?:[.,]\d{1,3})?)\s*[xх×])/giu;
  const norm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[\p{M}\p{Cf}]/gu,'').replace(/[^\p{L}\p{N}]/gu,'');
  function detectVariant(input){
    const raw=typeof input==='string'?input.normalize('NFKC').slice(0,500):'';let faster=false,slower=false,explicitRate=null,conflict=false;
    const unsafe=/(?:\b(?:preview|snippet|fragment|clip|loop|teaser|trimmed|extended|short\s+version|intro\s*(?:cut|removed|skip)|(?:cut|without|no)\s+intro)\b|отрывок|фрагмент|обрезан|тизер|без\s+(?:вступления|интро))/iu.test(raw);
    function strip(value){let touched=false;let text=value.replace(EXPLICIT,(_m,a,b)=>{const rate=Number((a||b).replace(',','.'));touched=true;if(rate<.5||rate>2||explicitRate!==null&&Math.abs(explicitRate-rate)>.001)conflict=true;else explicitRate=rate;return' ';});
      text=text.replace(MARKER,(m,fast,slow)=>{touched=true;faster||=!!fast;slower||=!!slow;return' ';});
      if(touched)text=text.replace(/(?:^|\s)(?:and|version|версия)(?=\s|$)/giu,' ').replace(/[+&|:/_-]+/g,' ').replace(/\s+/g,' ').trim();return{text,touched};
    }
    let title=raw.replace(/\(([^()]*)\)|\[([^\[\]]*)\]/gu,(block,a,b)=>{const clean=strip(a??b);return clean.touched?(clean.text?'('+clean.text+')':' '):block;});
    const tail=new RegExp('(?:^|\\s|[-–—|+_:])(?:(?:'+FAST+'|'+SLOW+'|'+SPACE+')(?:\\s*(?:and|\\+|&|[-_])?\\s*)?)+$','iu');
    for(let i=0;i<4;i++){let changed=false;title=title.replace(/(?:\s|^)(?:[xх×]\s*\d(?:[.,]\d{1,3})?|\d(?:[.,]\d{1,3})?\s*[xх×])\s*$/iu,m=>{strip(m);changed=true;return' ';}).replace(tail,m=>{strip(m);changed=true;return' ';});if(!changed)break;}
    title=title.replace(/\s+/g,' ').replace(/\s*[-–—|+:]\s*$/u,'').trim();
    if(!title||!norm(title))return{title:raw.trim(),marked:false,kind:'none',explicitRate:null,unsafe};
    if(explicitRate!==null){if(explicitRate>1.025)faster=true;else if(explicitRate<.975)slower=true;}
    const kind=faster&&slower||conflict?'mixed':faster?'faster':slower?'slower':'none';
    return{title,marked:faster||slower||explicitRate!==null,kind,explicitRate,unsafe:unsafe||conflict};
  }
  const artists=value=>String(value||'').split(/\s*(?:,|&|\+|\bfeat\.?|\bft\.?|\s[xх×]\s|\band\b)\s*/iu).map(norm).filter(Boolean);
  function sameIdentity(a,b){if(!norm(a?.title)||norm(a.title)!==norm(b?.title))return false;const x=artists(a.artist),y=artists(b?.artist);return x.length>0&&y.length>0&&(x.length<=y.length?x.every(n=>y.includes(n)):y.every(n=>x.includes(n)));}
  const duration=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=86400?n:0;
  function validLines(lines,seconds){return Array.isArray(lines)&&lines.length>0&&lines.length<=3000&&lines.every(l=>l&&Number.isFinite(l.time)&&l.time>=0&&l.time<=seconds+3&&typeof l.text==='string'&&(!('end'in l)||Number.isFinite(l.end)&&l.end>=l.time&&l.end<=seconds+3)&&(!l.words||Array.isArray(l.words)&&l.words.length<=512&&l.words.every(w=>w&&Number.isFinite(w.time)&&w.time>=0&&w.time<=seconds+3&&typeof w.text==='string'&&(!('end'in w)||Number.isFinite(w.end)&&w.end>=w.time&&w.end<=seconds+3))));}
  function adaptTimings(result,{rate,referenceDuration,sourceDuration}={}){
    if(result?.adapted||result?.tempo||!duration(referenceDuration)||!duration(sourceDuration)||!Number.isFinite(rate)||rate<.5||rate>2||Math.abs(referenceDuration/sourceDuration-rate)>.00001||!validLines(result?.lines,referenceDuration))return null;
    const time=n=>Math.round(n/rate*1000)/1000;
    const lines=result.lines.map(line=>({...line,time:time(line.time),...(line.end!==undefined?{end:time(line.end)}:{}),...(line.words?{words:line.words.map(word=>({...word,time:time(word.time),...(word.end!==undefined?{end:time(word.end)}:{})}))}:{})}));
    if(!validLines(lines,sourceDuration))return null;
    return{...result,lines,adapted:true,tempo:{rate,referenceDuration,sourceDuration,method:'duration',estimated:true}};
  }
  function selectRecord(rows,track,{parseLines=()=>[],sameIdentity:match=sameIdentity}={}){
    if(!Array.isArray(rows)||!track||typeof parseLines!=='function')return null;
    const variant=detectVariant(track.variantTitle||track.title),clean=detectVariant(track.title),base={...track,title:clean.title},target=duration(track.duration),candidates=[];let exact=null;
    for(const row of rows.slice(0,50)){
      if(!row||typeof row.trackName!=='string'||typeof row.artistName!=='string')continue;
      const seconds=duration(row.duration),name=detectVariant(row.trackName);if(!seconds)continue;
      let lines=[];if(typeof row.syncedLyrics==='string'&&row.syncedLyrics.length<=120000)try{lines=parseLines(row.syncedLyrics);}catch{}
      const timed=validLines(lines,seconds),plain=typeof row.plainLyrics==='string'?row.plainLyrics.slice(0,60000):timed?lines.map(l=>l.text).join('\n').slice(0,60000):'';
      const value={found:timed||!!plain.trim(),lines:timed?lines:[],plain,source:'LRCLIB',recordId:Number.isSafeInteger(row.id)&&row.id>0?row.id:null,adapted:false,versionMismatch:false,identity:{title:base.title,artist:base.artist}};
      const exactVersion=variant.marked?name.marked&&name.kind===variant.kind&&match({title:name.title,artist:row.artistName},base):match({title:row.trackName,artist:row.artistName},{...track,title:track.title});
      if(target&&Math.abs(seconds-target)<=2.5&&exactVersion&&(timed||row.instrumental===true)){if(!exact||lines.length>exact.lines.length)exact={...value,found:true,instrumental:row.instrumental===true&&!timed&&!plain.trim()};continue;}
      if(!name.marked&&match({title:name.title,artist:row.artistName},base))candidates.push({row,seconds,value,timed});
    }
    if(exact)return exact;
    const usable=candidates.filter(c=>c.value.found);if(!usable.length)return null;
    const written=()=>{const c=usable.find(c=>c.value.plain.trim())||usable[0];return{...c.value,lines:[],plain:c.value.plain||c.value.lines.map(l=>l.text).join('\n'),versionMismatch:true,adapted:false};};
    if(!variant.marked||variant.kind==='mixed'||variant.unsafe||target<20)return written();
    const plausible=candidates.filter(c=>{const rate=c.seconds/target;return c.seconds>=20&&rate>=.5&&rate<=2&&(variant.kind!=='faster'||rate>=1.025)&&(variant.kind!=='slower'||rate<=.975)&&(variant.explicitRate===null||Math.abs(rate-variant.explicitRate)<=Math.max(.025,variant.explicitRate*.03));}).sort((a,b)=>a.seconds-b.seconds);
    if(!plausible.length)return written();
    const groups=[];for(const c of plausible){const group=groups.find(g=>Math.abs(g[0].seconds-c.seconds)<=2.5);if(group)group.push(c);else groups.push([c]);}
    let selected=groups[0],consensus=false;
    if(groups.length!==1){
      // A repeated ID with conflicting durations is one inconsistent row,
      // never independent support for either reference-duration cluster.
      const owners=new Map(),conflicting=new Set();
      for(const group of groups)for(const c of group){const id=c.row.id;if(!Number.isSafeInteger(id)||id<=0)continue;if(owners.has(id)&&owners.get(id)!==group)conflicting.add(id);else owners.set(id,group);}
      const votes=group=>new Set(group.map(c=>c.row.id).filter(id=>Number.isSafeInteger(id)&&id>0&&!conflicting.has(id)));
      const ranked=groups.map(group=>({group,votes:votes(group).size})).sort((a,b)=>b.votes-a.votes);
      const total=new Set(groups.flatMap(group=>[...votes(group)])).size,top=ranked[0];
      if(!top||top.votes<3||top.votes<3*(ranked[1]?.votes||0)||top.votes<total*.4)return written();
      selected=top.group;consensus=true;
    }
    const pick=selected.filter(c=>c.timed).sort((a,b)=>b.value.lines.length-a.value.lines.length||(Number(b.row.id)||0)-(Number(a.row.id)||0))[0];if(!pick)return written();
    const adapted=adaptTimings(pick.value,{rate:pick.seconds/target,referenceDuration:pick.seconds,sourceDuration:target});
    if(adapted&&consensus)adapted.tempo.referenceEvidence='catalog-consensus';return adapted||written();
  }
  return{detectVariant,selectRecord,adaptTimings,sameIdentity};
});
