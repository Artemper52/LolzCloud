(() => {
  'use strict';
  const C = window.LolzCloudAppCore, DB = window.LolzCloudOffline;
  function probe(blob) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(), url = URL.createObjectURL(blob); let done = false;
      const finish = error => { if (done) return; done = true; clearTimeout(timer); const duration = audio.duration; audio.oncanplay = audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); error ? reject(error) : resolve(duration); };
      const timer = setTimeout(() => finish(new Error('Браузер не смог открыть этот аудиофайл. Попробуй MP3 или WAV.')), 15000);
      audio.preload = 'auto'; audio.oncanplay = () => finish(!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 86400 ? new Error('Не удалось определить длительность аудио.') : null);
      audio.onerror = () => finish(new Error('Файл повреждён или его формат не поддерживается этим браузером.'));
      audio.src = url; audio.load();
    });
  }
  async function audio(file) {
    if (!(file instanceof Blob) || !file.size || file.size > 20_000_000) throw new Error('Аудиофайл должен быть не больше 20 МБ.');
    const mime = C.audioFileType(file.name, new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    if (!mime) throw new Error('Выбери настоящий MP3, WAV, M4A или FLAC.');
    const blob = file.slice(0, file.size, mime), duration = await probe(blob);
    const title = String(file.name).replace(/\.(mp3|wav|m4a|flac)$/i, '').trim().slice(0, 300) || 'Локальная запись';
    const track = C.localTrack({ id: 'local:' + crypto.randomUUID(), local: true, source: 'local', audioUrl: '', title, artist: '', duration });
    if (!track) throw new Error('Не удалось прочитать запись.');
    await DB.saveLocal(track, blob, file.name); return track;
  }
  async function lyrics(file) {
    if (!(file instanceof Blob) || file.size > 512 * 1024 || !file.size) throw new Error('Выбери TXT или LRC до 512 КБ.');
    return C.importedLyrics(file.name, new Uint8Array(await file.arrayBuffer()));
  }
  window.LolzCloudImports = Object.freeze({ audio, lyrics });
})();
