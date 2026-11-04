(() => {
  'use strict';
  const { request, avatar } = window.LolzCloudSite, el = id => document.getElementById(id), id = location.pathname.match(/\/room\/([a-f0-9]{32})/)?.[1];
  const key = 'lolzcloud-room-' + id;
  let connection; try { connection = sessionStorage.getItem(key); if (!connection) { connection = crypto.randomUUID(); sessionStorage.setItem(key, connection); } } catch { connection = crypto.randomUUID(); }
  let data = null, widget = null, loaded = '', started = false, ready = false, busy = false, stopped = false, receivedAt = 0, signature = '';
  function target() { const track = data?.playback; return Math.min(track?.duration || 14400, (track?.position || 0) + (track?.playing ? (Math.max(0, data.serverTime - data.updatedAt) / 1000 + (performance.now() - receivedAt) / 1000) * (track.rate || 1) : 0)) * 1000; }
  function sync() {
    if (!widget || !ready || !data) return;
    if (!started || !data.playback.playing || !data.playback.url) { widget.pause(); return; }
    widget.play(); const track = data.playback.url;
    widget.getPosition(position => { if (started && ready && data?.playback.url === track && Math.abs(position - target()) > 1600) widget.seekTo(target()); });
  }
  function render(value) {
    data = value; receivedAt = performance.now();
    el('track-title').textContent = value.playback.title; el('track-artist').textContent = value.playback.artist;
    el('room-status').textContent = value.owner.name + ' · ведущий' + (value.playback.playing ? ' · играет' : ' · пауза');
    const people = JSON.stringify(value.participants);
    if (people !== signature) {
      signature = people; el('participants').replaceChildren(); el('people-count').textContent = value.participants.length;
      for (const user of value.participants) {
        const link = document.createElement('a'); link.className = 'person'; link.href = user.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const info = document.createElement('span'); info.className = 'person-info'; const name = document.createElement('strong'), role = document.createElement('small');
        name.textContent = user.name; role.textContent = user.host ? user.online ? 'Ведущий' : 'Ведущий не в сети' : 'Слушает с нами'; info.append(name, role); link.append(avatar(user), info);
        if (user.online) { const dot = document.createElement('span'); dot.className = 'online'; link.append(dot); }
        el('participants').append(link);
      }
    }
    const url = value.playback.url; el('player').parentElement.classList.toggle('has-track', !!url);
    if (!url) { if (widget) widget.pause(); el('join').disabled = true; return; }
    if (url !== loaded) {
      loaded = url; ready = false; el('join').disabled = true;
      if (widget) widget.load(url, { auto_play: false, show_comments: false, show_reposts: false, show_user: true });
      else {
        el('player').src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) + '&auto_play=false&show_comments=false&show_reposts=false';
        widget = SC.Widget(el('player')); widget.bind(SC.Widget.Events.READY, () => { ready = true; el('join').disabled = false; widget.seekTo(target()); sync(); });
        widget.bind(SC.Widget.Events.ERROR, () => { el('status').textContent = 'SoundCloud не смог открыть этот трек. Проверь его доступность или вход в SoundCloud.'; });
      }
    }
    sync();
  }
  el('join').onclick = () => { started = !started; el('join').textContent = started ? 'Приостановить у меня' : 'Подключиться к прослушиванию'; sync(); };
  el('copy-invite').onclick = async () => { try { await navigator.clipboard.writeText(location.origin + '/room/' + id + '/'); el('status').textContent = 'Приглашение скопировано.'; } catch { el('status').textContent = 'Скопируй ссылку на комнату из адресной строки.'; } };
  async function poll() {
    if (busy || stopped) return; busy = true;
    try { if (!await window.LolzCloudSessionReady) return; render(await request('/api/rooms/' + id + '/join', { connection })); el('status').textContent = ''; }
    catch (error) { el('status').textContent = error.message; if (/закрыта|не найдена/.test(error.message)) { stopped = true; widget?.pause(); el('join').disabled = true; el('participants').replaceChildren(); el('people-count').textContent = '0'; } }
    finally { busy = false; }
  }
  window.addEventListener('pagehide', () => { if (!window.LolzCloudSession) return; fetch('/api/rooms/' + id + '/leave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.LolzCloudSession.csrf }, body: JSON.stringify({ connection }), keepalive: true }).catch(() => {}); });
  setInterval(poll, 3000); void poll();
})();
