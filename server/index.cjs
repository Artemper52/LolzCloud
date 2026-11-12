'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('./package.json');
const { CloudStore, HttpError, profile, safeNext, hash } = require('./core.cjs');
const { PlayerServices } = require('./player-services.cjs');
const { RoomEngine } = require('./room-engine.cjs');
const { RoomCatalog } = require('./catalog.cjs');
const ROOT = path.join(__dirname, 'public');
const publicFile = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const inlineHash = value => "'sha256-" + createHash('sha256').update(value).digest('base64') + "'";
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(row => row.trim().split(/=(.*)/s).slice(0, 2)).filter(row => row.length === 2));
function createServer({ origin = 'https://lolzcloud.com', clientId = process.env.LOLZ_CLIENT_ID, redirectMode = process.env.LOLZ_REDIRECT_MODE ?? 'explicit', spicyKey = process.env.SPICY_LYRICS_SECRET_KEY, store = new CloudStore({ filename: path.join(process.env.LOLZCLOUD_STATE || '/var/lib/lolzcloud', 'sessions.json'), origin }), fetcher = fetch, verifyProfile = null } = {}) {
  if (!['explicit', 'registered'].includes(redirectMode)) throw new Error('LOLZ_REDIRECT_MODE must be explicit or registered.');
  const limits = new Map(), lyrics = new Map(), rooms = new RoomEngine(store), players = new PlayerServices(store, rooms); let upstream = 0;
  const catalog = new RoomCatalog(fetcher);
  function limit(key, max, window = 60000) {
    const now = Date.now(); let entry = limits.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + window }; limits.set(key, entry); }
    if (++entry.count > max) throw new HttpError(429, 'Слишком много запросов. Попробуй через минуту.');
    if (limits.size > 10000) for (const [id, row] of limits) if (row.until <= now) limits.delete(id);
  }
  async function jsonBody(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Нужен JSON-запрос.');
    const chunks = []; let size = 0; const maximum = req.url === '/api/profile' ? 1050000 : 16384; for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new HttpError(413, 'Слишком большой запрос.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный запрос.'); }
  }
  async function apiJson(url, options = {}, max = 2_000_000) {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(12000) });
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) { size += chunk.length; if (size > max) throw new HttpError(502, 'Слишком большой ответ сервиса.'); chunks.push(Buffer.from(chunk)); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(502, 'Сервис вернул некорректный ответ.'); }
    return { status: response.status, value, retry: response.headers.get('retry-after') };
  }
  const checkProfile = verifyProfile || (async accessToken => {
    let response;
    try { response = await apiJson('https://api.lolz.team/users/me', { headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json', 'User-Agent': 'LolzCloud' } }); }
    catch { throw new HttpError(502, 'Сейчас не удалось связаться с Lolzteam. Открой вход заново.'); }
    if (response.status === 429 || response.status >= 500) throw new HttpError(503, 'Lolzteam временно недоступен. Попробуй войти чуть позже.');
    if (response.status !== 200 || !response.value.user) throw new HttpError(401, 'Lolzteam не подтвердил вход. Повтори авторизацию.');
    return profile(response.value.user);
  });
  function session(req, required = true) {
    const bearer = req.headers.authorization?.match(/^Bearer ([a-zA-Z0-9_-]{43})$/)?.[1], secret = bearer || cookies(req)['__Host-lc_session'];
    const value = store.session(secret); if (!value && required) throw new HttpError(401, 'Войди через Lolzteam, чтобы подключиться.');
    return value ? { ...value, secret, bearer: !!bearer } : null;
  }
  function guard(req, user) {
    if (req.headers.origin && req.headers.origin !== origin) throw new HttpError(403, 'Недоверенный источник запроса.');
    if (!user.bearer && req.headers['x-csrf-token'] !== user.csrf) throw new HttpError(403, 'Обнови страницу и повтори действие.');
  }
  function headers(res, room = false) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'" + (room ? ' https://w.soundcloud.com https://www.youtube.com https://s.ytimg.com' : '') + "; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-src " + (room ? 'https://w.soundcloud.com https://www.youtube.com https://www.youtube-nocookie.com' : "'none'") + "; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  }
  function send(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  function redirect(res, url) { res.writeHead(303, { Location: url }); res.end(); }
  function cookie(name, value, age) { return name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + age; }
  function page(res, name, room = false) { headers(res, room); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, name))); }
  function callback(res) {
    const style = publicFile('callback.css').replace(/\r\n/g, '\n');
    const script = publicFile('callback.js').replace(/\r\n/g, '\n');
    const html = publicFile('callback.html').replace('<!-- callback-style -->', () => '<style>' + style + '</style>')
      .replace('<!-- callback-script -->', () => '<script>' + script + '</script>');
    res.setHeader('Content-Security-Policy', res.getHeader('Content-Security-Policy')
      .replace("script-src 'self'", 'script-src ' + inlineHash(script))
      .replace("style-src 'self'", 'style-src ' + inlineHash(style)));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
  const server = http.createServer(async (req, res) => {
    headers(res);
    try {
      const url = new URL(req.url, origin), method = req.method;
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Метод не поддерживается.');
      const peer = String(req.headers['x-real-ip'] || req.socket.remoteAddress).slice(0, 100);
      if (url.pathname === '/api/health' && method === 'GET') return send(res, { ok: true, version, roomProtocol: 2, oauthConfigured: !!clientId, spicyConfigured: !!spicyKey });
      if (url.pathname === '/auth/lolz' && method === 'GET') {
        if (!clientId || !/^[a-zA-Z0-9_-]{5,100}$/.test(clientId)) throw new HttpError(503, 'Вход временно недоступен.');
        limit('login:' + peer, 20);
        const state = store.beginLogin(url.searchParams.get('next'));
        res.setHeader('Set-Cookie', cookie('__Host-lc_login', state, 600));
        const destination = new URL('https://lolz.live/account/authorize');
        for (const [key, value] of Object.entries({ client_id: clientId, response_type: 'token', scope: 'basic read', state })) destination.searchParams.set(key, value);
        if (redirectMode === 'explicit') destination.searchParams.set('redirect_uri', origin + '/auth/lolz/callback');
        return redirect(res, destination.href);
      }
      if (url.pathname === '/auth/lolz/callback' && method === 'GET') return callback(res);
      if (url.pathname === '/api/auth/complete' && method === 'POST') {
        if (req.headers.origin !== origin) throw new HttpError(403, 'Недоверенный запрос входа.');
        limit('auth:' + peer, 20);
        const data = await jsonBody(req), next = store.consumeLogin(data.state, cookies(req)['__Host-lc_login']);
        if (typeof data.accessToken !== 'string' || data.accessToken.length < 10 || data.accessToken.length > 8192 || /[\s\x00-\x1f]/.test(data.accessToken)) throw new HttpError(400, 'Lolzteam не вернул токен входа.');
        // Only /users/me determines identity. Callback user_id/name fields and
        // client-supplied profiles never grant access. The Lolz token is discarded.
        const user = await checkProfile(data.accessToken), value = store.login(user);
        res.setHeader('Set-Cookie', [cookie('__Host-lc_session', value.secret, 7 * 86400), cookie('__Host-lc_login', '', 0)]);
        return send(res, { next, user: value.user });
      }
      if (url.pathname === '/api/session' && method === 'GET') {
        const value = session(req, false); return send(res, value ? { authenticated: true, user: value.user, csrf: value.csrf, spicyAvailable: !!spicyKey } : { authenticated: false });
      }
      if (url.pathname === '/api/desktop/start' && method === 'POST') { limit('desktop:' + peer, 20); await jsonBody(req); return send(res, store.beginDevice()); }
      if (url.pathname === '/api/desktop/poll' && method === 'POST') {
        limit('poll:' + peer, 400); const data = await jsonBody(req);
        if (typeof data.deviceCode !== 'string' || !/^[\w-]{43}$/.test(data.deviceCode)) throw new HttpError(400, 'Неверный код подключения.');
        return send(res, store.pollDevice(data.deviceCode));
      }
      const assets = { '/cloud/room.css': 'room.css', '/cloud/site.js': 'site.js', '/cloud/callback.js': 'callback.js', '/cloud/room.js': 'room.js', '/cloud/remote.js': 'remote.js', '/cloud/queue.js': 'queue.js', '/cloud/room-sync.js': 'room-sync.js', '/cloud/media-source.js': 'media-source.js', '/cloud/room-players.js': 'room-players.js' };
      if (assets[url.pathname] && method === 'GET') {
        headers(res); res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, assets[url.pathname]))); return;
      }
      if (url.pathname === '/login' && method === 'GET') return page(res, 'login.html');
      if (/^\/remote\/[a-f0-9]{32}$/.test(url.pathname) && method === 'GET') { if (!session(req, false)) return redirect(res, '/login?next=' + encodeURIComponent(safeNext(url.pathname))); return page(res, 'remote.html'); }
      if (url.pathname === '/connect' && method === 'GET' || url.pathname === '/rooms' && method === 'GET' || /^\/room\/[a-f0-9]{32}\/?$/.test(url.pathname) && method === 'GET') {
        if (!session(req, false)) return redirect(res, '/login?next=' + encodeURIComponent(safeNext(url.pathname + url.search)));
        return page(res, url.pathname === '/connect' ? 'connect.html' : url.pathname === '/rooms' ? 'rooms.html' : 'room.html', url.pathname.startsWith('/room/'));
      }
      const auth = session(req); limit('user:' + auth.user.id, 900);
      if (url.pathname === '/api/clock' && method === 'GET') return send(res, { serverTime: store.now() });
      if (method !== 'GET') guard(req, auth);
      if (url.pathname === '/api/logout' && method === 'POST') { store.logout(auth.secret); res.setHeader('Set-Cookie', cookie('__Host-lc_session', '', 0)); return send(res, { ok: true }); }
      if (url.pathname === '/api/desktop/approve' && method === 'POST') { const data = await jsonBody(req); store.approveDevice(data.code, auth.user); return send(res, { ok: true }); }
      if (url.pathname === '/api/profile' && method === 'GET') return send(res, players.getProfile(auth.user));
      if (url.pathname === '/api/profile' && method === 'PUT') { limit('profile:' + auth.user.id, 10); return send(res, players.saveProfile(auth.user, await jsonBody(req))); }
      if (url.pathname === '/api/remotes' && method === 'POST') { limit('remote-create:' + auth.user.id, 10); return send(res, players.createRemote(auth.user, (await jsonBody(req)).name), 201); }
      const remote = url.pathname.match(/^\/api\/remotes\/([a-f0-9]{32})(?:\/(state|command))?$/);
      if (remote) {
        const [, id, action] = remote;
        if (method === 'GET' && !action) return send(res, players.remoteView(id, auth.user));
        if (method === 'DELETE' && !action) { players.remote(id, auth.user); players.remotes.delete(id); return send(res, { ok: true }); }
        if (method === 'PUT' && action === 'state') return send(res, players.updateRemote(id, auth.user, await jsonBody(req)));
        if (method === 'POST' && action === 'command') { limit('remote-command:' + auth.user.id, 120); return send(res, players.command(id, auth.user, await jsonBody(req))); }
      }
      if (url.pathname === '/api/rooms' && method === 'POST') return send(res, store.createRoom(auth.user), 201);
      if (url.pathname === '/api/music/search' && method === 'GET') { limit('catalog:'+auth.user.id,30);return send(res,{tracks:await catalog.search(url.searchParams.get('q'))}); }
      if (url.pathname === '/api/rooms' && method === 'GET') return send(res, { rooms: [...store.rooms.values()].filter(room => room.owner.id === auth.user.id || room.settings?.public && !room.bans?.has(auth.user.id)).map(room => store.viewRoom(room, auth.user)) });
      const room = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|leave|state|queue|control|message|events))?$/);
      if (room) {
        const [, id, action] = room;
        if (method === 'GET' && action === 'events') {
          limit('events:' + auth.user.id, 20); store.viewRoom(store.room(id), auth.user);
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
          let finished = false, unsubscribe = () => {}, heartbeat;
          const close = () => { if (finished) return; finished = true; clearInterval(heartbeat); unsubscribe(); res.end(); };
          const push = () => { if (finished) return; try { if (auth.expires <= store.now()) return close(); const value = store.viewRoom(store.room(id), auth.user); if (!res.write('event: state\ndata: ' + JSON.stringify(value) + '\n\n')) close(); } catch { res.write('event: closed\ndata: {}\n\n'); close(); } };
          unsubscribe = rooms.subscribe(id, push); heartbeat = setInterval(push, 5000); heartbeat.unref(); res.on('close', close); push(); return;
        }
        if (method === 'GET' && !action) return send(res, store.viewRoom(store.room(id), auth.user));
        if (method === 'DELETE' && !action) { store.closeRoom(id, auth.user); return send(res, { ok: true }); }
        const data = await jsonBody(req);
        if (method === 'POST' && action === 'queue') { limit('queue:' + auth.user.id, 60); const value = players.queue(id, auth.user, data); rooms.changed(id); return send(res, value); }
        if (method === 'POST' && action === 'control') { limit('room-control:' + auth.user.id, 120); return send(res, rooms.control(id, auth.user, data)); }
        if (method === 'POST' && action === 'message') { limit('room-message:' + auth.user.id, 30); return send(res, rooms.message(id, auth.user, data)); }
        if (method === 'PUT' && action === 'state') return send(res, store.updateRoom(id, auth.user, data));
        if (method === 'POST' && action === 'join') return send(res, rooms.join(id, auth.user, data));
        if (method === 'POST' && action === 'leave') { store.leaveRoom(id, auth.user, data.connection); return send(res, { ok: true }); }
      }
      const lyric = url.pathname.match(/^\/api\/lyrics\/([a-zA-Z0-9]{22})$/);
      if (lyric && method === 'GET') {
        if (!spicyKey) throw new HttpError(503, 'Общий источник текста пока не подключён.');
        limit('lyrics:' + auth.user.id, 60);
        const id = lyric[1], cached = lyrics.get(id);
        if (cached && cached.until > Date.now()) return send(res, cached.value, cached.status);
        if (upstream >= 8) throw new HttpError(503, 'Источник текста занят. Попробуй позже.');
        upstream++;
        try {
          const result = await apiJson('https://api.spicylyrics.org/v1/lyrics/' + id, { headers: { Authorization: 'Bearer ' + spicyKey, Accept: 'application/json' } });
          if (result.status === 429) { res.setHeader('Retry-After', result.retry || '60'); throw new HttpError(429, 'Источник текста попросил сделать паузу.'); }
          if (![200, 404].includes(result.status)) throw new HttpError(502, 'Источник текста временно недоступен.');
          // Preserve source, uploader/maker attribution and provider markings.
          if (lyrics.size >= 2000) lyrics.delete(lyrics.keys().next().value);
          lyrics.set(id, { until: Date.now() + (result.status === 200 ? 86400000 : 300000), value: result.value, status: result.status });
          return send(res, result.value, result.status);
        } finally { upstream--; }
      }
      throw new HttpError(404, 'Страница не найдена.');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof HttpError ? error.status : 502;
      if (status === 429) res.setHeader('Retry-After', '60');
      send(res, { error: error instanceof HttpError ? error.message : 'Сервис временно недоступен. Попробуй ещё раз.' }, status);
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  const cleanup = setInterval(() => { store.prune(); for (const [id, row] of lyrics) if (row.until <= Date.now()) lyrics.delete(id); }, 60000); cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); rooms.dispose(); store.save(); }); server.store = store;
  return server;
}
if (require.main === module) {
  const server = createServer(), port = Number(process.env.PORT) || 4387;
  server.listen(port, '127.0.0.1', () => console.log('LolzCloud cloud service ready.'));
  const stop = () => { server.close(() => process.exit(0)); server.closeAllConnections(); setTimeout(() => process.exit(1), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { createServer };
