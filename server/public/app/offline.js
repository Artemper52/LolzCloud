(() => {
  'use strict';
  const MAX_FILE = 20 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024;
  let database;
  function open() {
    if (database) return database;
    if (!window.indexedDB) return Promise.reject(new Error('Хранилище недоступно в этом браузере.'));
    let settled = false;
    const pending = new Promise((resolve, reject) => {
      const request = indexedDB.open('LolzCloud-music-v1', 2);
      const fail = message => { if (settled) return; settled = true; reject(new Error(message)); };
      request.onupgradeneeded = () => { for (const name of ['tracks', 'lyrics', 'userLyrics']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
      request.onsuccess = () => { const db = request.result; if (settled) { db.close(); return; } settled = true; db.onversionchange = () => { db.close(); if (database === pending) database = null; }; resolve(db); };
      request.onerror = () => fail('Не удалось открыть сохранённую музыку. Разреши хранение данных сайта.');
      request.onblocked = () => fail('Закрой другие вкладки LolzCloud и повтори.');
    });
    database = pending; pending.catch(() => { if (database === pending) database = null; });
    return pending;
  }
  async function read(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store)[key === undefined ? 'getAll' : 'get'](key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Не удалось прочитать сохранённые данные.'));
    });
  }
  async function write(store, action, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite'); transaction.objectStore(store)[action](value);
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(new Error(transaction.error?.name === 'QuotaExceededError' ? 'Недостаточно места. Удали ненужные загрузки.' : 'Не удалось сохранить данные. Проверь свободное место.'));
    });
  }
  async function saveLyrics(id, value) {
    const row = { ...value, id }, size = item => new TextEncoder().encode(JSON.stringify(item)).length;
    if (size(row) > 1024 * 1024) throw new Error('Текст слишком большой для кеша.');
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('lyrics', 'readwrite'), store = transaction.objectStore('lyrics'), entries = [];
      store.put(row); const request = store.openCursor(); let total = 0;
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (cursor) { const bytes = size(cursor.value); entries.push({ key: cursor.primaryKey, bytes, at: Number(cursor.value.cachedAt) || 0 }); total += bytes; cursor.continue(); return; }
          entries.sort((a, b) => a.at - b.at); let remaining = entries.length;
          for (const entry of entries) {
            if (remaining <= 500 && total <= 8 * 1024 * 1024) break;
            if (entry.key === id) continue;
            store.delete(entry.key); total -= entry.bytes; remaining--;
          }
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(new Error('Не удалось сохранить кеш текста.'));
    });
  }
  async function list() { return (await read('tracks')).map(({ blob, ...row }) => row); }
  async function save(track, blob) {
    if (!(blob instanceof Blob) || blob.size <= 128 || blob.size > MAX_FILE || !/^audio\/mpeg(?:;|$)/i.test(blob.type)) throw new Error('Получен неполный MP3 или файл больше 20 МБ.');
    const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    if (!(header[0] === 73 && header[1] === 68 && header[2] === 51 || header[0] === 255 && (header[1] & 224) === 224)) throw new Error('Сервис вернул файл, который не является MP3.');
    return commit(track, blob);
  }
  async function saveLocal(track, blob, filename) {
    if (!window.LolzCloudAppCore.localTrack(track) || !(blob instanceof Blob) || !blob.size || blob.size > 20_000_000 || window.LolzCloudAppCore.audioFileType(filename, new Uint8Array(await blob.slice(0, 32).arrayBuffer())) !== blob.type) throw new Error('Не удалось проверить локальный аудиофайл.');
    return commit(track, blob);
  }
  async function commit(track, blob) {
    // Quota check and commit belong to one transaction: concurrent downloads
    // cannot both pass a stale total and silently exceed the app's bound.
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('tracks', 'readwrite'), store = transaction.objectStore('tracks'), request = store.getAll(); let full = false;
      request.onsuccess = () => {
        const bytes = request.result.reduce((sum, row) => sum + (row.id === track.id ? 0 : row.bytes || 0), 0);
        if (bytes + blob.size > MAX_TOTAL) { full = true; transaction.abort(); return; }
        store.put({ ...track, blob, bytes: blob.size, savedAt: Date.now() });
      };
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(new Error(full ? 'Загрузки занимают 256 МБ. Удали ненужные треки.' : 'Не удалось сохранить трек. Проверь свободное место.'));
    });
  }
  window.LolzCloudOffline = { list, get: id => read('tracks', id), remove: id => write('tracks', 'delete', id), save, saveLocal,
    lyrics: id => read('lyrics', id), saveLyrics,
    userLyrics: id => read('userLyrics', id), saveUserLyrics: (id, value) => write('userLyrics', 'put', { id, ...value }), removeUserLyrics: id => write('userLyrics', 'delete', id), MAX_FILE, MAX_TOTAL };
})();
