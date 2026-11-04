(() => {
  const client = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  const frame = document.getElementById('player');
  let widget, joined = false, current = '', ready = false, syncing = false;
  document.getElementById('join').onclick = () => { joined = true; document.getElementById('join').hidden = true; frame.hidden = false; void sync(); };
  async function sync() {
    if (syncing) return; syncing = true;
    try {
      const response = await fetch('state?client=' + client); if (!response.ok) throw new Error(); const state = await response.json();
      document.getElementById('host').textContent = 'Ведущий · ' + state.host;
      document.getElementById('track').textContent = [state.artist, state.title].filter(Boolean).join(' — ');
      document.getElementById('status').textContent = state.playing ? 'В эфире · синхронизация каждую секунду' : 'Ведущий поставил музыку на паузу';
      if (!joined) return;
      if (!state.url) { widget?.pause(); return; }
      if (!widget) {
        frame.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(state.url) + '&auto_play=true&color=%2372d99a';
        widget = SC.Widget(frame); current = state.url;
        widget.bind(SC.Widget.Events.READY, () => { ready = true; widget.seekTo(state.position * 1000); if (state.playing) widget.play(); });
      } else if (state.url !== current) {
        current = state.url; ready = false; widget.load(state.url, { auto_play: state.playing, callback: () => { ready = true; widget.seekTo(state.position * 1000); } });
      } else if (ready) {
        widget.getPosition(position => { if (Math.abs(position / 1000 - state.position) > 2) widget.seekTo(state.position * 1000); });
        widget.isPaused(paused => { if (state.playing && paused) widget.play(); else if (!state.playing && !paused) widget.pause(); });
      }
    } catch { document.getElementById('status').textContent = 'Ведущий отключился или комната недоступна.'; widget?.pause(); }
    finally { syncing = false; }
  }
  setInterval(sync, 1000); void sync();
})();
