'use strict';
const fs = require('node:fs'), path = require('node:path');
function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.tmp';
  const file = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(file, JSON.stringify(value, null, 2)); fs.fsyncSync(file); }
  finally { fs.closeSync(file); }
  fs.renameSync(temporary, filename);
}
module.exports = { writeJson };
