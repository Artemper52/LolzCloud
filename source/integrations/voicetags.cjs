'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const { writeJson } = require('./durable-json.cjs');
const run = promisify(execFile);
const CATALOG = Object.freeze([
  { id: 'prince', name: 'Т-тёмный принц', artist: 'Тёмный принц', slug: 'temnyi-prints-voice-tag-intro', page: 'temnyi-prints-voice-tag-intro-85492', sha256: 'c4aafc01f623b5753ebfcd417b9342ff321ee4a8160d4b819d71acf67ab9ce15' },
  { id: 'yaya', name: 'Ыа ыа', artist: 'Тёмный принц', slug: 'temnyi-prints-ya-ya', page: 'temnyi-prints-ya-ya-61434', sha256: '555da3e97dc2fcffe378c5e1d1aa0ab8dcae6288666fb3ed205d460e41726a6c' },
  { id: 'madk1d', name: 'Династия', artist: 'madk1d', slug: 'madk1d-dinastiiaiaia', page: 'madk1d-dinastiiaiaia-59134', sha256: 'd98488337ee7a5d569212f9846b57fcec805ededc0685f26d64287953d6789d0' },
  { id: 'cloudly812', name: 'Как называется эта песня?', artist: 'cl6udly · FORTUNA 812', source: 'https://soundcloud.com/fortunasound/fuckyall-prod-cloudly006', seconds: 2.8 },
]);
class Voicetags {
  constructor(directory, fetcher = fetch) {
    this.directory = directory; this.fetcher = fetcher; this.busy = new Map();
    this.filename = path.join(directory, 'voicetags.json'); this.data = { volume: .5, custom: [] };
    try { const data = JSON.parse(fs.readFileSync(this.filename)); if (Number.isFinite(data.volume)) this.data.volume = Math.max(0, Math.min(1, data.volume)); this.data.custom = (Array.isArray(data.custom) ? data.custom : []).filter(row => /^[a-f0-9]{32}$/.test(row.id) && typeof row.name === 'string').slice(0, 24).map(row => ({ id: row.id, name: row.name.slice(0, 60), artist: 'Мой звук' })); } catch { /* First use. */ }
  }
  file(id) { if (![...CATALOG, ...this.data.custom].some(row => row.id === id)) throw Error('Этот voicetag не найден.'); return path.join(this.directory, id + '.mp3'); }
  state() { return { volume: this.data.volume, items: [...CATALOG, ...this.data.custom].map(row => ({ id: row.id, name: row.name, artist: row.artist, ready: fs.existsSync(this.file(row.id)), loading: this.busy.has(row.id), source: row.source || (row.page ? 'https://www.myinstants.com/en/instant/' + row.page + '/' : '') })) }; }
  volume(value) { if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Громкость voicetag: от 0 до 100%.'); this.data.volume = value; writeJson(this.filename, this.data); }
  async prepare(id) {
    if (this.busy.has(id)) return this.busy.get(id);
    const filename = this.file(id), row = CATALOG.find(row => row.id === id);
    if (fs.existsSync(filename) && (!row?.sha256 || crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') === row.sha256)) return filename;
    if (!row) throw Error('Файл voicetag перемещён. Добавь его заново.');
    const task = (async () => {
      if (row.source) {
        fs.mkdirSync(this.directory, { recursive: true });
        const original = filename + '.source', temporary = filename + '.tmp.mp3';
        try {
          const { SoundCloudDiscovery } = require('./discovery.cjs'), { SoundCloudAudioSource } = require('./audio-download.cjs');
          await new SoundCloudAudioSource(new SoundCloudDiscovery(this.fetcher), this.fetcher).save(row.source, original, { signal: AbortSignal.timeout(45000) });
          await run(require('ffmpeg-static').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), ['-hide_banner', '-nostdin', '-y', '-i', original, '-t', String(row.seconds), '-vn', '-map_metadata', '-1', '-af', 'loudnorm=I=-20:TP=-3:LRA=7,afade=t=out:st=2.65:d=0.15', '-codec:a', 'libmp3lame', '-q:a', '4', temporary], { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
          fs.renameSync(temporary, filename); return filename;
        } finally { fs.rmSync(original, { force: true }); fs.rmSync(temporary, { force: true }); }
      }
      const response = await this.fetcher('https://www.myinstants.com/media/sounds/' + row.slug + '.mp3', { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw Error('Не удалось скачать voicetag. Повтори позже.');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Error('Voicetag слишком большой.'); chunks.push(chunk); }
      const data = Buffer.concat(chunks);
      if (crypto.createHash('sha256').update(data).digest('hex') !== row.sha256) throw Error('Звук у источника изменился. Добавь его через «Свой звук».');
      fs.mkdirSync(this.directory, { recursive: true }); fs.writeFileSync(filename + '.tmp', data); fs.renameSync(filename + '.tmp', filename); return filename;
    })();
    this.busy.set(id, task); try { return await task; } finally { this.busy.delete(id); }
  }
  async import(filename) {
    if (this.data.custom.length >= 24) throw Error('Можно добавить до 24 своих звуков.');
    if (!path.isAbsolute(filename) || !fs.statSync(filename).isFile() || fs.statSync(filename).size > 20 * 1024 * 1024) throw Error('Выбери аудиофайл до 20 МБ.');
    fs.mkdirSync(this.directory, { recursive: true });
    const id = crypto.randomBytes(16).toString('hex'), target = path.join(this.directory, id + '.mp3');
    const binary = require('ffmpeg-static').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    try { await run(binary, ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', filename, '-t', '15', '-vn', '-map_metadata', '-1', '-af', 'loudnorm=I=-20:TP=-3:LRA=7', '-codec:a', 'libmp3lame', '-q:a', '4', target], { windowsHide: true, timeout: 20000, maxBuffer: 65536 }); }
    catch { fs.rmSync(target, { force: true }); throw Error('Не удалось прочитать этот аудиофайл. Попробуй MP3 или WAV.'); }
    this.data.custom.push({ id, name: path.basename(filename, path.extname(filename)).slice(0, 60), artist: 'Мой звук' }); writeJson(this.filename, this.data); return id;
  }
}
module.exports = { CATALOG, Voicetags };
