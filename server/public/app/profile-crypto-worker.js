/* The MIT License (MIT)

Copyright (c) 2016 Richard Moore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
/* Desktop-compatible scrypt (N=16384,r=8,p=1) + AES-256-GCM. Password bytes
   intentionally use raw UTF-8, matching existing Node profiles, without NFKC. */
(function(root){
  'use strict';
  const node=typeof module==='object'&&module.exports;
  if(!node)importScripts('/app/vendor-scrypt-3.0.1.js');
  const kdf=node?require('./vendor-scrypt-3.0.1.js'):root.scrypt;
  const crypto=root.crypto||node&&require('node:crypto').webcrypto,MAX=750000;
  const utf8=new TextEncoder(),base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
  function fail(code){const error=Error(code);error.code=code;throw error;}
  function decode(value,maximum,exact){
    if(typeof value!=='string'||value.length>Math.ceil(maximum/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('FORMAT');
    const bytes=Uint8Array.from(atob(value),character=>character.charCodeAt(0));
    if(bytes.length>maximum||exact&&bytes.length!==exact||base64(bytes)!==value)fail('FORMAT');return bytes;
  }
  function envelope(value){
    if(!value||value.version!==1||Object.keys(value).some(key=>!['version','salt','iv','tag','ciphertext'].includes(key)))fail('FORMAT');
    return{salt:decode(value.salt,16,16),iv:decode(value.iv,12,12),tag:decode(value.tag,16,16),ciphertext:decode(value.ciphertext,MAX)};
  }
  function profile(value){
    if(!value||value.format!=='lolzcloud-profile'||value.version!==1)fail('FORMAT');
    const bytes=utf8.encode(JSON.stringify(value));if(bytes.length>MAX)fail('SIZE');return bytes;
  }
  async function execute(job,progress=()=>{}){
    if(!job||!['encrypt','decrypt'].includes(job.operation)||typeof job.passphrase!=='string'||job.passphrase.length<10||job.passphrase.length>256)fail('PASSWORD_LENGTH');
    if(!crypto?.subtle||!kdf?.scrypt)fail('UNSUPPORTED');
    const input=job.operation==='encrypt'?profile(job.profile):null,wrapped=job.operation==='decrypt'?envelope(job.envelope):null;
    const salt=wrapped?.salt||crypto.getRandomValues(new Uint8Array(16)),iv=wrapped?.iv||crypto.getRandomValues(new Uint8Array(12)),password=utf8.encode(job.passphrase);
    let material;
    try{
      material=await kdf.scrypt(password,salt,16384,8,1,32,progress);
      const key=await crypto.subtle.importKey('raw',material,'AES-GCM',false,[job.operation]);material.fill(0);password.fill(0);
      if(job.operation==='encrypt'){
        const sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128},key,input));
        return{version:1,salt:base64(salt),iv:base64(iv),tag:base64(sealed.subarray(-16)),ciphertext:base64(sealed.subarray(0,-16))};
      }
      const sealed=new Uint8Array(wrapped.ciphertext.length+16);sealed.set(wrapped.ciphertext);sealed.set(wrapped.tag,wrapped.ciphertext.length);
      let plain;
      try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,tagLength:128},key,sealed));}catch{fail('DECRYPT');}
      try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));profile(value);return value;}catch{fail('DECRYPT');}finally{plain?.fill(0);}
    }finally{material?.fill(0);password.fill(0);input?.fill(0);}
  }
  if(node){module.exports={execute,envelope,maximumBytes:MAX};return;}
  let active=false;
  root.onmessage=async event=>{
    const job=event.data;if(active||!job||typeof job.id!=='string'||!/^[-a-f0-9]{36}$/.test(job.id))return;active=true;
    try{const value=await execute(job,value=>root.postMessage({id:job.id,progress:value}));root.postMessage({id:job.id,value});}
    catch(error){root.postMessage({id:job.id,error:['FORMAT','SIZE','PASSWORD_LENGTH','UNSUPPORTED','DECRYPT'].includes(error.code)?error.code:'CRYPTO'});}
    finally{active=false;}
  };
})(globalThis);
