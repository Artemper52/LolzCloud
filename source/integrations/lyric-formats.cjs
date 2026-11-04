'use strict';
const { DOMParser } = require('@xmldom/xmldom');

const timecode = value => {
  const text = String(value || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^\d+(?:\.\d+)?ms$/.test(text)) return parseFloat(text) / 1000;
  if (/^\d+(?:\.\d+)?s$/.test(text)) return parseFloat(text);
  if (!/^\d+(?::\d{2}){1,2}(?:\.\d+)?$/.test(text)) return NaN;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};
function tidyLines(lines) {
  return lines.filter(line => Number.isFinite(line.time) && line.time >= 0 && typeof line.text === 'string')
    .map(line => {
      const result = { time: line.time, text: line.text.slice(0, 4000) };
      if (Number.isFinite(line.end) && line.end > line.time) result.end = line.end;
      const words = line.words?.filter(word => Number.isFinite(word.time) && word.time >= line.time - .05 && typeof word.text === 'string' && word.text);
      const normalized = text => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
      if (words?.length && normalized(words.map(word => word.text).join('')) === normalized(line.text) && words.every((word, index) => !index || word.time >= words[index - 1].time)) result.words = words.slice(0, 1000).map(word => ({ time: word.time, text: word.text, ...(Number.isFinite(word.end) && word.end > word.time ? { end: word.end } : {}) }));
      return result;
    }).sort((a, b) => a.time - b.time).slice(0, 1000);
}
function parseLrc(text) {
  const input = String(text || '').slice(0, 100_000), output = [];
  const offset = Number(input.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const stampTime = stamp => Number(stamp[1]) * 60 + Number(stamp[2]) + Number('0.' + (stamp[3] || '0')) + offset;
  for (const line of input.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)].filter(stamp => Number(stamp[2]) < 60);
    const body = line.replace(/\[[^\]]*\]/g, '').trim();
    const words = [...body.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g)].filter(stamp => Number(stamp[2]) < 60).map(stamp => ({ time: stampTime(stamp), text: stamp[4] }));
    const plain = body.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const stamp of stamps) {
      const time = stampTime(stamp), row = { time: Math.max(0, time), text: plain };
      if (words.length) row.words = words.map(word => ({ ...word, time: Math.max(0, word.time + time - stampTime(stamps[0])) }));
      output.push(row);
    }
  }
  return tidyLines(output);
}
function readTtml(input) {
  const empty = { lines: [], plain: '' };
  if (typeof input !== 'string' || input.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(input)) return empty;
  try {
    const doc = new DOMParser({ onError: () => { throw new Error('Invalid XML'); } }).parseFromString(input, 'application/xml');
    const paragraphs = [...doc.getElementsByTagName('*')].filter(node => node.localName === 'p'), lines = [], plain = [];
    for (const p of paragraphs) {
      const time = timecode(p.getAttribute('begin')), end = timecode(p.getAttribute('end'));
      const words = []; let text = '';
      const visit = (node, timedParent = null) => {
        if (node.nodeType === 3 || node.nodeType === 4) {
          const content = node.data.replace(/[\r\n\t]+/g, ' ');
          text += content;
          if (timedParent) {
            const previous = words.at(-1);
            if (previous && previous.owner === timedParent) previous.text += content;
            else words.push({ owner: timedParent, time: timecode(timedParent.getAttribute('begin')), end: timecode(timedParent.getAttribute('end')), text: content });
          } else if (words.length && /^\s+$/.test(content)) words.at(-1).text += content;
          return;
        }
        if (node.nodeType !== 1) return;
        // Translations, romanisations and backing vocals have their own timeline.
        const role = node.getAttribute('ttm:role') || node.getAttribute('role') || '';
        if (/x-bg|x-translation|x-roman/i.test(role)) return;
        if (node.localName === 'br') { text += '\n'; if (words.length) words.at(-1).text += '\n'; return; }
        const owner = node.localName === 'span' && Number.isFinite(timecode(node.getAttribute('begin'))) ? node : timedParent;
        for (const child of node.childNodes) visit(child, owner);
      };
      for (const child of p.childNodes) visit(child);
      plain.push(text.trim());
      if (Number.isFinite(time)) lines.push({ time, end, text: text.trim(), words: words.map(({ owner, ...word }) => word) });
    }
    const timed = tidyLines(lines); return { lines: timed, plain: timed.length ? '' : plain.join('\n').slice(0, 60_000) };
  } catch { return empty; }
}
const parseTtml = input => readTtml(input).lines;
function parseYrc(text) {
  const lines = [];
  for (const row of String(text || '').slice(0, 200_000).split(/\r?\n/)) {
    const line = row.match(/^\[(\d+),(\d+)\](.*)$/); if (!line) continue;
    const words = [...line[3].matchAll(/\((\d+),(\d+),\d+\)([^()]*)/g)].map(match => ({ time: Number(match[1]) / 1000, end: (Number(match[1]) + Number(match[2])) / 1000, text: match[3] }));
    lines.push({ time: Number(line[1]) / 1000, end: (Number(line[1]) + Number(line[2])) / 1000, text: words.map(word => word.text).join(''), words });
  }
  return tidyLines(lines);
}
function parseRichsync(body) {
  try {
    const rows = typeof body === 'string' ? JSON.parse(body) : body;
    return tidyLines(Array.isArray(rows) ? rows.map(row => {
      let cursor = 0, valid = true;
      const words = row.l?.map(word => {
        const at = String(row.x || '').indexOf(word.c, cursor); if (at < cursor) valid = false;
        const end = at + word.c.length, text = at >= cursor ? row.x.slice(cursor, end) : word.c; cursor = end;
        return { time: row.ts + word.o, text };
      });
      if (valid && words?.length) words.at(-1).text += String(row.x || '').slice(cursor);
      return { time: row.ts, end: row.te, text: row.x || '', words: valid ? words : [] };
    }) : []);
  } catch { return []; }
}
function parseSpicy(payload) {
  const body = payload?.Body || payload;
  if (body?.Type === 'Static' && Array.isArray(body.Lines)) return { lines: [], plain: body.Lines.map(row => row.Text || '').join('\n').slice(0, 60_000) };
  if (!Array.isArray(body?.Content)) return { lines: [], plain: '' };
  if (body.Type === 'Static') return { lines: [], plain: body.Content.map(row => row.Text || row.Lead?.Text || '').join('\n') };
  const lines = body.Content.filter(row => row.Type !== 'Interlude').map(row => {
    const lead = row.Lead || row, syllables = lead.Syllables || [];
    const words = syllables.map((part, index) => ({ time: part.StartTime, end: part.EndTime, text: String(part.Text || '') + (!part.IsPartOfWord && index < syllables.length - 1 && !/\s$/.test(part.Text || '') ? ' ' : '') }));
    return { time: lead.StartTime ?? row.StartTime, end: lead.EndTime ?? row.EndTime, text: words.length ? words.map(word => word.text).join('') : lead.Text || row.Text || '', words };
  });
  return { lines: tidyLines(lines), plain: '' };
}
function lyricIndex(lines, position) {
  let low = 0, high = lines.length;
  while (low < high) { const mid = (low + high) >>> 1; if (lines[mid].time <= position) low = mid + 1; else high = mid; }
  return low - 1;
}
module.exports = { parseLrc, parseTtml, readTtml, parseYrc, parseRichsync, parseSpicy, lyricIndex, tidyLines, timecode };
