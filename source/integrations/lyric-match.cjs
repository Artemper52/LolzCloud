'use strict';
const normal = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function sameRecording(candidate, track) {
  if (!candidate || !normal(track.title) || !normal(track.artist)) return false;
  if (normal(candidate.title) !== normal(track.title) || normal(candidate.artist) !== normal(track.artist)) return false;
  return !(track.duration > 0 && (!(candidate.duration > 0) || Math.abs(candidate.duration - track.duration) > 2.5));
}
const wordCoverage = result => {
  const lines = result?.lines?.filter(line => normal(line.text)) || [];
  return lines.length ? lines.filter(line => line.words?.length > 0).length / lines.length : 0;
};
const quality = result => wordCoverage(result) >= .8 ? 3 : result?.lines?.length ? 2 : result?.plain ? 1 : 0;

// Only transplant existing word timestamps; never estimate words from a line's duration.
// Character offsets allow a donor's two short rows to complete one long row, and vice versa.
function mergeTimings(base, donor) {
  if (!base?.lines?.length || !donor?.lines?.length || !wordCoverage(donor)) return base;
  const baseText = base.lines.map(line => normal(line.text)).join(''), donorText = donor.lines.map(line => normal(line.text)).join('');
  if (baseText.length < 12 || baseText !== donorText) return base;
  let cursor = 0;
  const spans = donor.lines.flatMap(line => {
    const start = cursor; cursor += normal(line.text).length;
    if (!line.words?.length || normal(line.words.map(word => word.text).join('')) !== normal(line.text)) return [];
    let position = start;
    return line.words.map(word => { const from = position; position += normal(word.text).length; return { ...word, from, to: position }; });
  });
  cursor = 0; let merged = 0;
  const lines = base.lines.map(line => {
    const from = cursor, to = cursor += normal(line.text).length;
    if (line.words?.length || from === to) return line;
    const words = spans.filter(word => word.from >= from && word.to <= to && word.to > word.from);
    if (!words.length || words[0].from !== from || words.at(-1).to !== to || Math.abs(words[0].time - line.time) > 1.5) return line;
    const next = base.lines[base.lines.indexOf(line) + 1];
    if (next && words.at(-1).time >= next.time + .15) return line;
    merged++;
    return { ...line, time: words[0].time, words: words.map(({ from: unusedFrom, to: unusedTo, ...word }) => word), end: words.at(-1).end || line.end };
  });
  if (!merged) return base;
  return { ...base, lines, merged: true, timingSource: donor.source, credits: [...(base.credits || []), ...(donor.credits || [])], source: base.source === donor.source ? base.source : base.source + ' + ' + donor.source };
}
function bestLyrics(results) {
  if (!results.length) return { lines: [], plain: '', found: false, source: '' };
  let best = results.reduce((value, next) => quality(next) > quality(value) ? next : value);
  for (const donor of results) if (donor !== best) best = mergeTimings(best, donor);
  return { ...best, found: !!quality(best), precision: wordCoverage(best) ? 'word' : best.lines?.length ? 'line' : 'plain' };
}
module.exports = { normal, sameRecording, wordCoverage, quality, mergeTimings, bestLyrics };
