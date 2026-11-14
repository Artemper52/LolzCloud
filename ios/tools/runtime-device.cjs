'use strict';
function chooseDevice(types,family='iphone') {
  if(!['iphone','ipad'].includes(family))throw Error('Choose iphone or ipad as the runtime device family.');
  if(!Array.isArray(types))throw Error('Missing simulator device types.');
  const prefix=family==='ipad'?'iPad':'iPhone';
  const choices=types.filter(type=>typeof type?.name==='string'&&type.name.startsWith(prefix)&&typeof type.identifier==='string'&&type.identifier.startsWith('com.apple.CoreSimulator.SimDeviceType.'));
  const preferred=family==='ipad'?choices.find(type=>/^iPad Pro.*11.*M4/.test(type.name)):choices.find(type=>type.identifier==='com.apple.CoreSimulator.SimDeviceType.iPhone-16');
  const selected=preferred||choices.at(-1);
  if(!selected)throw Error('No compatible '+prefix+' simulator device type.');
  return selected;
}
module.exports={chooseDevice};
