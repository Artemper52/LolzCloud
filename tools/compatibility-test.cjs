'use strict';
const { spawn } = require('node:child_process');
function testPackaged(executable, { env, expectedElectron, spawnProcess = spawn, output = process.stdout, errorOutput = process.stderr }) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedElectron)) throw Error('Expected an exact Electron version.');
  return new Promise((resolve, reject) => {
    let result = '';
    const child = spawnProcess(executable, ['--self-test'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output.write(chunk); result = (result + chunk.toString()).slice(-262144); });
    child.stderr.on('data', chunk => errorOutput.write(chunk));
    child.once('error', reject);
    child.once('exit', code => {
      const marker = 'Compatibility self-test passed: Electron ' + expectedElectron + ',';
      if (code !== 0 || !result.split(/\r?\n/).some(line => line.startsWith(marker))) reject(new Error('Native compatibility self-test failed or did not confirm success: ' + code));
      else resolve();
    });
  });
}
module.exports = { testPackaged };
