'use strict';
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto'), { spawn } = require('node:child_process');
const { scUrl } = require('./music.cjs');
const { clean } = require('./lolzteam/status.cjs');
function safeFilename(artist, title) {
  let name = clean([artist, title].filter(Boolean).join(' — '), 150).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'Песня ' + (name || 'SoundCloud');
  return name.slice(0, 140).replace(/[.\s]+$/g, '') + '.mp3';
}
function ffmpegPath() {
  const binary = require('ffmpeg-static'); if (!binary) throw new Error('Конвертер MP3 недоступен для этой системы.');
  const unpacked = binary.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  if (!fs.existsSync(unpacked)) throw new Error('Конвертер MP3 отсутствует. Переустанови полную сборку LolzCloud.');
  return unpacked;
}
function encodeMp3(input, output, { track, mp3, signal, onProgress = () => {}, executable = ffmpegPath() }) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-c:a', mp3 ? 'copy' : 'libmp3lame'];
    if (!mp3) args.push('-q:a', '2');
    args.push('-metadata', 'title=' + clean(track.title, 180), '-metadata', 'artist=' + clean(track.artist, 100), '-id3v2_version', '3', '-progress', 'pipe:1', '-f', 'mp3', output);
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let progress = '', micros = 0, settled = false, killTimer;
    const abort = () => { child.kill(); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000); killTimer.unref?.(); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      progress = (progress + chunk.toString()).slice(-8192);
      for (const match of progress.matchAll(/out_time_us=(\d+)/g)) micros = Math.max(micros, Number(match[1]));
      onProgress(track.duration ? Math.min(99, micros / 1_000_000 / track.duration * 100) : null);
    });
    // Native diagnostic output can contain signed media information. Keep it out
    // of user-facing state and logs; sources are local files, never network URLs.
    child.stderr.on('data', () => {});
    const finish = error => { if (settled) return; settled = true; clearTimeout(killTimer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    child.on('error', () => finish(new Error('Не удалось запустить конвертер MP3.')));
    child.on('close', code => {
      if (signal.aborted) return finish(new Error('Скачивание отменено.'));
      if (code !== 0) return finish(new Error('Не удалось преобразовать аудио в MP3. Попробуй скачать трек ещё раз.'));
      if (track.duration > 45 && micros / 1_000_000 < track.duration * .8) return finish(new Error('Получилась неполная запись. Файл не сохранён.'));
      finish();
    });
  });
}
class Downloads {
  constructor({ directory, runtime, filename, source, encoder = encodeMp3 }) {
    Object.assign(this, { directory: path.resolve(directory), runtime: path.resolve(runtime), filename, source, encoder });
    this.items = []; this.running = null; this.closed = false; this.controllers = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      for (const row of Array.isArray(saved) ? saved.slice(-200) : []) {
        if (!/^[a-f0-9-]{36}$/.test(row.id || '') || !scUrl(row.url)) continue;
        const file = typeof row.file === 'string' && path.basename(row.file) === row.file && row.file.endsWith('.mp3') ? row.file : '';
        this.items.push({ id: row.id, url: scUrl(row.url), title: clean(row.title, 180), artist: clean(row.artist, 100), file, bytes: Math.max(0, Number(row.bytes) || 0), createdAt: Number(row.createdAt) || Date.now(), status: row.status === 'complete' && file ? 'complete' : row.status === 'error' ? 'error' : 'cancelled', percent: row.status === 'complete' ? 100 : 0, error: row.status === 'error' ? clean(row.error, 240).replace(/https?:\/\/\S+/g, '[адрес аудио]') : '' });
      }
    } catch { /* First run. */ }
    // Only our UUID-named temporary files are removed after an interrupted run.
    // Final downloads and unrelated files in the runtime directory stay intact.
    try { for (const entry of fs.readdirSync(this.runtime, { withFileTypes: true })) if (entry.isFile() && /^[a-f0-9-]{36}\.(?:source|mp3\.part)$/.test(entry.name)) fs.rmSync(path.join(this.runtime, entry.name)); } catch { /* No runtime directory yet. */ }
  }
  save() { fs.mkdirSync(path.dirname(this.filename), { recursive: true }); fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.items.slice(-200)), { mode: 0o600 }); fs.renameSync(this.filename + '.tmp', this.filename); }
  state() { const seen = new Set(); return { directory: this.directory, items: this.items.slice().reverse().filter(row => { if (seen.has(row.url)) return false; seen.add(row.url); return true; }).slice(0, 80).map(row => ({ ...row, exists: row.status === 'complete' && fs.existsSync(path.join(this.directory, row.file)) })) }; }
  enqueue(track) {
    const url = scUrl(track?.url); if (!url) throw new Error('Сначала выбери трек SoundCloud.');
    if (this.closed) throw new Error('Скачивание завершает работу.');
    const previous = this.items.findLast(row => row.url === url && (['queued', 'downloading', 'converting'].includes(row.status) || row.status === 'complete' && fs.existsSync(path.join(this.directory, row.file))));
    if (previous) return previous.id;
    if (this.items.filter(row => ['queued', 'downloading', 'converting'].includes(row.status)).length >= 20) throw new Error('В очереди уже 20 песен. Дождись завершения.');
    const retry = this.items.findLast(row => row.url === url && ['error', 'cancelled'].includes(row.status));
    if (retry) this.items.splice(this.items.indexOf(retry), 1);
    const item = { id: retry?.id || randomUUID(), url, title: clean(track.title, 180), artist: clean(track.artist, 100), status: 'queued', percent: 0, bytes: 0, file: '', error: '', createdAt: Date.now() };
    this.items.push(item); this.save(); this.pump(); return item.id;
  }
  pump() {
    if (this.running || this.closed) return;
    const item = this.items.find(row => row.status === 'queued'); if (!item) return;
    this.running = this.run(item).finally(() => { this.running = null; this.pump(); });
  }
  async run(item) {
    const control = new AbortController(), timeout = setTimeout(() => control.abort(), 30 * 60_000);
    this.controllers.set(item.id, control);
    const sourceFile = path.join(this.runtime, item.id + '.source'), outputFile = path.join(this.runtime, item.id + '.mp3.part');
    try {
      await fsp.mkdir(this.runtime, { recursive: true }); await fsp.mkdir(this.directory, { recursive: true });
      item.status = 'downloading'; this.save();
      const audio = await this.source.save(item.url, sourceFile, { signal: control.signal, onProgress: value => { item.bytes = value.bytes; item.percent = value.percent; } });
      item.title = audio.track.title; item.artist = audio.track.artist; item.status = 'converting'; item.percent = 0;
      await this.encoder(sourceFile, outputFile, { ...audio, signal: control.signal, onProgress: value => { item.percent = value; } });
      control.signal.throwIfAborted();
      const name = safeFilename(item.artist, item.title);
      for (let suffix = 0; suffix < 1000; suffix++) {
        const file = suffix ? name.slice(0, -4) + ' (' + (suffix + 1) + ').mp3' : name;
        try { await fsp.copyFile(outputFile, path.join(this.directory, file), fs.constants.COPYFILE_EXCL); item.file = file; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!item.file) throw new Error('Слишком много файлов с одинаковым названием.');
      control.signal.throwIfAborted();
      item.bytes = (await fsp.stat(path.join(this.directory, item.file))).size;
      control.signal.throwIfAborted();
      item.status = 'complete'; item.percent = 100;
    } catch (error) {
      item.status = control.signal.aborted ? 'cancelled' : 'error';
      item.error = control.signal.aborted ? 'Скачивание отменено.' : /^(ENOSPC|EACCES|EPERM)$/.test(error.code || '') ? 'Нет места или доступа к папке загрузок.' : clean(error.message, 240).replace(/https?:\/\/\S+/g, '[адрес аудио]');
    } finally {
      clearTimeout(timeout); this.controllers.delete(item.id);
      if (item.status !== 'complete' && item.file) {
        await fsp.rm(path.join(this.directory, item.file), { force: true });
        item.file = '';
      }
      await Promise.allSettled([sourceFile, outputFile].map(file => fsp.rm(file, { force: true })));
      this.save();
    }
  }
  cancel(id) { const item = this.items.find(row => row.id === id); if (!item) return; if (item.status === 'queued') { item.status = 'cancelled'; this.save(); } this.controllers.get(id)?.abort(); }
  retry(id) { const item = this.items.find(row => row.id === id); if (!item) throw new Error('Загрузка не найдена.'); return this.enqueue(item); }
  file(id) { const item = this.items.find(row => row.id === id && row.status === 'complete'); if (!item?.file) throw new Error('Дождись завершения скачивания.'); const file = path.join(this.directory, item.file); if (!fs.existsSync(file)) throw new Error('Файл уже перемещён или удалён.'); return file; }
  async dispose() { this.closed = true; for (const row of this.items) if (row.status === 'queued') row.status = 'cancelled'; for (const control of this.controllers.values()) control.abort(); await this.running; this.save(); }
}
module.exports = { Downloads, safeFilename, encodeMp3, ffmpegPath };
