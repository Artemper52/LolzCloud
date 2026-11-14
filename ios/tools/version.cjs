'use strict';
const fs = require('node:fs'), path = require('node:path');
function versionFromPlist(xml) {
  const values = [...String(xml).matchAll(/<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>([^<]*)<\/string>/g)];
  if (values.length !== 1 || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(values[0][1])) throw Error('Info.plist must contain one numeric X.Y.Z application version.');
  return values[0][1];
}
const version = () => versionFromPlist(fs.readFileSync(path.join(__dirname,'../LolzCloud/Info.plist'),'utf8'));
module.exports = { version, versionFromPlist };
