'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { writeJson } = require('./durable-json.cjs');
const { text } = require('./player-tools.cjs');
const EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.opus']);
function id3(buffer) {
  const metadata = {};
  if (buffer.toString('ascii', 0, 3) !== 'ID3' || ![3, 4].includes(buffer[3])) return metadata;
  const synchsafe = offset => ((buffer[offset] & 127) << 21) | ((buffer[offset + 1] & 127) << 14) | ((buffer[offset + 2] & 127) << 7) | (buffer[offset + 3] & 127);
  const limit = Math.min(buffer.length, 10 + synchsafe(6));
  for (let offset = 10; offset + 10 <= limit;) {
    const name = buffer.toString('ascii', offset, offset + 4), size = buffer[3] === 4 ? synchsafe(offset + 4) : buffer.readUInt32BE(offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(name) || size < 1 || offset + 10 + size > limit) break;
    const payload = buffer.subarray(offset + 10, offset + 10 + size);
    if (['TIT2', 'TPE1', 'TLEN'].includes(name) && payload.length < 16384) {
      let value;
      if (payload[0] === 1 || payload[0] === 2) { let bytes = payload.subarray(1); if (bytes[0] === 255 && bytes[1] === 254) bytes = bytes.subarray(2); else if (payload[0] === 2 || bytes[0] === 254 && bytes[1] === 255) { bytes = Buffer.from(bytes[0] === 254 ? bytes.subarray(2) : bytes); bytes = bytes.subarray(0, bytes.length - bytes.length % 2); bytes.swap16(); } value = bytes.toString('utf16le'); }
      else value = payload.subarray(1).toString(payload[0] === 3 ? 'utf8' : 'latin1');
      value = text(value.replace(/\0/g, ''), 180);
      if (name === 'TIT2') metadata.title = value; if (name === 'TPE1') metadata.artist = value;
      if (name === 'TLEN' && Number(value) > 0) metadata.duration = Number(value) / 1000;
    }
    offset += size + 10;
  }
  return metadata;
}
class LocalLibrary {
  constructor(filename, downloadsDirectory) {
    this.filename = filename; this.downloadsDirectory = downloadsDirectory; this.tracks = []; this.queue = []; this.current = null; this.repeat = 'off'; this.lastScan = 0;
    try { const data = JSON.parse(fs.readFileSync(filename, 'utf8')); this.tracks = (data.tracks || []).filter(row => /^[a-f0-9]{32}$/.test(row.id) && typeof row.path === 'string' && EXTENSIONS.has(path.extname(row.path).toLowerCase())).slice(0, 2000); } catch { /* First run. */ }
  }
  save() { writeJson(this.filename, { tracks: this.tracks }); }
  import(files) {
    if (!Array.isArray(files) || files.length > 2000) throw new Error('Выбери до 2000 аудиофайлов.');
    const added = [];
    for (const file of files) {
      if (typeof file !== 'string' || !EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      let absolute, stat; try { absolute = fs.realpathSync(file); stat = fs.statSync(absolute); } catch { continue; }
      if (!stat.isFile() || !stat.size || stat.size > 2 ** 32) continue;
      const existing = this.tracks.find(row => row.path === absolute); if (existing) { added.push(existing); continue; }
      if (this.tracks.length >= 2000) break;
      const fd = fs.openSync(absolute, 'r'); let metadata;
      try { const buffer = Buffer.alloc(Math.min(stat.size, 262144)); fs.readSync(fd, buffer, 0, buffer.length, 0); metadata = id3(buffer); } finally { fs.closeSync(fd); }
      const basename = path.basename(absolute, path.extname(absolute)), parts = basename.split(' - ');
      const row = { id: crypto.createHash('sha256').update(absolute).digest('hex').slice(0, 32), path: absolute, title: metadata.title || text(parts.length > 1 ? parts.slice(1).join(' - ') : basename), artist: metadata.artist || (parts.length > 1 ? text(parts[0], 100) : 'Локальная музыка'), duration: metadata.duration || 0, addedAt: Date.now() };
      this.tracks.unshift(row); added.push(row);
    }
    this.save(); return added;
  }
  scan(force = false) {
    if (!force && Date.now() - this.lastScan < 30000) return; this.lastScan = Date.now();
    for (const row of this.tracks) row.exists = fs.existsSync(row.path);
    let files; try { files = fs.readdirSync(this.downloadsDirectory, { withFileTypes: true }).filter(row => row.isFile()).slice(0, 2000).map(row => path.join(this.downloadsDirectory, row.name)); } catch { return; }
    if (files.some(file => EXTENSIONS.has(path.extname(file).toLowerCase()) && !this.tracks.some(row => row.path === file))) this.import(files);
  }
  state() { return { tracks: this.tracks.map(({ path: filename, ...row }) => ({ ...row, url: 'lolzcloud-local://' + row.id, exists: row.exists !== false })), queue: [...this.queue], current: this.current, repeat: this.repeat }; }
  get(id) { const row = this.tracks.find(row => row.id === id); if (!row || !fs.existsSync(row.path)) throw new Error('Файл не найден. Подключи его заново.'); return row; }
  play(id, queue) { const row = this.get(id); this.queue = (Array.isArray(queue) ? queue : this.tracks.map(row => row.id)).filter(value => this.tracks.some(row => row.id === value)); if (!this.queue.includes(id)) this.queue.unshift(id); this.current = id; return { ...row, url: 'lolzcloud-local://' + row.id, source: pathToFileURL(row.path).href }; }
  step(direction = 1, ended = false) {
    if (ended && this.repeat === 'one') return this.play(this.current, this.queue);
    let index = this.queue.indexOf(this.current) + direction;
    if (index < 0 || index >= this.queue.length) { if (this.repeat !== 'all') return null; index = (index + this.queue.length) % this.queue.length; }
    for (let attempts = 0; attempts < this.queue.length; attempts++, index += direction) { try { return this.play(this.queue[index], this.queue); } catch { if (index < 0 || index >= this.queue.length) break; } }
    return null;
  }
  duration(id, seconds) { if (Number.isFinite(seconds) && seconds > 0 && seconds <= 14400) { const row = this.get(id); if (Math.abs(row.duration - seconds) > .5) { row.duration = seconds; this.save(); } } }
  remove(id) { this.tracks = this.tracks.filter(row => row.id !== id); this.queue = this.queue.filter(value => value !== id); this.save(); }
}
module.exports = { LocalLibrary, id3, EXTENSIONS };
