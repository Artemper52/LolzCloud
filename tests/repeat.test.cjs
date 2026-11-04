'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { RepeatIntent, nextRepeat } = require('../source/integrations/repeat-intent.cjs');
test('repeat intent preserves the chosen mode through stale snapshots and rapid clicks', () => {
  let now = 1000; const intent = new RepeatIntent(() => now), track = { url: 'https://soundcloud.com/a/b', repeat: 'off' };
  assert.equal(intent.choose(track), 'all'); assert.deepEqual(intent.read(track), { mode: 'all' });
  assert.equal(intent.choose(track), 'one'); assert.equal(intent.choose(track), 'off');
  intent.choose(track, 'one'); now += 100; assert.equal(intent.read({ ...track, repeat: 'all' }).mode, 'one');
  assert.equal(intent.read({ ...track, repeat: 'one' }).mode, 'one'); now += 500;
  assert.equal(intent.read(track).mode, 'one'); now += 100; intent.read({ ...track, repeat: 'one' }); now += 751;
  assert.equal(intent.read({ ...track, repeat: 'one' }), null);
  intent.choose(track, 'all'); assert.equal(intent.read({ ...track, url: track.url + '-next' }), null);
  assert.throws(() => intent.choose(track, 'bad')); assert.equal(nextRepeat('one'), 'off');
});
function guest({ order = ['off', 'one', 'all'], delay = 2, absent = false } = {}) {
  let mode = 'off', clicks = 0, snapshots = 0;
  const node = { getAttribute: () => null, classList: { contains: name => name === 'm-' + (mode === 'off' ? 'none' : mode) }, click() { clicks++; setTimeout(() => { mode = order[(order.indexOf(mode) + 1) % order.length]; }, delay); } };
  const window = { __lolzcloudSnapshot() { snapshots++; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/plugins/repeat-control.js'), 'utf8'), { window, document: { querySelector: () => absent ? null : node }, setTimeout });
  return { api: window.__lolzcloudRepeat, clicks: () => clicks, snapshots: () => snapshots };
}
test('guest applies explicit repeat modes regardless of SoundCloud native cycle order', async () => {
  for (const order of [['off', 'one', 'all'], ['off', 'all', 'one']]) {
    const value = guest({ order });
    for (const mode of ['all', 'one', 'off']) { const result = await value.api.set(mode); assert.equal(result.applied, true); assert.equal(value.api.read(), mode); }
    assert.ok(value.snapshots() >= 3);
  }
});
test('guest coalesces quick requests and does not swallow a command after an already-satisfied mode', async () => {
  const value = guest({ delay: 65 });
  await Promise.all([value.api.set('off'), value.api.set('one'), value.api.set('all')]);
  assert.equal(value.api.read(), 'all'); assert.equal(value.clicks(), 2);
  const old = value.api.set('one'); setTimeout(() => value.api.set('off'), 25); await old;
  assert.equal(value.api.read(), 'off');
  assert.equal((await guest({ absent: true }).api.set('all')).applied, false);
});
