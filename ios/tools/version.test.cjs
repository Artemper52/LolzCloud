'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { version, versionFromPlist } = require('./version.cjs');
test('iOS artifact version follows the bundle version without a hardcoded release number', () => {
  for (const value of ['0.1.0','0.1.1','2.12.345']) assert.equal(versionFromPlist('<plist><dict><key>CFBundleShortVersionString</key><string>'+value+'</string></dict></plist>'),value);
  assert.match(version(),/^\d+\.\d+\.\d+$/);
});
test('invalid or duplicate versions cannot become artifact paths', () => {
  for (const value of ['../../other','0.1.1/bad','0.1.1<bad>','0.1.1-beta','']) assert.throws(() => versionFromPlist('<key>CFBundleShortVersionString</key><string>'+value+'</string>'));
  assert.throws(() => versionFromPlist(''));
  assert.throws(() => versionFromPlist('<key>CFBundleShortVersionString</key><string>0.1.1</string><key>CFBundleShortVersionString</key><string>0.1.2</string>'));
});
