'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{chooseDevice}=require('./runtime-device.cjs');
const device=(name,id)=>({name,identifier:'com.apple.CoreSimulator.SimDeviceType.'+id});
test('the iPad runtime test cannot silently run on an iPhone or a non-Apple device entry',()=>{
 const types=[device('iPhone 16','iPhone-16'),device('iPad Pro 11-inch (M4)','iPad-Pro-11-M4'),device('iPad mini (A17 Pro)','iPad-mini-A17')];
 assert.equal(chooseDevice(types,'ipad').name,'iPad Pro 11-inch (M4)');assert.equal(chooseDevice(types,'iphone').name,'iPhone 16');
 assert.throws(()=>chooseDevice([types[0]],'ipad'),/No compatible iPad/);
 assert.throws(()=>chooseDevice([{name:'iPad Pro',identifier:'external-untrusted'}],'ipad'),/No compatible/);
 assert.throws(()=>chooseDevice(types,'ipad-unchecked'),/Choose iphone or ipad/);
});
test('available devices in the requested family remain usable when preferred hardware is absent',()=>{
 assert.equal(chooseDevice([device('iPhone 17','iPhone-17')],'iphone').name,'iPhone 17');
 assert.equal(chooseDevice([device('iPad Air','iPad-Air')],'ipad').name,'iPad Air');
});
