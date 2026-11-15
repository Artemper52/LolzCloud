/* Timed text only: rendering never changes playback, focus or scroll position. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LolzCloudLyricView=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const validTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400;
  // Old policy3 caches retained enhanced markers inside line.text, without the
  // original transcript. They are display syntax, not usable word timing: the
  // cached line may already have been retimed to a different recording.
  const legacyText = value => value.replace(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g,
    (marker, minutes, seconds, fraction) => Number(seconds) < 60 && validTime(Number(minutes) * 60 + Number(seconds) + Number('0.' + (fraction || '0'))) ? '' : marker).trim();
  function create(element, { seek = () => {} } = {}) {
    if (!element?.ownerDocument || typeof seek !== 'function') throw new TypeError('A lyric element and seek callback are required.');
    const doc = element.ownerDocument; let entries = [], activeLine = -1, activeWord = -1;
    const clock = value => Math.floor(value / 60) + ':' + String(Math.floor(value) % 60).padStart(2, '0');
    function latest(rows, position) {
      let first = 0, last = rows.length;
      while (first < last) { const middle = (first + last) >>> 1; if (rows[middle].time <= position) first = middle + 1; else last = middle; }
      return first - 1;
    }
    function unsetLine() { if (activeLine < 0) return; const row = entries[activeLine]; row.node.removeAttribute('data-active'); row.node.removeAttribute('aria-current'); if (activeWord >= 0) row.words[activeWord].node.removeAttribute('data-active'); }
    function clear() { entries = []; activeLine = activeWord = -1; element.replaceChildren(); }
    function render(lines, { plain = '', instrumental = false, seekable = true } = {}) {
      clear(); const fragment = doc.createDocumentFragment(); let wordCount = 0;
      const rows = (Array.isArray(lines) ? lines : []).slice(0, 4000).filter(row => row && validTime(row.time) && typeof row.text === 'string' && row.text.length <= 4000).slice().sort((a,b) => a.time - b.time);
      for (const row of rows) {
        const button = doc.createElement(seekable === false ? 'p' : 'button'); if (seekable !== false) button.type = 'button'; button.className = 'lyric-line'; button.dataset.time = String(row.time);
        const sourceWords = Array.isArray(row.words) && row.words.length > 0 && row.words.length <= 512 ? row.words : [];
        const timed = sourceWords.length > 0 && wordCount + sourceWords.length <= 16000 && sourceWords.every((word,i) => word && validTime(word.time) && word.time >= row.time - .05 && typeof word.text === 'string' && word.text.length > 0 && word.text.length <= 4000 && (!i || word.time >= sourceWords[i-1].time) && (word.end === undefined || validTime(word.end) && word.end >= word.time)) && sourceWords.map(word => word.text).join('') === row.text;
        const displayText = timed ? row.text : legacyText(row.text);
        button.setAttribute('aria-label', (displayText || 'Пауза в тексте') + ', ' + clock(row.time));
        const words = []; if (timed) for (const word of sourceWords) {
          const span = doc.createElement('span'); span.className = 'lyric-word'; span.dataset.time = String(word.time); if (word.end !== undefined) span.dataset.end = String(word.end); span.textContent = word.text; button.append(span);
          words.push({ time: word.time, end: word.end, node: span });
        }
        else button.textContent = displayText || '♪';
        wordCount += words.length;
        entries.push({ time: row.time, end: validTime(row.end) && row.end >= row.time ? row.end : undefined, node: button, words }); fragment.append(button);
      }
      if (entries.length) element.append(fragment);
      else element.textContent = instrumental ? 'Инструментальная запись' : typeof plain === 'string' ? plain.slice(0, 200000) : '';
    }
    function update(position) {
      let line = validTime(position) ? latest(entries, position) : -1;
      if (line >= 0 && entries[line].end !== undefined && position >= entries[line].end) line = -1;
      let word = line >= 0 ? latest(entries[line].words, position) : -1;
      if (word >= 0 && entries[line].words[word].end !== undefined && position >= entries[line].words[word].end) word = -1;
      if (line !== activeLine) {
        unsetLine(); activeLine = line; activeWord = -1;
        if (line >= 0) { entries[line].node.dataset.active = 'true'; entries[line].node.setAttribute('aria-current', 'true'); }
      }
      if (word !== activeWord && activeLine >= 0) {
        if (activeWord >= 0) entries[activeLine].words[activeWord].node.removeAttribute('data-active');
        activeWord = word; if (word >= 0) entries[activeLine].words[word].node.dataset.active = 'true';
      }
    }
    element.addEventListener('click', event => {
      const line = event.target.closest?.('button.lyric-line'); if (!line || !element.contains(line)) return;
      const row = entries.find(row => row.node === line); if (row) seek(row.time);
    });
    return Object.freeze({ render, update, clear });
  }
  return Object.freeze({ create });
});
