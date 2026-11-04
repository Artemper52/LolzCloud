'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { normalizeTrack } = require('./discovery.cjs');
const { clean } = require('./lolzteam/status.cjs');
const { OPTIONS, DEFAULTS, validatePreferences, normalizePreferences, contextProfile, contextLabel, preferenceScore, searchHint, normalize: norm } = require('./wave-preferences.cjs');
const { DAY, fingerprints, prunePlayed, playedRecently, markPlayed } = require('./wave-history.cjs');
const { parseRequest, requestMatch } = require('./wave-request.cjs');

function tasteProfile(history, likes = [], feedback = {}, now = Date.now()) {
  const tracks = new Map(), artists = new Map(), genres = new Map();
  function add(value, weight) {
    const track = normalizeTrack(value); if (!track?.title) return;
    const before = tracks.get(track.url) || { ...track, weight: 0 }; before.weight += weight; tracks.set(track.url, before);
    const artist = norm(track.artist); if (artist) artists.set(artist, (artists.get(artist) || 0) + weight);
    const genre = norm(track.genre); if (genre) genres.set(genre, (genres.get(genre) || 0) + weight);
  }
  likes.forEach(track => add(track, 7));
  history.forEach(row => {
    const seconds = Math.max(0, Number(row.seconds) || 0), duration = row.duration || 180;
    const engagement = Math.min(4, seconds / 25) + (seconds >= Math.min(60, duration * .6) ? 2 : 0) + (row.liked ? 5 : 0);
    const age = Number.isFinite(row.playedAt) ? Math.max(0, now - row.playedAt) : 0;
    if (engagement || row.quickSkip) add(row, (engagement - (row.quickSkip ? 4 : 0)) * Math.exp(-age / (45 * DAY)));
  });
  for (const [url, row] of Object.entries(feedback)) {
    if (!tracks.has(url) && row.track) add(row.track, 0);
    const track = tracks.get(url); if (!track) continue;
    const skips = (Number(row.skips) || 0) * Math.exp(-Math.max(0, now - (row.lastSkippedAt || now)) / (7 * DAY));
    const penalty = skips * 3 + (row.banned ? 100 : 0), bonus = (Number(row.loves) || 0) * 4;
    track.weight += bonus - penalty;
    const artist = norm(track.artist); if (artist) artists.set(artist, (artists.get(artist) || 0) + bonus - Math.min(9, penalty));
  }
  return { tracks, artists, genres };
}
function rankCandidates(candidates, profile, { feedback = {}, recent = [], current = '', adventurous = .35, random = Math.random, played24h = {}, now = Date.now(), settings = DEFAULTS, context = null, blockedArtists = [], omit = new Set(), request = null } = {}) {
  const recentUrls = new Set(recent.map(row => typeof row === 'string' ? row : row.url));
  const blocked = new Set(blockedArtists.map(norm)), lastArtists = recent.slice(-3).map(row => norm(row.artist));
  const unique = new Map();
  for (const item of candidates) {
    const track = normalizeTrack(item);
    if (!track?.title || track.url === current || recentUrls.has(track.url) || playedRecently(track, played24h, now) || feedback[track.url]?.banned || blocked.has(norm(track.artist)) || fingerprints(track).some(key => omit.has(key))) continue;
    const intent = requestMatch(track, request); if (!intent.eligible) continue;
    const signals = feedback[track.url] || {}, personal = profile.tracks.get(track.url)?.weight || 0;
    if ((signals.skips || 0) >= 3 && (signals.loves || 0) === 0 && now - (signals.lastSkippedAt || now) < DAY) continue;
    if (settings.character === 'discover' && profile.tracks.has(track.url) || settings.character === 'familiar' && personal <= 0) continue;
    const artist = norm(track.artist), artistWeight = profile.artists.get(artist) || 0, genreWeight = profile.genres.get(norm(track.genre)) || 0;
    const affinity = Math.sign(artistWeight) * Math.log1p(Math.abs(artistWeight)) * 2;
    const novelty = profile.tracks.has(track.url) ? 0 : 1.5 + adventurous * 4;
    const preference = preferenceScore(track, settings, context);
    const skips = (signals.skips || 0) * Math.exp(-Math.max(0, now - (signals.lastSkippedAt || now)) / (7 * DAY));
    const score = 3 + Math.min(10, personal * .7) + affinity + Math.min(3, genreWeight * .15) + novelty + Math.log1p(Math.max(0, item.seedWeight || 0)) + preference.score + intent.score
      - skips * 4 - lastArtists.filter(value => value === artist).length * 3.5 + random() * (1 + adventurous * 3);
    const reason = intent.reason || (preference.score >= 3 && preference.reason ? preference.reason : (signals.loves || 0) > 0 ? 'Ты отметил этот трек' : artistWeight > 3 ? 'Часто слушаешь ' + track.artist
      : item.seedTitle ? 'Похож на «' + item.seedTitle + '»' : personal > 0 ? 'Тебе нравилось это звучание' : 'Новое в твоём настроении');
    const value = { ...track, score, reason, seedTitle: item.seedTitle || '', seedWeight: item.seedWeight || 0 }, key = track.id ? 'id:' + track.id : track.url;
    if (!unique.has(key) || unique.get(key).score < score) unique.set(key, value);
  }
  const remaining = [...unique.values()], result = [];
  while (remaining.length && result.length < 40) {
    remaining.sort((a, b) => b.score - a.score);
    const next = remaining.shift(); result.push(next);
    for (const row of remaining) if (norm(row.artist) === norm(next.artist)) row.score -= 3;
  }
  return result;
}

class PersonalWave {
  constructor({ filename, provider, getSnapshot, getHistory, play, now = Date.now, random = Math.random }) {
    Object.assign(this, { filename, provider, getSnapshot, getHistory, play, now, random });
    this.request = null; this.requestPage = 0;
    this.data = { likes: [], feedback: {}, adventurous: .35, preferences: { ...DEFAULTS }, blockedArtists: [], played24h: {}, lastLikesAt: 0 };
    Object.assign(this, { active: false, loading: false, refilling: false, error: '', queue: [], current: null, recent: [], waitingUntil: 0, previous: null, busy: null, fillBusy: null, lastSeedUrls: [], generation: 0, queueVersion: 0, seedCursor: 0, anchor: null, disposed: false, nextWarmAt: 0 });
    let migrate = true;
    try {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      this.data.likes = Array.isArray(saved.likes) ? saved.likes.map(normalizeTrack).filter(Boolean) : [];
      for (const [url, row] of Object.entries(saved.feedback || {})) {
        const track = normalizeTrack(row?.track); if (!track || track.url !== url) continue;
        this.data.feedback[url] = { track, skips: Math.max(0, Math.min(20, Number(row.skips) || 0)), loves: Math.max(0, Math.min(10, Number(row.loves) || 0)), banned: row.banned === true, lastSkippedAt: Number(row.lastSkippedAt) || this.now() };
      }
      this.data.adventurous = Number.isFinite(saved.adventurous) ? Math.max(0, Math.min(1, saved.adventurous)) : .35;
      this.data.lastLikesAt = Number(saved.lastLikesAt) || 0;
      this.data.preferences = normalizePreferences(saved.preferences);
      this.data.blockedArtists = Array.isArray(saved.blockedArtists) ? [...new Set(saved.blockedArtists.map(value => clean(value, 100)).filter(Boolean))].slice(0, 100) : [];
      this.data.played24h = prunePlayed(saved.played24h, this.now()); migrate = !saved.played24h;
    } catch { /* First run. */ }
    // Existing local history seeds the first day's deduplication cache. Only hashes
    // and timestamps are copied, without titles or public profile information.
    if (migrate) for (const row of this.getHistory()) if (Number.isFinite(row.playedAt) && row.playedAt > this.now() - DAY && row.playedAt <= this.now()) markPlayed(row, this.data.played24h, row.playedAt);
  }
  save() {
    this.data.played24h = prunePlayed(this.data.played24h, this.now());
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(this.filename + '.tmp', this.filename);
  }
  profile() { return tasteProfile(this.getHistory(), this.data.likes, this.data.feedback, this.now()); }
  settings() { return this.request?.settings || this.data.preferences; }
  rank(candidates, omit = new Set()) {
    const snapshot = this.getSnapshot();
    return rankCandidates(candidates, this.profile(), { feedback: this.data.feedback, recent: this.recent.filter(row => row.startedAt > this.now() - DAY).slice(-3), current: snapshot.playback?.url || '', adventurous: this.data.adventurous, random: this.random, played24h: this.data.played24h, now: this.now(), settings: this.settings(), context: !snapshot.private ? contextProfile(this.getHistory(), this.now()) : null, blockedArtists: this.data.blockedArtists, omit, request: this.request });
  }
  allowed(track, profile = null) {
    if (playedRecently(track, this.data.played24h, this.now()) || this.data.feedback[track.url]?.banned || this.data.blockedArtists.some(name => norm(name) === norm(track.artist)) || !requestMatch(track, this.request).eligible) return false;
    const mode = this.settings().character; if (mode === 'mixed') return true;
    const known = (profile || this.profile()).tracks.get(track.url);
    return !(mode === 'discover' && known || mode === 'familiar' && !(known?.weight > 0));
  }
  state() {
    const snapshot = this.getSnapshot(), track = snapshot.playback, feedback = this.data.feedback[track?.url], profile = this.profile();
    return { active: this.active, loading: this.loading, refilling: this.refilling, waiting: this.waitingUntil > this.now(), error: this.error, queue: this.queue.filter(row => this.allowed(row, profile)).slice(0, 12), current: this.current, likes: this.data.likes.length, learned: profile.tracks.size, lastLikesAt: this.data.lastLikesAt, adventurous: this.data.adventurous, seeds: this.lastSeedUrls.length,
      preferences: { ...this.settings() }, options: OPTIONS, blockedArtists: [...this.data.blockedArtists], context: contextLabel(this.now()), anchor: this.anchor,
      request: this.request ? { text: this.request.raw, labels: [...this.request.labels], note: this.request.note } : null,
      cooldownHours: 24,
      artists: [...profile.artists].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key]) => ({ name: [...profile.tracks.values()].find(row => norm(row.artist) === key)?.artist || key })),
      canFeedback: this.active && snapshot.fresh === true && !snapshot.private && this.current?.url === track?.url && !this.waitingUntil && !this.busy,
      reaction: feedback?.banned ? 'ban' : feedback?.loves > 0 ? 'love' : '' };
  }
  async syncLikes() {
    this.data.likes = (await this.provider.likes(this.getSnapshot().soundcloudProfile)).map(normalizeTrack).filter(Boolean);
    this.data.lastLikesAt = this.now(); this.save(); return this.data.likes.length;
  }
  async fill({ append = false, omit = new Set() } = {}) {
    const version = this.queueVersion;
    if (this.fillBusy) {
      const same = this.fillVersion === version;
      await this.fillBusy;
      if (same || version !== this.queueVersion || this.disposed) return;
      return this.fill({ append, omit });
    }
    this.fillVersion = version; this.refilling = append; this.loading = true;
    const job = this._fill(version, append, omit); this.fillBusy = job;
    try { await job; } finally { if (this.fillBusy === job) { this.fillBusy = null; this.loading = false; this.refilling = false; } }
  }
  async _fill(version, append, omit) {
    this.error = '';
    try {
      if (this.request) { await this.fillRequest(version, append, omit); return; }
      const snapshot = this.getSnapshot();
      if (!this.data.likes.length && snapshot.soundcloudProfile && this.now() - this.data.lastLikesAt > 60 * 60_000) { try { await this.syncLikes(); } catch { /* Local history still works. */ } }
      if (version !== this.queueVersion || this.disposed) return;
      const profile = this.profile(), blocked = new Set(this.data.blockedArtists.map(norm));
      let seeds = [...profile.tracks.values()].filter(row => row.weight > 0 && !this.data.feedback[row.url]?.banned && !blocked.has(norm(row.artist)))
        .map(row => ({ ...row, priority: row.weight + this.random() * 3 })).sort((a, b) => b.priority - a.priority);
      if (this.anchor) seeds = [{ ...this.anchor, weight: 12 }, ...seeds.filter(row => norm(row.artist) === norm(this.anchor.artist) && row.url !== this.anchor.url)].slice(0, 2);
      if (!seeds.length && snapshot.fresh && !snapshot.private && snapshot.playback?.url) { const seed = normalizeTrack(snapshot.playback); if (seed) seeds.push({ ...seed, weight: 2 }); }
      const hint = searchHint(this.data.preferences);
      if (!seeds.length && !hint) throw new Error('Включи любимый трек, загрузи лайки или укажи жанр — волне нужна отправная точка.');
      const rotated = seeds.slice(this.seedCursor % Math.max(1, seeds.length)).concat(seeds.slice(0, this.seedCursor % Math.max(1, seeds.length)));
      if (this.anchor) { const index = rotated.findIndex(row => row.url === this.anchor.url); if (index >= 0) rotated.unshift(...rotated.splice(index, 1)); }
      const selected = [], artists = new Set();
      for (const seed of rotated) { if (selected.length >= 4) break; if (!artists.has(norm(seed.artist))) { selected.push(seed); artists.add(norm(seed.artist)); } }
      for (const seed of rotated) if (selected.length < Math.min(4, seeds.length) && !selected.some(row => row.url === seed.url)) selected.push(seed);
      this.seedCursor += Math.max(1, selected.length); this.lastSeedUrls = selected.map(row => row.url);
      const pool = [...this.data.likes, ...profile.tracks.values()].filter(row => (row.weight === undefined || row.weight > 0) && (!this.anchor || norm(row.artist) === norm(this.anchor.artist)));
      const results = await Promise.allSettled(selected.map(async seed => (await this.provider.related(seed)).map(track => ({ ...track, seedTitle: seed.title, seedWeight: seed.weight }))));
      for (const result of results) if (result.status === 'fulfilled') pool.push(...result.value);
      if (version !== this.queueVersion || this.disposed) return;
      if (this.rank(pool, omit).length < 8 && this.data.preferences.character !== 'familiar') {
        const neighbours = pool.filter(row => row.url && !selected.some(seed => seed.url === row.url)), at = this.seedCursor % Math.max(1, neighbours.length);
        const secondSeeds = neighbours.slice(at).concat(neighbours.slice(0, at)).slice(0, 2);
        const expansion = await Promise.allSettled(secondSeeds.map(async seed => (await this.provider.related(seed)).map(track => ({ ...track, seedTitle: seed.title, seedWeight: 1 }))));
        for (const result of expansion) if (result.status === 'fulfilled') pool.push(...result.value);
        if (this.rank(pool, omit).length < 8 && typeof this.provider.search === 'function') {
          const query = hint || selected[this.seedCursor % Math.max(1, selected.length)]?.artist;
          if (query) { try { pool.push(...await this.provider.search(query)); } catch { /* Keep available related tracks. */ } }
        }
      }
      if (version !== this.queueVersion || this.disposed) return;
      const retained = append ? this.queue.filter(row => this.allowed(row)) : [], retainedKeys = new Set(retained.flatMap(fingerprints));
      const queue = retained.concat(this.rank(pool, omit).filter(row => !fingerprints(row).some(key => retainedKeys.has(key)))).slice(0, 40);
      if (!queue.length) { const failure = results.find(row => row.status === 'rejected'); if (failure && results.every(row => row.status === 'rejected')) throw failure.reason; throw new Error('В этом режиме закончились треки без повторов за 24 часа. Смени настройки, жанр или отправную точку.'); }
      this.queue = queue;
    } catch (error) { if (version === this.queueVersion && !this.disposed) { this.error = error.message; throw error; } }
  }
  async fillRequest(version, append, omit) {
    const request = this.request, offset = (this.requestPage++ % 6) * 50;
    if (typeof this.provider.search !== 'function') throw new Error('Поиск SoundCloud сейчас недоступен.');
    const results = await Promise.allSettled(request.queries.map(query => this.provider.search(query, { offset })));
    if (version !== this.queueVersion || this.disposed) return;
    const pool = [...this.data.likes, ...this.profile().tracks.values()];
    for (const result of results) if (result.status === 'fulfilled') pool.push(...result.value);
    const retained = append ? this.queue.filter(row => this.allowed(row)) : [], keys = new Set(retained.flatMap(fingerprints));
    const queue = retained.concat(this.rank(pool, omit).filter(row => !fingerprints(row).some(key => keys.has(key)))).slice(0, 40);
    if (!queue.length) {
      if (results.every(row => row.status === 'rejected')) throw results[0].reason;
      throw new Error(request.era ? 'Не нашлось треков с указанным годом записи без повторов за сутки. Уточни период или попробуй запрос без года.' : 'Подходящие треки без повторов за сутки не нашлись. Попробуй другой жанр или описание.');
    }
    this.lastSeedUrls = []; this.queue = queue;
  }
  feedback(kind) {
    const snapshot = this.getSnapshot(), track = normalizeTrack(snapshot.playback); if (!track || snapshot.private || !snapshot.fresh) return;
    if (this.active && this.current && this.current.url !== track.url) return;
    const before = this.data.feedback[track.url] || { skips: 0, loves: 0, banned: false };
    before.track = track;
    if (kind === 'love') { before.loves = 1; before.banned = false; }
    if (kind === 'unlove') before.loves = 0;
    if (kind === 'ban') { before.banned = true; before.loves = 0; }
    if (kind === 'skip' && snapshot.playback.position < 15) { before.skips = Math.min(20, (before.skips || 0) + 1); before.lastSkippedAt = this.now(); }
    this.data.feedback[track.url] = before; this.save();
  }
  async react(kind, url) {
    const state = this.state(), track = this.getSnapshot().playback;
    if (!state.canFeedback || url && url !== track.url || !['love', 'ban'].includes(kind)) return;
    if (kind === 'ban') await this.next('ban'); else this.feedback(state.reaction === 'love' ? 'unlove' : 'love');
  }
  async start({ fromCurrent = false, artist = '', prompt } = {}) {
    const requested = prompt === undefined ? null : parseRequest(prompt);
    const generation = ++this.generation;
    if (fromCurrent) {
      const snapshot = this.getSnapshot(), seed = snapshot.fresh && normalizeTrack(snapshot.playback);
      if (!seed?.title) throw new Error('Сначала включи трек для новой волны.');
      this.anchor = seed;
    } else if (artist) {
      this.anchor = [...this.profile().tracks.values()].filter(row => row.weight > 0 && norm(row.artist) === norm(artist)).sort((a, b) => b.weight - a.weight)[0];
      if (!this.anchor) throw new Error('Сначала послушай музыку этого исполнителя.');
    } else this.anchor = null;
    if (fromCurrent || artist) this.request = null;
    else if (requested) { this.request = requested; this.requestPage = 0; }
    this.active = false; this.waitingUntil = 0;
    this.queueVersion++; this.queue = [];
    await this.fill(); if (generation !== this.generation || this.disposed) return;
    if (this.busy) await this.busy;
    if (generation !== this.generation || this.disposed) return;
    this.active = true; await this.next('start');
  }
  stop() { this.generation++; this.queueVersion++; this.active = false; this.waitingUntil = 0; }
  async select(url) {
    const index = this.queue.findIndex(track => track.url === url);
    if (index < 0 || playedRecently(this.queue[index], this.data.played24h, this.now())) throw new Error('Этот трек уже был в волне за последние 24 часа или ушёл из очереди.');
    const [track] = this.queue.splice(index, 1); this.queue.unshift(track); this.active = true; await this.next('select');
  }
  next(reason = 'next') {
    if (this.busy) return this.busy;
    this.busy = this._next(reason).finally(() => { this.busy = null; }); return this.busy;
  }
  complete(url = this.current?.url) {
    const snapshot = this.getSnapshot();
    if (!this.active || this.waitingUntil || this.disposed || this.current?.url !== url || !snapshot.fresh || snapshot.playback.url !== url || snapshot.playback.repeat === 'one' || this.now() < (this.ignoreEndUntil || 0)) return Promise.resolve();
    return this.next('ended');
  }
  seeking() { this.ignoreEndUntil = this.now() + 2000; this.previous = null; }
  async _next(reason) {
    if (!this.active || this.disposed) return;
    const generation = this.generation;
    if (reason === 'skip') this.feedback('skip'); if (reason === 'ban') this.feedback('ban');
    this.queue = this.queue.filter(track => this.allowed(track));
    if (!this.queue.length) { const version = this.queueVersion; await this.fill(); if (version !== this.queueVersion && this.active) await this.fill(); }
    if (!this.active || generation !== this.generation || this.disposed) return;
    const track = this.queue.shift(); if (!track) throw new Error('Не удалось подобрать следующий трек без повтора.');
    this.current = track; this.recent.push({ ...track, startedAt: this.now() }); this.recent = this.recent.slice(-8);
    // Save before handing playback to the webview, including skips and restarts.
    // This TTL cache contains fingerprints + timestamps, never track titles.
    markPlayed(track, this.data.played24h, this.now()); this.save();
    this.waitingUntil = this.now() + 25_000; this.play(track.url, track);
  }
  observe(snapshot) {
    if (!this.active || this.disposed) return;
    const track = snapshot.playback;
    if (this.current && track.url === this.current.url && snapshot.fresh) {
      this.waitingUntil = 0;
      const wasPlaying = this.previous?.url === track.url && this.previous.playing;
      const stoppedAtEnd = track.ended === true || track.ended !== false && wasPlaying && !track.playing && track.duration > 1 && track.position >= track.duration - .25 && this.previous.position >= track.duration - 2;
      const wrappedAtEnd = wasPlaying && track.playing && track.duration > 1 && this.previous.position >= track.duration - 1 && track.position < 1;
      if ((stoppedAtEnd || wrappedAtEnd) && track.repeat !== 'one') {
        this.previous = { ...track };
        void this.complete(track.url).catch(error => { this.error = error.message; this.stop(); });
        return;
      }
    }
    else if (this.waitingUntil && this.now() > this.waitingUntil) { this.waitingUntil = 0; this.error = 'Не удалось запустить трек. Нажми «Дальше», чтобы попробовать следующий.'; }
    else if (!this.waitingUntil && this.current && this.previous?.url === this.current.url && track.url !== this.current.url && snapshot.fresh) {
      if (this.previous.playing && this.previous.duration > 0 && this.previous.position >= this.previous.duration - 2) void this.next('ended').catch(error => { this.error = error.message; this.stop(); });
      else this.stop();
    }
    this.previous = { ...track };
    if (this.queue.length <= 5 && !this.fillBusy && !this.busy && !this.error && this.now() >= this.nextWarmAt) { this.nextWarmAt = this.now() + 30_000; void this.fill({ append: true }).catch(() => {}); }
  }
  configure(patch) {
    const settings = validatePreferences(typeof patch === 'number' ? { adventurous: patch } : patch);
    if (Object.keys(settings).some(key => key !== 'adventurous')) { this.request = null; this.requestPage = 0; }
    if (Object.hasOwn(settings, 'adventurous')) { this.data.adventurous = settings.adventurous; delete settings.adventurous; }
    this.data.preferences = { ...this.data.preferences, ...settings }; this.queueVersion++; this.queue = []; this.nextWarmAt = 0; this.save();
    if (this.active) void this.fill().catch(() => {});
  }
  reset() { this.anchor = null; this.configure({ ...DEFAULTS, adventurous: .35 }); }
  clearRequest() { this.generation++; this.request = null; this.requestPage = 0; this.error = ''; this.queueVersion++; this.queue = []; if (this.active) void this.fill().catch(() => {}); }
  async shake() {
    const omit = new Set(this.queue.flatMap(fingerprints));
    this.seedCursor += 3; this.queueVersion++; this.queue = [];
    try { await this.fill({ omit }); }
    catch (error) { if (this.queueVersion === this.fillVersion) await this.fill(); else throw error; }
  }
  async banArtist(url) {
    const snapshot = this.getSnapshot(); if (!this.state().canFeedback || url && url !== snapshot.playback.url) return;
    const name = clean(snapshot.playback.artist, 100); if (!name) return;
    if (!this.data.blockedArtists.some(value => norm(value) === norm(name))) this.data.blockedArtists.push(name);
    this.data.blockedArtists = this.data.blockedArtists.slice(-100); this.save(); await this.next('artist-ban');
  }
  unblockArtist(name) { this.data.blockedArtists = this.data.blockedArtists.filter(value => norm(value) !== norm(name)); this.queueVersion++; this.queue = []; this.save(); if (this.active) void this.fill().catch(() => {}); }
  dispose() { this.disposed = true; this.stop(); }
}
module.exports = { PersonalWave, tasteProfile, rankCandidates };
