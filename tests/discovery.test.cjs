'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fetchClientId } = require('../source/integrations/soundcloud-client.cjs');
const { SoundCloudDiscovery } = require('../source/integrations/discovery.cjs');
const key = 'gZ7q'.repeat(8);

test('catalogue bootstrap tolerates changed script attributes and a failed asset without contacting untrusted hosts', async () => {
  const calls = [];
  const value = await fetchClientId(async (url, options) => {
    calls.push(url); assert.ok(options.signal); assert.equal(options.redirect, 'error');
    if (url === 'https://soundcloud.com/') return new Response(`<script defer src='//a-v2.sndcdn.com/assets/working.js'></script><script src="https://evil.test/external.js"></script><script crossorigin="anonymous" src="https://a-v2.sndcdn.com/assets/missing.js"></script>`);
    if (url.endsWith('/missing.js')) throw new Error('Network disconnected while loading an asset.');
    return new Response('window.publicConfig={client_id:"' + key + '"}');
  });
  assert.equal(value, key);
  assert.deepEqual(calls, ['https://soundcloud.com/', 'https://a-v2.sndcdn.com/assets/missing.js', 'https://a-v2.sndcdn.com/assets/working.js']);
});

test('missing and oversized catalogue pages reject cleanly instead of hanging in nested callbacks', async () => {
  for (const response of [new Response('<html>No scripts</html>'), new Response('small body', { headers: { 'Content-Length': '4000000' } })]) {
    await assert.rejects(fetchClientId(async () => response), /каталогу SoundCloud/);
  }
});

test('an expired public client ID is refreshed once and then reused by later catalogue requests', async () => {
  let clients = 0; const seen = [];
  const provider = new SoundCloudDiscovery(async url => {
    const value = new URL(url).searchParams.get('client_id'); seen.push(value);
    return value === 'expired' ? new Response(null, { status: 401 }) : Response.json({ collection: [] });
  }, { clientIdFetcher: async () => ++clients === 1 ? 'expired' : key });
  await provider.search('test'); await provider.search('next');
  assert.equal(clients, 2); assert.deepEqual(seen, ['expired', key, key]);
});

test('a rejected account authorization is returned to the caller without endlessly rotating public IDs', async () => {
  let clients = 0, calls = 0;
  const provider = new SoundCloudDiscovery(async () => { calls++; return new Response(null, { status: 401 }); }, { clientIdFetcher: async () => { clients++; return key; } });
  await assert.rejects(provider.request('/resolve', { url: 'https://soundcloud.com/test/song' }, { headers: { Authorization: 'OAuth test-expired-account' } }), { status: 401 });
  assert.equal(clients, 1); assert.equal(calls, 1);
});

test('cancelling one caller during client discovery does not hang or cancel another caller', async () => {
  let finish, clients = 0;
  const provider = new SoundCloudDiscovery(async () => Response.json({ collection: [] }), { clientIdFetcher: () => { clients++; return new Promise(resolve => { finish = resolve; }); } });
  const controller = new AbortController();
  const first = provider.request('/search/tracks', {}, { signal: controller.signal });
  const second = provider.search('test'); await Promise.resolve();
  controller.abort(); await assert.rejects(first, { name: 'AbortError' });
  finish(key); await second; assert.equal(clients, 1);
});
