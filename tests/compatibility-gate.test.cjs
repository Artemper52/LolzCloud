'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { testPackaged } = require('../tools/compatibility-test.cjs');
const marker = 'Compatibility self-test passed: Electron 22.3.27, Node fixture, native renderer.\n';
function run({ stdout = '', stderr = '', code = 0 } = {}) {
  return testPackaged('fixture.exe', { env: {}, expectedElectron: '22.3.27', output: { write() {} }, errorOutput: { write() {} }, spawnProcess: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => { child.stdout.end(stdout); child.stderr.end(stderr); child.emit('exit', code); }); return child;
  } });
}
test('a crashed renderer cannot pass release validation merely because Electron returned zero', async () => {
  await assert.rejects(run({ stderr: 'Compatibility renderer stopped: crashed\n' }));
  await assert.rejects(run({ stdout: marker.replace('22.3.27', '45.2.1') }));
  await assert.rejects(run({ stdout: marker, code: 1 }));
  await run({ stdout: marker });
});
