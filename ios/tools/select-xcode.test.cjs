'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{candidates,version}=require('./select-xcode.cjs');
test('a stable supported Xcode is selected numerically without accepting beta or old SDK names',()=>{
 const selected=candidates(['Xcode.app','Xcode_16.4.app','Xcode_26.9.app','Xcode_26.10.app','Xcode_27.0-beta.app','Xcode_27.0-RC.app','Xcode_26.3.1.app','Xcode_26.3.app.backup']);
 assert.deepEqual(selected.map(row=>row.name),['Xcode_26.10.app','Xcode_26.9.app','Xcode_26.3.1.app']);
 assert.deepEqual(candidates(['Xcode_16.4.app']),[]);
});
test('Xcode SDK versions reject nonnumeric or incomplete values before a build can claim distribution readiness',()=>{
 for(const input of ['','26beta','26.0.1.2','latest','../26','26\n27'])assert.equal(version(input),null);
 assert.deepEqual(version('26'),[26,0,0]);assert.deepEqual(version('26.2.1'),[26,2,1]);
});
