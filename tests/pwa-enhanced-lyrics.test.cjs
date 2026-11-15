'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../server/public/app/core.js'), Tempo = require('../server/public/app/lyric-tempo.js');

test('enhanced LRC keeps exact source word starts and explicit ends without timing a line-only transcript', () => {
  const rows = C.parseLyrics('[00:10.00]<00:10.00>Свои <00:10.50>слова <00:11.25>\n[00:20]Строка без слов');
  assert.deepEqual(rows, [{ time: 10, text: 'Свои слова', end: 11.25, words: [{ time: 10, end: 10.5, text: 'Свои ' }, { time: 10.5, end: 11.25, text: 'слова' }] }, { time: 20, text: 'Строка без слов' }]);
  assert.equal(rows[1].words, undefined);
});
test('positive and negative offsets apply once to line and word clocks, including clamped pre-roll', () => {
  for (const [offset, time, word, end] of [[1500, 11.5, 12, 13.5], [-1500, 8.5, 9, 10.5], [-11000, 0, 0, 1]]) {
    const row = C.parseLyrics('[offset:' + offset + ']\n[00:10]<00:10.50>Строка<00:12>')[0];
    assert.equal(row.time, time); assert.equal(row.words[0].time, word); assert.equal(row.words[0].end, end); assert.equal(row.end, end);
  }
});
test('repeated line stamps translate independent word copies by the exact occurrence delta', () => {
  const rows = C.parseLyrics('[offset:+250]\n[00:10][00:40]<00:10.5>Один <00:11.2>припев<00:12>');
  assert.deepEqual(rows.map(row => [row.time, row.words[0].time, row.words[1].time, row.end]), [[10.25,10.75,11.45,12.25],[40.25,40.75,41.45,42.25]]);
  assert.notEqual(rows[0].words, rows[1].words); assert.notEqual(rows[0].words[0], rows[1].words[0]);
});
test('malformed/out-of-order/incomplete word stamps fall back to real plain line text rather than inventing timings', () => {
  for (const input of ['[00:10]<00:11>Сначала <00:10>потом', '[00:10]Префикс <00:11>слово', '[00:10]<00:99>ошибка <00:12>секунд', '[00:10]<00:09>слишком рано']) {
    const rows = C.parseLyrics(input); assert.equal(rows.length, 1); assert.equal(rows[0].words, undefined); assert.ok(rows[0].text); assert.ok(!rows[0].text.includes('<00:'));
  }
  assert.equal(C.parseLyrics('[00:10]<00:09.98>Допустимый сдвиг')[0].words[0].time, 9.98);
});
test('parser preserves inert HTML text, punctuation, spaces and legacy colon fractions', () => {
  const row = C.parseLyrics('[00:01:250]<00:01.250><b>Не код</b>, <00:02.50>а текст!')[0];
  assert.equal(row.time, 1.25); assert.equal(row.text, '<b>Не код</b>, а текст!'); assert.equal(row.words.map(word=>word.text).join(''), row.text);
  assert.equal(row.words[1].time, 2.5);
});
test('returned line and word data are immutable and the parser remains bounded', () => {
  const rows = C.parseLyrics('[00:00]<00:00>Слово<00:01>');
  for (const value of [rows, rows[0], rows[0].words, rows[0].words[0]]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { rows[0].words[0].time = 500; }, TypeError);
  assert.equal(C.parseLyrics('a'.repeat(512*1024+1)).length, 0);
  assert.equal(C.parseLyrics('[offset:999999999999999999]\n[00:00]Неверный offset').length, 0);
  assert.equal(C.parseLyrics(Array(4001).fill('[00:01]Строка').join('\n')).length, 4000);
  const dense = '[00:01]' + Array.from({length: 513},(_,i)=>'<00:01.'+String(i).padStart(3,'0')+'>а').join('');
  assert.equal(C.parseLyrics(dense)[0].text.length, 513); assert.equal(C.parseLyrics(dense)[0].words, undefined);
  const many = C.parseLyrics(Array(40).fill(dense.replace('<00:01.512>а','')).join('\n'));
  assert.ok(many.reduce((sum,row)=>sum+(row.words?.length||0),0)<=16000); assert.ok(many.some(row=>!row.words));
});
test('tempo adaptation clones enhanced line/end/word times once while leaving canonical cache data unchanged', () => {
  const lines = C.parseLyrics('[00:20]<00:20>Свои <00:22>слова<00:24>');
  const raw = { found:true, lines, plain:'Свои слова' }, before = JSON.stringify(raw);
  const adapted = Tempo.adaptTimings(raw,{rate:1.25,referenceDuration:100,sourceDuration:80});
  assert.deepEqual([adapted.lines[0].time,adapted.lines[0].end,adapted.lines[0].words[0].time,adapted.lines[0].words[0].end,adapted.lines[0].words[1].time],[16,19.2,16,17.6,17.6]);
  assert.equal(JSON.stringify(raw),before); assert.equal(Tempo.adaptTimings(adapted,{rate:1.25,referenceDuration:100,sourceDuration:80}),null);
});
