'use strict';

const CLIENT_ID = /\bclient_?id\s*[:=]\s*["']([a-z0-9]{32})["']/i;
const CLIENT_ERROR = 'Не удалось подключиться к каталогу SoundCloud. Проверь интернет и попробуй ещё раз.';

async function readText(fetcher, url, signal, limit) {
  const response = await fetcher(url, { signal, redirect: 'error', cache: 'no-store' });
  if (!response.ok || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error(CLIENT_ERROR);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(CLIENT_ERROR);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error(CLIENT_ERROR); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

// The website publishes this public client ID in its own JavaScript. Keep it
// in memory and bound every request; an unavailable asset must not hang or
// raise an unhandled error inside the old downloader's nested HTTPS callbacks.
async function fetchClientId(fetcher = fetch) {
  const signal = AbortSignal.timeout(15_000);
  try {
    const html = await readText(fetcher, 'https://soundcloud.com/', signal, 3_000_000);
    const inline = html.match(CLIENT_ID)?.[1]; if (inline) return inline;
    const scripts = [];
    for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
      const source = tag[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]; if (!source) continue;
      let url; try { url = new URL(source.replace(/&amp;/g, '&'), 'https://soundcloud.com/'); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
          || !(url.hostname === 'soundcloud.com' || url.hostname.endsWith('.sndcdn.com')) || !/\.js$/i.test(url.pathname)) continue;
      if (!scripts.includes(url.href)) scripts.push(url.href);
    }
    for (const url of scripts.reverse().slice(0, 8)) {
      signal.throwIfAborted();
      try {
        const id = (await readText(fetcher, url, signal, 8_000_000)).match(CLIENT_ID)?.[1];
        if (id) return id;
      } catch { if (signal.aborted) throw signal.reason; }
    }
  } catch { /* Report only an actionable error, without remote response data. */ }
  throw new Error(CLIENT_ERROR);
}

function waitForClient(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const finish = (settle, value) => { signal.removeEventListener('abort', abort); settle(value); };
    promise.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

module.exports = { fetchClientId, waitForClient };
