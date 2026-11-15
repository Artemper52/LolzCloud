(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudWaveHistory=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const DAY=24*60*60*1000;
 function sourceURL(value){try{const url=new URL(value);if(url.protocol!=='https:'||!['soundcloud.com','www.soundcloud.com'].includes(url.hostname)||url.username||url.password)return '';const parts=url.pathname.split('/').filter(Boolean);return parts.length>=2&&parts.every(part=>/^[\w-]+$/.test(part))?'https://soundcloud.com/'+parts.join('/'):'';}catch{return '';}}
 function recordingKey(track){const artist=String(track?.artist||track?.user?.username||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),title=String(track?.title||'').normalize('NFKC').toLowerCase().replace(/\b(?:official|audio|video|lyrics?|visualizer|hd|hq)\b/giu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();return artist&&title?'recording:'+artist+':'+title:'';}
 async function fingerprints(track){const values=[],url=sourceURL(track?.url||track?.permalink_url),id=Number(track?.id);if(url)values.push('url:'+url);if(Number.isSafeInteger(id)&&id>0)values.push('id:'+id);const recording=recordingKey(track);if(recording)values.push(recording);return Promise.all(values.map(async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('')));}
 function prunePlayed(value,now=Date.now()){return Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([key,at])=>/^[a-f0-9]{64}$/.test(key)&&Number.isFinite(at)&&at>now-DAY&&at<=now+DAY));}
 async function playedRecently(track,cache,now=Date.now()){return (await fingerprints(track)).some(key=>Number.isFinite(cache[key])&&cache[key]>now-DAY);}
 async function markPlayed(track,cache,now=Date.now()){for(const key of await fingerprints(track))cache[key]=now;return cache;}
 return {DAY,fingerprints,prunePlayed,playedRecently,markPlayed};
});
