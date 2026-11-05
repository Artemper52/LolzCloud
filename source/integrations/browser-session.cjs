'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { promisify } = require('node:util');
const { transferable, cookieDetails } = require('./session-import.cjs');
const { createBrowserIdentity, signTransfer } = require('./browser-session-identity.cjs');
const MAX_BYTES = 256 * 1024, FORMAT = 'lolzcloud-session', EXPORT_FORMAT = 'lolzcloud-session-export';
const assets = path.join(__dirname, '../app/session-transfer');
function normalizeCookies(input, now = Date.now()) {
  const rows = Array.isArray(input) ? input : input?.cookies;
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Выбери файл cookies SoundCloud в формате JSON или Netscape.');
  const result = new Map();
  for (const value of rows) {
    if (!transferable(value)) continue;
    const domain = value.domain.toLowerCase();
    if (!/^\.?(?:[a-z0-9-]+\.)*soundcloud\.com$/.test(domain) || value.value.length > 8192 || /[\x00-\x20\x7f]/.test(value.value)) throw new Error('Файл содержит повреждённые cookies SoundCloud.');
    const cookiePath = value.path || '/';
    if (typeof cookiePath !== 'string' || !cookiePath.startsWith('/') || /[\r\n?#]/.test(cookiePath) || cookiePath.length > 1024) throw new Error('Неверный путь cookies SoundCloud.');
    const expiry = Number(value.expirationDate ?? value.expires);
    const session = value.session === true || !Number.isFinite(expiry) || expiry <= 0;
    if (!session && expiry * 1000 <= now) continue;
    const sameSite = ({ none: 'no_restriction', no_restriction: 'no_restriction', lax: 'lax', strict: 'strict', unspecified: 'unspecified' })[String(value.sameSite || '').toLowerCase()] || 'unspecified';
    const cookie = { domain, name: value.name, value: value.value, path: cookiePath, secure: true, httpOnly: value.httpOnly === true, hostOnly: value.hostOnly ?? !domain.startsWith('.'), session, sameSite };
    if (!session) cookie.expirationDate = expiry;
    result.set([domain, cookiePath, cookie.name].join('\n'), cookie);
  }
  const cookies = [...result.values()];
  if (!cookies.some(cookie => cookie.name === 'oauth_token' && ['soundcloud.com', '.soundcloud.com'].includes(cookie.domain) && cookie.path === '/')) throw new Error('Действующий вход SoundCloud не найден. Сначала войди в SoundCloud в выбранном браузере.');
  return cookies;
}
function parseCookies(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Файл сессии слишком большой.');
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (/^[\[{]/.test(raw)) {
    let value; try { value = JSON.parse(raw); } catch { throw new Error('Не удалось прочитать файл сессии.'); }
    return normalizeCookies(value);
  }
  const cookies = [];
  for (let line of raw.split(/\r?\n/)) {
    const httpOnly = line.startsWith('#HttpOnly_');
    if (httpOnly) line = line.slice(10);
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length !== 7) throw new Error('Выбери экспорт cookies в формате JSON или Netscape.');
    const [domain, includeSubdomains, cookiePath, secure, expires, name, value] = parts;
    cookies.push({ domain, hostOnly: includeSubdomains !== 'TRUE', path: cookiePath, secure: secure === 'TRUE', expirationDate: Number(expires), session: expires === '0', name, value, httpOnly });
  }
  return normalizeCookies(cookies);
}
function decode(value, max = MAX_BYTES) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > max * 2) throw new Error('Повреждённый файл сессии.');
  const buffer = Buffer.from(value, 'base64'); if (buffer.length > max) throw new Error('Файл сессии слишком большой.'); return buffer;
}
function decrypt(envelope, key, aad) {
  const iv = decode(envelope.iv, 12), data = decode(envelope.data);
  if (iv.length !== 12 || data.length < 17) throw new Error();
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString('utf8');
}
async function readExport(text, password = '') {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Файл сессии слишком большой.');
  let value; try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return parseCookies(text); }
  if (value?.format !== EXPORT_FORMAT) return normalizeCookies(value);
  if (!password) { const error = new Error('Введи пароль, заданный при экспорте из браузера.'); error.code = 'SESSION_PASSWORD_REQUIRED'; throw error; }
  if (typeof password !== 'string' || password.length > 256 || value.version !== 1 || value.iterations !== 310000 || value.kdf !== 'PBKDF2-SHA256') throw new Error('Неподдерживаемый файл сессии.');
  try {
    const salt = decode(value.salt, 16); if (salt.length !== 16) throw new Error();
    const key = await promisify(crypto.pbkdf2)(password, salt, 310000, 32, 'sha256');
    return parseCookies(decrypt(value, key, EXPORT_FORMAT + ':1'));
  } catch { throw new Error('Пароль не подошёл или файл сессии повреждён.'); }
}
async function applyCookies(target, cookies) {
  const rows = normalizeCookies(cookies);
  const previous = (await target.cookies.get({ domain: 'soundcloud.com' })).filter(transferable);
  try {
    for (const cookie of previous) { const details = cookieDetails(cookie); await target.cookies.remove(details.url, cookie.name); }
    for (const cookie of rows.filter(row => row.name !== 'oauth_token').concat(rows.filter(row => row.name === 'oauth_token'))) await target.cookies.set(cookieDetails(cookie));
    await target.cookies.flushStore();
    return { count: rows.length };
  } catch {
    try {
      for (const cookie of (await target.cookies.get({ domain: 'soundcloud.com' })).filter(transferable)) { const details = cookieDetails(cookie); await target.cookies.remove(details.url, cookie.name); }
      for (const cookie of previous) await target.cookies.set(cookieDetails(cookie));
      await target.cookies.flushStore();
    } catch { /* A second Chromium storage error is reported without cookie data. */ }
    throw new Error('Не удалось сохранить вход. Закрой другие копии LolzCloud и попробуй ещё раз.');
  }
}
function bookmarklet(context, file = false) {
  const program = fs.readFileSync(path.join(assets, 'bookmark.js'), 'utf8');
  const config = { id: context.id, key: context.key.toString('base64'), receiver: context.url + 'receive', file };
  return 'javascript:void (' + program + ')(' + JSON.stringify(config) + ')';
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
class BrowserSessionTransfer {
  constructor({ target, onImported = async () => {}, onChange = () => {}, now = Date.now, lifetime = 5 * 60000, identity = createBrowserIdentity() }) {
    Object.assign(this, { target, onImported, onChange, now, lifetime, identity }); this.context = null;
    this.value = { active: false, busy: false, imported: false, expiresAt: 0, count: 0, source: '', error: '', pairingCode: identity.pairingCode, persistentPairing: identity.persistent };
  }
  state() { return { ...this.value }; }
  set(patch) { Object.assign(this.value, patch); this.onChange(); }
  async start() {
    if (this.context && this.value.active && !this.value.busy) return this.context.url;
    if (this.value.busy) throw new Error('Перенос входа уже выполняется.');
    this.stop();
    const context = { id: crypto.randomBytes(24).toString('hex'), key: crypto.randomBytes(32) };
    const server = http.createServer((request, response) => { void this.handle(context, request, response).catch(() => { if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: 'Не удалось прочитать сессию. Повтори перенос.' })); }); });
    server.requestTimeout = 8000; server.headersTimeout = 8000; server.maxConnections = 12;
    context.server = server; this.context = context;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    context.origin = 'http://127.0.0.1:' + server.address().port;
    context.base = '/transfer/' + context.id + '/'; context.url = context.origin + context.base;
    const expiresAt = this.now() + this.lifetime;
    context.request = signTransfer(this.identity, context, expiresAt);
    this.set({ active: true, busy: false, imported: false, expiresAt, count: 0, source: '', error: '' });
    context.timer = setTimeout(() => { if (this.context === context) this.stop(); }, this.lifetime); context.timer.unref?.(); server.unref();
    return context.url;
  }
  stop() {
    if (this.context) { clearTimeout(this.context.timer); this.context.server.close(); this.context.server.closeIdleConnections?.(); this.context.key.fill(0); this.context = null; }
    this.set({ active: false });
  }
  receive(cookies, source = 'Браузер') {
    if (this.value.busy) return Promise.reject(new Error('Перенос входа уже выполняется.'));
    this.set({ busy: true, error: '' });
    this.inflight = (async () => { try {
      const result = await applyCookies(this.target, cookies);
      await this.onImported({ ...result, source });
      this.set({ active: false, imported: true, ...result, source }); return result;
    } catch (error) { this.set({ error: error.message }); throw error; }
    finally { this.set({ busy: false }); }
    })();
    return this.inflight;
  }
  async dispose() { this.stop(); await this.inflight?.catch(() => {}); }
  async importFile(text, password) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Файл сессии слишком большой.');
    let value; try { value = JSON.parse(text); } catch { /* Netscape is also supported. */ }
    if (value?.format === FORMAT) {
      const context = this.context;
      if (!context || !this.value.active || this.now() >= this.value.expiresAt || value.id !== context.id || value.version !== 1) throw new Error('Эта передача устарела. Открой перенос в LolzCloud и создай новый файл.');
      let cookies;
      try { cookies = parseCookies(decrypt(value, context.key, FORMAT + ':1:' + context.id)); }
      catch { throw new Error('Повреждённый файл сессии. Повтори перенос.'); }
      return this.receive(cookies);
    }
    return this.receive(await readExport(text, password), 'Файл браузера');
  }
  async handle(context, request, response) {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin' };
    const send = (status, data) => { response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    if (this.context !== context || request.headers.host !== '127.0.0.1:' + context.server.address()?.port || !request.url.startsWith(context.base)) return send(404, { ok: false });
    if (request.headers.origin && request.headers.origin !== context.origin) return send(403, { ok: false });
    if (request.method === 'GET' && request.url === context.base + 'status') return send(200, this.state());
    if (!this.value.active || this.now() >= this.value.expiresAt) return send(410, { ok: false, error: this.value.imported ? 'Сессия уже перенесена. Вернись в LolzCloud.' : 'Время переноса истекло. Открой его заново в LolzCloud.' });
    if (request.method === 'GET' && [context.base + 'helper.zip', context.base + 'helper-firefox.zip'].includes(request.url)) { const firefox = request.url.endsWith('helper-firefox.zip'); response.writeHead(200, { ...headers, 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="LolzCloud-browser-helper' + (firefox ? '-firefox' : '') + '.zip"' }); return response.end(fs.readFileSync(path.join(assets, firefox ? 'helper-firefox.zip' : 'helper.zip'))); }
    if (request.method === 'GET' && [context.base, context.base + 'receive'].includes(request.url)) {
      const receiver = request.url.endsWith('/receive'), nonce = crypto.randomBytes(16).toString('base64');
      let html = fs.readFileSync(path.join(assets, receiver ? 'receive.html' : 'index.html'), 'utf8');
      html = html.replaceAll('{{NONCE}}', nonce).replace('{{STYLE}}', fs.readFileSync(path.join(assets, 'style.css'), 'utf8')).replace('{{REQUEST}}', escapeHtml(JSON.stringify(context.request))).replace('{{PAIRING_CODE}}', escapeHtml(this.identity.pairingCode)).replace('{{BOOKMARK}}', escapeHtml(bookmarklet(context))).replace('{{FILE_BOOKMARK}}', escapeHtml(bookmarklet(context, true)));
      response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" }); return response.end(html);
    }
    if (request.method !== 'POST' || request.url !== context.base + 'import' || request.headers.origin !== context.origin || request.headers['content-type'] !== 'application/json') return send(403, { ok: false });
    if (this.value.busy) return send(409, { ok: false, error: 'Вход уже переносится.' });
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > MAX_BYTES) return send(413, { ok: false, error: 'Файл сессии слишком большой.' }); chunks.push(chunk); }
    try { const result = await this.importFile(Buffer.concat(chunks).toString('utf8')); return send(200, { ok: true, count: result.count }); }
    catch (error) { return send(400, { ok: false, error: error.message }); }
  }
}
module.exports = { BrowserSessionTransfer, normalizeCookies, parseCookies, readExport, applyCookies, bookmarklet, MAX_BYTES };
