'use strict';
// Used only by the optional Electron 22 build for Windows 7 SP1. Modern builds
// keep their native networking and structured-clone implementations.
function install() {
  if (Number(process.versions.electron?.split('.')[0] || 99) >= 23) return;
  if (typeof globalThis.structuredClone !== 'function') { const v8 = require('node:v8'); globalThis.structuredClone = value => v8.deserialize(v8.serialize(value)); }
  if (typeof AbortSignal.any !== 'function') AbortSignal.any = signals => { const controller = new AbortController(), callbacks = []; const cleanup = () => { for (const [signal, listener] of callbacks) signal.removeEventListener('abort', listener); }; for (const signal of signals.filter(Boolean)) { if (signal.aborted) { cleanup(); controller.abort(signal.reason); break; } const listener = () => { cleanup(); controller.abort(signal.reason); }; callbacks.push([signal, listener]); signal.addEventListener('abort', listener, { once: true }); } return controller.signal; };
  if (typeof AbortSignal.timeout !== 'function') AbortSignal.timeout = milliseconds => { const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Request timeout')), milliseconds); timer.unref?.(); return controller.signal; };
  const crossFetch = require('cross-fetch'), { ReadableStream } = require('node:stream/web');
  function response(value) {
    let stream = null;
    const getStream = () => { if (stream) return stream; if (!value.body) return null; const iterator = value.body[Symbol.asyncIterator](); stream = new ReadableStream({ async pull(controller) { try { const item = await iterator.next(); if (item.done) controller.close(); else controller.enqueue(new Uint8Array(item.value)); } catch (error) { controller.error(error); } }, cancel() { value.body.destroy(); } }); return stream; };
    const read = async () => { if (!stream) return Buffer.from(await value.arrayBuffer()); const reader = stream.getReader(), chunks = []; while (true) { const item = await reader.read(); if (item.done) break; chunks.push(Buffer.from(item.value)); } return Buffer.concat(chunks); };
    return { status: value.status, statusText: value.statusText, ok: value.ok, headers: value.headers, url: value.url, redirected: value.redirected, get body() { return getStream(); }, text: async () => (await read()).toString('utf8'), json: async () => JSON.parse((await read()).toString('utf8')), arrayBuffer: async () => { const buffer = await read(); return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length); } };
  }
  if (typeof globalThis.fetch !== 'function') globalThis.fetch = async (...args) => response(await crossFetch(...args));
  const { session, net } = require('electron');
  const attach = () => { const target = session.defaultSession; if (typeof target.fetch === 'function') return; target.fetch = (url, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Request aborted')); return; }
    const request = net.request({ url: String(url), method: options.method || 'GET', session: target, useSessionCookies: options.credentials !== 'omit', redirect: options.redirect === 'manual' ? 'manual' : 'error' });
    for (const [key, value] of Object.entries(options.headers || {})) request.setHeader(key, value);
    const abort = () => { request.abort(); reject(new Error('Request aborted')); }; options.signal?.addEventListener('abort', abort, { once: true });
    request.on('response', incoming => { options.signal?.removeEventListener('abort', abort); const headers = {}; for (const [key, value] of Object.entries(incoming.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : String(value); resolve(response(new crossFetch.Response(incoming, { status: incoming.statusCode, headers }))); }); request.on('error', error => { options.signal?.removeEventListener('abort', abort); reject(error); }); if (options.body) request.write(options.body); request.end();
  }); };
  const { app } = require('electron'); if (app.isReady()) attach(); else app.whenReady().then(attach);
}
module.exports = { install };
