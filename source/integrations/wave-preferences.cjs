'use strict';
const { clean } = require('./lolzteam/status.cjs');
const OPTIONS = Object.freeze({
  mood: [['any', 'Любое'], ['calm', 'Спокойное'], ['energetic', 'Бодрое'], ['happy', 'Радостное'], ['sad', 'Меланхоличное']],
  activity: [['any', 'Для любого момента'], ['focus', 'Сосредоточиться'], ['relax', 'Отдохнуть'], ['workout', 'Тренироваться'], ['sleep', 'Засыпать']],
  character: [['mixed', 'Мой микс'], ['familiar', 'Любимое'], ['discover', 'Незнакомое']],
  language: [['any', 'Любой'], ['ru', 'Больше русскоязычного'], ['en', 'Больше англоязычного'], ['instrumental', 'Без слов · по тегам']],
});
const DEFAULTS = Object.freeze({ mood: 'any', activity: 'any', character: 'mixed', language: 'any', genre: '', autoContext: true });
function validatePreferences(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Некорректные настройки волны.');
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (OPTIONS[key]) { if (!OPTIONS[key].some(row => row[0] === value)) throw new Error('Неизвестный режим волны.'); }
    else if (key === 'genre') { if (typeof value !== 'string' || value.length > 80) throw new Error('Укажи жанр до 80 символов.'); }
    else if (key === 'autoContext') { if (typeof value !== 'boolean') throw new Error('Некорректный переключатель контекста.'); }
    else if (key === 'adventurous') { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Выбери баланс знакомого и нового.'); }
    else throw new Error('Неизвестная настройка волны.');
    next[key] = key === 'genre' ? clean(value, 80) : value;
  }
  return next;
}
function normalizePreferences(value) {
  const result = { ...DEFAULTS };
  for (const [key, item] of Object.entries(value || {})) { try { Object.assign(result, validatePreferences({ [key]: item })); } catch { /* Keep valid defaults. */ } }
  return result;
}
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().trim();
const terms = track => normalize([track.title, track.genre, track.tags].join(' '));
const calm = /ambient|chill|lo[ -]?fi|jazz|piano|acoustic|downtempo|slowed|relax|спокой|эмбиент|джаз|пианино|акустик/;
const energetic = /phonk|techno|drum|dance|dnb|hard|metal|hyper|speed|workout|энерг|фонк|техно|танц|метал/;
const instrumental = /instrumental|без\s+слов|инструментал|ambient|soundtrack|пианино|piano|study\s+beats|lofi\s+beats/;
function period(time) { const hour = new Date(time).getHours(); return hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'day' : 'evening'; }
function contextLabel(time) { return { night: 'Ночной микс', morning: 'Утренний микс', day: 'Дневной микс', evening: 'Вечерний микс' }[period(time)]; }
function contextProfile(history, time) {
  const artists = new Map(), genres = new Map(), weekend = [0, 6].includes(new Date(time).getDay());
  let signals = 0;
  for (const row of history) {
    if (!Number.isFinite(row.playedAt) || row.playedAt > time || time - row.playedAt > 90 * 86400000 || !(row.seconds >= 20) || row.quickSkip || period(row.playedAt) !== period(time)) continue;
    const weight = ([0, 6].includes(new Date(row.playedAt).getDay()) === weekend ? 1 : .55) * Math.exp(-(time - row.playedAt) / (45 * 86400000));
    const artist = normalize(row.artist), genre = normalize(row.genre);
    if (artist) artists.set(artist, (artists.get(artist) || 0) + weight);
    if (genre) genres.set(genre, (genres.get(genre) || 0) + weight);
    signals++;
  }
  return { artists, genres, signals };
}
function preferenceScore(track, settings = DEFAULTS, context = null) {
  const text = terms(track), bpm = Number(track.bpm) || 0;
  let score = 0, reason = '';
  const add = (weight, label) => { score += weight; if (weight > 0 && !reason) reason = label; };
  if (settings.genre) add(text.includes(normalize(settings.genre)) ? 8 : -2, 'Ближе к жанру «' + settings.genre + '»');
  if (settings.mood === 'calm') add(calm.test(text) || bpm > 0 && bpm <= 95 ? 5 : energetic.test(text) || bpm > 140 ? -3 : 0, 'Спокойное звучание');
  if (settings.mood === 'energetic') add(energetic.test(text) || bpm >= 120 ? 5 : calm.test(text) ? -3 : 0, 'Бодрое звучание');
  if (settings.mood === 'happy') add(/happy|summer|disco|funk|joy|весел|лето|радост/.test(text) ? 5 : /sad|depress|груст|печаль/.test(text) ? -3 : 0, 'Для хорошего настроения');
  if (settings.mood === 'sad') add(/sad|emo|melanchol|heartbreak|груст|печаль|меланхол/.test(text) ? 5 : 0, 'Меланхоличное настроение');
  if (settings.activity === 'focus') add(instrumental.test(text) || /study|focus|работ|учеб/.test(text) ? 6 : energetic.test(text) ? -3 : 0, 'Для концентрации');
  if (settings.activity === 'relax' || settings.activity === 'sleep') add(calm.test(text) ? 6 : energetic.test(text) ? -5 : 0, settings.activity === 'sleep' ? 'Спокойнее перед сном' : 'Чтобы выдохнуть');
  if (settings.activity === 'workout') add(energetic.test(text) || bpm >= 120 ? 6 : calm.test(text) ? -4 : 0, 'Для тренировки');
  if (settings.language === 'instrumental') add(instrumental.test(text) ? 9 : -5, 'Без слов по описанию трека');
  if (settings.language === 'ru') add(/русск|russian|\bru\b/.test(text) || /[а-яё]/i.test(track.title) ? 5 : 0, 'Русское название или теги');
  if (settings.language === 'en') add(/english|\ben\b/.test(text) || /[a-z]/i.test(track.title) && !/[а-яё]/i.test(track.title) ? 4 : 0, 'Английское название или теги');
  if (settings.autoContext && context?.signals >= 3) {
    const weight = (context.artists.get(normalize(track.artist)) || 0) + (context.genres.get(normalize(track.genre)) || 0);
    add(Math.min(3, Math.log1p(weight)), 'Чаще выбираешь такое в это время');
  }
  return { score, reason };
}
function searchHint(settings) {
  return [settings.genre, settings.activity === 'focus' ? 'study instrumental' : settings.activity === 'sleep' ? 'ambient' : settings.activity === 'workout' ? 'workout' : settings.activity === 'relax' ? 'chill' : '', settings.mood === 'calm' ? 'chill' : settings.mood === 'energetic' ? 'energetic' : settings.mood === 'happy' ? 'happy' : settings.mood === 'sad' ? 'sad' : '', settings.language === 'instrumental' ? 'instrumental' : ''].filter(Boolean).join(' ');
}
module.exports = { OPTIONS, DEFAULTS, validatePreferences, normalizePreferences, contextProfile, contextLabel, preferenceScore, searchHint, normalize };
