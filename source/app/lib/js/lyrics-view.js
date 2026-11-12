(() => {
  'use strict';
  class LyricsView {
    constructor(container, { onSeek = () => {}, onFollowChange = () => {}, onCredit = null } = {}) {
      this.container = container; this.onSeek = onSeek; this.onFollowChange = onFollowChange; this.onCredit = onCredit;
      this.signature = ''; this.lines = []; this.nodes = []; this.active = -2; this.position = 0; this.following = true; this.autoFollow = true; this.resumeAt = 0; this.scrollingUntil = 0;
      container.classList.add('lc-lyrics-view'); container.tabIndex = 0;
      container.setAttribute('role', 'region'); container.setAttribute('aria-label', 'Текст песни');
      this.stage = document.createElement('div'); this.stage.className = 'lc-lyrics-stage';
      this.empty = document.createElement('div'); this.empty.className = 'lc-lyrics-empty';
      container.replaceChildren(this.stage, this.empty);
      this.credits = document.createElement('div'); this.credits.className = 'lc-lyrics-credits'; this.credits.hidden = true; container.after(this.credits);
      const peek = () => { if (!this.lines.length || !this.autoFollow) return; this.setFollow(false); this.resumeAt = performance.now() + 4000; };
      container.addEventListener('wheel', event => { if (Math.abs(event.deltaY) > .5) peek(); }, { passive: true });
      container.addEventListener('touchmove', peek, { passive: true });
      container.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) peek(); });
      new ResizeObserver(() => { if (this.following) this.center(); }).observe(container);
      setInterval(() => {
        if (!this.sample || !container.clientHeight) return;
        if (this.autoFollow && this.resumeAt && performance.now() >= this.resumeAt) this.setFollow(true);
        const elapsed = this.sample.playing ? (performance.now() - this.sample.at) / 1000 * this.sample.rate : 0;
        this.setPosition(Math.min(this.sample.duration || Infinity, this.sample.position + Math.min(2, elapsed)));
        if (this.lines.length && this.following && performance.now() > this.scrollingUntil) {
          const node = this.nodes[Math.max(0, this.active)], bounds = container.getBoundingClientRect(), line = node?.getBoundingClientRect();
          if (line && Math.abs(line.top + line.height / 2 - bounds.top - bounds.height * .44) > Math.max(35, bounds.height * .18)) this.center();
        }
      }, 100);
    }
    setFollow(value) {
      if (value) this.resumeAt = 0;
      if (this.following === value) return;
      this.following = value; this.onFollowChange(value);
      if (value) this.center();
    }
    setAutoFollow(value) { if (this.autoFollow === value) return; this.autoFollow = value; this.setFollow(value); }
    setCanSeek(value) {
      this.canSeek=value;
      for(const node of this.nodes)if(node.tagName==='BUTTON'){node.disabled=!value;node.title=value?'Слушать с этой строки':'Позицию выбирает ведущий комнаты';}
    }
    setFontScale(value) {
      const scale = Math.max(.7, Math.min(2, Number(value) || 1)); if (this.fontScale === scale) return;
      this.fontScale = scale; this.container.style.setProperty('--lyrics-scale', String(scale));
      if (this.following) requestAnimationFrame(() => this.center());
    }
    setData(data) {
      const signature = data ? data.key + ':' + data.revision + ':' + data.loading : '';
      if (signature === this.signature) return;
      this.signature = signature; this.data = data;
      const credits = data?.credits || (data?.source ? [{ name: data.source }] : []);
      this.credits.replaceChildren(); this.credits.hidden = !data?.found;
      const seen = new Set();
      for (const credit of credits) {
        if (!credit.name || seen.has(credit.name)) continue; seen.add(credit.name);
        const link = document.createElement(/^https:\/\//.test(credit.url || '') ? 'a' : 'span'); link.textContent = credit.name;
        if (link.tagName === 'A') { link.href = credit.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; if (this.onCredit) link.onclick = event => { event.preventDefault(); this.onCredit(credit.url); }; }
        this.credits.append(link);
      }
      if (data?.copyright) { const copyright = document.createElement('span'); copyright.textContent = data.copyright; this.credits.append(copyright); }
      const contentSignature = JSON.stringify([data?.key, data?.lines, data?.plain, data?.found ? false : data?.loading, data?.error]);
      if (contentSignature === this.contentSignature) return;
      const sameTrack = this.trackKey === data?.key, previousScroll = this.container.scrollTop;
      this.contentSignature = contentSignature; this.trackKey = data?.key; this.active = -2;
      this.lines = data?.lines || []; this.nodes = [];
      this.stage.replaceChildren(); this.empty.replaceChildren();
      const hasWords = !!(this.lines.length || data?.plain);
      this.stage.hidden = !hasWords; this.empty.hidden = hasWords;
      this.container.classList.toggle('is-plain', !this.lines.length);
      if (data?.loading && !hasWords) {
        const caption = document.createElement('span'); caption.textContent = 'Находим слова твоей музыки'; this.empty.append(caption);
        for (let index = 0; index < 3; index++) { const bar = document.createElement('i'); bar.className = 'lc-lyric-skeleton'; this.empty.append(bar); }
      } else if (!hasWords) {
        const mark = document.createElement('strong'); mark.textContent = data?.instrumental ? '♫' : '♪';
        const caption = document.createElement('p'); caption.textContent = data?.error || (data?.instrumental ? 'Здесь говорит музыка' : 'Пока без слов');
        const note = document.createElement('small'); note.textContent = data?.instrumental ? 'Инструментальная композиция' : 'Для этой версии трека текст ещё не найден.';
        this.empty.append(mark, caption, note);
      } else {
        const rows = this.lines.length ? this.lines : data.plain.split('\n').map(text => ({ text }));
        rows.forEach((line, index) => {
          const node = document.createElement(this.lines.length ? 'button' : 'p'); node.className = 'lc-lyric';
          if (Array.isArray(line.words) && line.words.length) {
            node.classList.add('has-words');
            for (const word of line.words) { const span = document.createElement('span'); span.className = 'lc-word'; span.textContent = word.text; node.append(span); }
          } else node.textContent = line.text || '•••';
          if (this.lines.length) { node.type = 'button'; node.disabled=this.canSeek===false; node.title = node.disabled?'Позицию выбирает ведущий комнаты':'Слушать с этой строки'; node.onclick = () => { this.setFollow(true); void this.onSeek(line.time); }; }
          this.nodes.push(node); this.stage.append(node);
        });
      }
      this.container.scrollTop = sameTrack ? previousScroll : 0;
      if (!sameTrack) this.setFollow(this.autoFollow);
      this.setPosition(this.position);
    }
    setPlayback(track, fresh = true) {
      const playing = track.playing && fresh, rate = track.rate || 1;
      this.container.classList.toggle('is-playing', !!playing);
      const key = [track.title, track.artist, track.duration].join('\n');
      if (this.seekIntent) {
        const expected = this.seekIntent.position + (playing ? (performance.now() - this.seekIntent.at) / 1000 * rate : 0);
        if (this.seekIntent.key !== key || performance.now() > this.seekIntent.until || Math.abs(track.position - expected) < 1) this.seekIntent = null;
        else return;
      }
      if (!this.sample || this.sample.key !== key || this.sample.position !== track.position || this.sample.playing !== playing || this.sample.rate !== rate) {
        this.sample = { key, position: track.position, duration: track.duration, rate, playing, at: performance.now() };
        this.setPosition(track.position);
      }
    }
    seek(position) {
      if (this.sample) {
        const now = performance.now();
        this.sample = { ...this.sample, position, at: now };
        this.seekIntent = { key: this.sample.key, position, at: now, until: now + 2500 };
      }
      this.setPosition(position); this.setFollow(true);
    }
    setPosition(value) {
      this.position = value;
      if (!this.lines.length) return;
      let low = 0, high = this.lines.length;
      while (low < high) { const mid = (low + high) >>> 1; if (this.lines[mid].time <= value) low = mid + 1; else high = mid; }
      const index = low - 1;
      const words = this.lines[index]?.words;
      if (words?.length) {
        const activeWord = words.findLastIndex(word => word.time <= value);
        [...this.nodes[index].children].forEach((node, number) => {
          const ended = Number.isFinite(words[number].end) && value >= words[number].end;
          node.classList.toggle('is-spoken', number < activeWord || (number === activeWord && ended)); node.classList.toggle('is-current', number === activeWord && !ended);
          if (number === activeWord) { const end = words[number].end || words[number + 1]?.time || this.lines[index].end || this.lines[index + 1]?.time || words[number].time + .7; node.style.setProperty('--word-fill', Math.min(100, Math.max(0, (value - words[number].time) / Math.max(.08, end - words[number].time) * 100)) + '%'); }
        });
      }
      if (this.active === index) return;
      this.active = index;
      this.nodes.forEach((node, number) => {
        node.classList.toggle('is-active', number === index);
        node.classList.toggle('is-past', number < index);
        node.classList.toggle('is-near', Math.abs(number - Math.max(0, index)) <= 1);
        node.style.setProperty('--line-distance', String(Math.min(3, Math.abs(number - Math.max(0, index)))));
        node.style.setProperty('--line-delay', Math.min(110, Math.abs(number - Math.max(0, index)) * 28) + 'ms');
        if (number === index) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');
      });
      if (this.following) this.center();
    }
    center() {
      const node = this.nodes[Math.max(0, this.active)]; if (!node || !this.container.clientHeight) return;
      const bounds = this.container.getBoundingClientRect(), line = node.getBoundingClientRect();
      const top = this.container.scrollTop + line.top + line.height / 2 - bounds.top - bounds.height * .44;
      this.scrollingUntil = performance.now() + 650;
      this.container.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth' });
    }
  }
  window.LolzCloudLyricsView = LyricsView;
})();
