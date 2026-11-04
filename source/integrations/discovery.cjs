'use strict';
const { clean } = require('./lolzteam/status.cjs');
const { scUrl } = require('./music.cjs');
const { fetchClientId, waitForClient } = require('./soundcloud-client.cjs');
function normalizeTrack(value) {
  if (!value || value.kind === 'playlist' || value.streamable === false || ['BLOCK', 'SNIP'].includes(value.policy)) return null;
  const url = scUrl(value.url || value.permalink_url);
  if (!url || url.includes('/sets/')) return null;
  const id = Number(value.id);
  return { id: Number.isSafeInteger(id) && id > 0 ? id : null, url,
    title: clean(value.title, 180), artist: clean(value.artist || value.user?.username, 100),
    cover: /^https:\/\//.test(value.cover || value.artwork_url || '') ? String(value.cover || value.artwork_url).replace('large.jpg', 't500x500.jpg').slice(0, 2048) : '',
    duration: Math.round((Number(value.duration) || 0) / (!value.url && value.permalink_url ? 1000 : 1)),
    genre: clean(value.genre, 80), tags: clean(value.tags || value.tag_list, 300), description: clean(value.description, 600),
    releaseYear: releaseYear(value),
    bpm: Number.isFinite(Number(value.bpm)) && Number(value.bpm) >= 30 && Number(value.bpm) <= 300 ? Number(value.bpm) : 0,
    artistUrl: /^https:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/?$/.test(value.artistUrl || value.user?.permalink_url || '') ? String(value.artistUrl || value.user.permalink_url) : '' };
}
function releaseYear(value) {
  const year = Number(value.releaseYear || value.release_year || String(value.release_date || '').match(/^\d{4}(?=-|$)/)?.[0]);
  return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() + 1 ? year : 0;
}
class SoundCloudDiscovery {
  constructor(fetcher = fetch, { clientIdFetcher = () => fetchClientId(fetcher) } = {}) { this.fetcher = fetcher; this.clientIdFetcher = clientIdFetcher; this.ids = new Map(); this.cache = new Map(); this.retryAt = 0; this.client = null; }
  clientId(signal) {
    if (!this.client) {
      const request = Promise.resolve().then(() => this.clientIdFetcher()).catch(error => { if (this.client === request) this.client = null; throw error; });
      this.client = request;
    }
    return waitForClient(this.client, signal);
  }
  async request(endpoint, params = {}, { signal, headers = {} } = {}) {
    if (Date.now() < this.retryAt) throw new Error('SoundCloud попросил сделать паузу. Попробуй волну немного позже.');
    const url = new URL('https://api-v2.soundcloud.com' + endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const timeout = AbortSignal.timeout(15_000), deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      deadline.throwIfAborted();
      url.searchParams.set('client_id', await this.clientId(deadline));
      const current = this.client;
      response = await this.fetcher(url.href, { signal: deadline, redirect: 'error', headers: { Accept: 'application/json', ...headers } });
      if (response.status !== 401 || attempt > 0 || headers.Authorization) break;
      await response.body?.cancel();
      if (this.client === current) this.client = null;
    }
    if (response.status === 429) { this.retryAt = Date.now() + Math.max(60_000, (Number(response.headers.get('retry-after')) || 60) * 1000); throw new Error('SoundCloud попросил сделать паузу. Попробуй волну немного позже.'); }
    if (!response.ok) { const error = new Error('Не удалось получить данные SoundCloud. Попробуй позже.'); error.status = response.status; throw error; }
    return response.json();
  }
  async resolve(url) {
    const known = this.ids.get(url); if (known) return known;
    const result = await this.request('/resolve', { url });
    if (!Number.isSafeInteger(result.id) || result.id <= 0) throw new Error('Не удалось определить трек или профиль SoundCloud.');
    this.ids.set(url, result); return result;
  }
  async likes(profile) {
    if (!profile?.url) throw new Error('Сначала войди в SoundCloud или укажи ссылку на свой профиль.');
    const user = await this.resolve(profile.url);
    const rows = await this.request(`/users/${user.id}/likes`, { limit: 100, linked_partitioning: 1 });
    return (rows.collection || []).map(row => normalizeTrack(row.track)).filter(Boolean);
  }
  async related(seed) {
    const known = this.cache.get(seed.url); if (known && known.expires > Date.now()) return known.tracks;
    const source = seed.id ? seed : await this.resolve(seed.url);
    const result = await this.request(`/tracks/${source.id}/related`, { limit: 40, linked_partitioning: 1 });
    const tracks = (Array.isArray(result) ? result : result.collection || []).map(normalizeTrack).filter(Boolean);
    this.cache.set(seed.url, { expires: Date.now() + 20 * 60_000, tracks }); return tracks;
  }
  async search(query, { offset = 0 } = {}) {
    if (typeof query !== 'string' || !query.trim()) return [];
    const result = await this.request('/search/tracks', { q: query.trim().slice(0, 140), limit: 50, offset: Math.max(0, Math.min(300, Number(offset) || 0)) });
    return (result.collection || []).map(normalizeTrack).filter(Boolean);
  }
}
module.exports = { SoundCloudDiscovery, normalizeTrack };
