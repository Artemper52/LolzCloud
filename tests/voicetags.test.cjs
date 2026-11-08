'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Voicetags } = require('../source/integrations/voicetags.cjs');
test('voicetags reject changed remote bytes and unsafe identifiers, while volume survives restarting', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'LolzCloud-tags-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Voicetags(dir, async () => new Response('a changed sound'));
  await assert.rejects(library.prepare('prince'), /изменился/);
  assert.equal(fs.existsSync(path.join(dir, 'prince.mp3')), false);
  await assert.rejects(library.prepare('../secret'), /не найден/);
  library.volume(.35); assert.equal(new Voicetags(dir).state().volume, .35);
  assert.throws(() => library.volume(1.5));
});
