(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const list = document.getElementById('voicetag-list'), status = document.getElementById('voicetag-status'), volume = document.getElementById('voicetag-volume');
  let player = null, signature = '', playing = '', pending = '';
  const stop = () => { if (player) { player.onended = null; player.onerror = null; player.pause(); player.currentTime = 0; player = null; } playing = ''; document.querySelectorAll('[data-voicetag]').forEach(button => button.setAttribute('aria-pressed', 'false')); };
  window.LolzCloudVoicetags = { stop, state: () => ({ playing, paused: !player || player.paused }) };
  async function action(type, extra = {}) {
    try { const result = await ipcRenderer.invoke('features:action', { type, ...extra }); if (!result.ok) throw Error(result.error); status.textContent = type === 'voicetag-preload' ? 'Набор готов · звуки доступны без интернета' : ''; }
    catch (error) { status.textContent = error.message || 'Не удалось загрузить звук.'; }
  }
  ipcRenderer.on('lolzcloud:voicetag', (_event, value) => {
    stop(); player = new Audio(value.url); player.volume = Math.max(0, Math.min(1, value.volume)); playing = value.id;
    document.querySelectorAll('[data-voicetag]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.voicetag === playing)));
    player.onended = stop; player.onerror = () => { stop(); status.textContent = 'Не удалось воспроизвести звук. Добавь его заново.'; };
    void player.play().catch(() => { stop(); status.textContent = 'Нажми на voicetag ещё раз.'; });
  });
  ipcRenderer.on('lolzcloud:voicetag-stop', stop);
  ipcRenderer.on('lolzcloud:voicetag-volume', (_event, value) => { if (player) player.volume = Math.max(0, Math.min(1, value)); });
  document.getElementById('voicetag-stop').onclick = () => { stop(); void action('voicetag-stop'); };
  document.getElementById('voicetag-preload').onclick = () => action('voicetag-preload');
  document.getElementById('voicetag-import').onclick = () => action('voicetag-import');
  volume.oninput = () => { document.getElementById('voicetag-volume-value').textContent = volume.value + '%'; if (player) player.volume = Number(volume.value) / 100; };
  volume.onchange = () => action('voicetag-volume', { value: Number(volume.value) / 100 });
  window.addEventListener('lolzcloud:state', event => {
    const state = event.detail.features?.voicetags; if (!state) return;
    if (document.activeElement !== volume) volume.value = Math.round(state.volume * 100);
    document.getElementById('voicetag-volume-value').textContent = volume.value + '%';
    const next = JSON.stringify(state.items); if (next === signature) return; signature = next; list.replaceChildren();
    for (const row of state.items) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.voicetag = row.id; button.setAttribute('aria-pressed', String(row.id === playing));
      const title = document.createElement('strong'), subtitle = document.createElement('small'); title.textContent = row.name; subtitle.textContent = row.artist + ' · ' + (row.ready ? 'Готов' : 'Скачать и включить'); button.append(title, subtitle);
      button.onclick = async () => { if (pending) return; pending = row.id; button.disabled = true; status.textContent = row.ready ? '' : 'Скачиваем короткий звук…'; await action('voicetag-play', { id: row.id }); pending = ''; button.disabled = false; }; list.append(button);
    }
  });
})();
