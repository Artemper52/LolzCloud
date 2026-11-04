'use strict';
const { clean } = require('./lolzteam/status.cjs');
const { DEFAULTS } = require('./wave-preferences.cjs');
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
const GENRES = [
  ['country', 'Кантри / вестерн', 'cowboy western country', /ковбо\p{L}*|вестерн\p{L}*|кантри|cowboy|western|country/iu],
  ['jazz', 'Джаз', 'jazz', /джаз\p{L}*|jazz/iu],
  ['blues', 'Блюз', 'blues', /блюз\p{L}*|blues/iu],
  ['rock', 'Рок', 'rock', /(?<!\p{L})рок\p{L}*|rock/iu],
  ['metal', 'Метал', 'metal', /метал\p{L}*|metal/iu],
  ['punk', 'Панк', 'punk', /панк\p{L}*|punk/iu],
  ['pop', 'Поп', 'pop', /(?<!\p{L})поп(?:са|сов\p{L}*|[- ]музык\p{L}*)?(?!\p{L})|(?<!\p{L})pop(?!\p{L})/iu],
  ['hiphop', 'Хип-хоп / рэп', 'hip hop rap', /хип[- ]?хоп|рэп\p{L}*|hip[- ]?hop|(?<!\p{L})rap(?!\p{L})/iu],
  ['phonk', 'Фонк', 'phonk', /фонк\p{L}*|phonk/iu],
  ['lofi', 'Лоу-фай', 'lofi', /лоу[- ]?фай|ло[- ]?фай|lo[- ]?fi/iu],
  ['ambient', 'Эмбиент', 'ambient', /эмбиент\p{L}*|эмбие?нт\p{L}*|ambient/iu],
  ['classical', 'Классика', 'classical', /классическ\p{L}*|классик\p{L}*|classical/iu],
  ['folk', 'Фолк', 'folk', /фолк\p{L}*|народн\p{L}*|folk/iu],
  ['disco', 'Диско', 'disco', /диско|disco/iu],
  ['funk', 'Фанк', 'funk', /фанк\p{L}*|(?<!\p{L})funk(?!\p{L})/iu],
  ['reggae', 'Регги', 'reggae', /регги|reggae/iu],
  ['techno', 'Техно', 'techno', /техно|techno/iu],
  ['house', 'Хаус', 'house', /хаус\p{L}*|house/iu],
  ['dnb', 'Драм-н-бейс', 'drum and bass', /драм[- ]?(?:энд|н)?[- ]?б[еэ]йс|drum\s*(?:and|&|n)?\s*bass|(?<!\p{L})dnb(?!\p{L})/iu],
  ['electronic', 'Электроника', 'electronic', /электронн\p{L}*|electronic|(?<!\p{L})edm(?!\p{L})/iu],
  ['synthwave', 'Синтвейв', 'synthwave', /синтвейв\p{L}*|synthwave/iu],
  ['soundtrack', 'Саундтреки', 'soundtrack', /саундтрек\p{L}*|музык\p{L}*\s+из\s+фильм\p{L}*|soundtrack/iu],
];
const MOODS = [
  ['happy', 'Поднять настроение', 'happy feel good', /подня\p{L}*\s+(?:мне\s+)?настроен\p{L}*|подним\p{L}*\s+настроен\p{L}*|хорош\p{L}*\s+настроен\p{L}*|весел\p{L}*|радост\p{L}*|позитив\p{L}*|happy|feel[- ]?good|uplift\p{L}*|cheer\p{L}*/iu],
  ['energetic', 'Больше энергии', 'energetic upbeat', /бодр\p{L}*|энерг\p{L}*|заряд\p{L}*|зажиг\p{L}*|разбуд\p{L}*|energetic|upbeat/iu],
  ['calm', 'Спокойнее', 'calm chill', /спокой\p{L}*|расслаб\p{L}*|умиротвор\p{L}*|calm|chill|relax\p{L}*/iu],
  ['sad', 'Меланхолия', 'sad melancholic', /груст\p{L}*|печаль\p{L}*|меланхол\p{L}*|sad|melanchol\p{L}*/iu],
];
const ACTIVITIES = [
  ['focus', 'Для концентрации', 'study focus', /сосредоточ\p{L}*|концентрац\p{L}*|(?<!\p{L})фокус\p{L}*|для\s+(?:работ\p{L}*|учеб\p{L}*)|study|focus|coding/iu],
  ['workout', 'Для тренировки', 'workout', /тренир\p{L}*|пробеж\p{L}*|для\s+бега|в\s+зал|workout|running|(?<!\p{L})gym(?!\p{L})/iu],
  ['sleep', 'Перед сном', 'sleep ambient', /заснут\p{L}*|засып\p{L}*|для\s+сна|перед\s+сном|sleep|bedtime/iu],
  ['relax', 'Отдохнуть', 'relax chill', /отдох\p{L}*|выдох\p{L}*|отдых\p{L}*|relax\p{L}*/iu],
];
function negated(text, index) {
  const before = text.slice(Math.max(0, index - 38), index).split(/[,.;!?]|\bbut\b|(?:^|\s)но\s/iu).pop();
  return /(?:^|\s)(?:без|кроме|никако\p{L}*|не(?:\s+(?:хочу|надо|нужн\p{L}*|любо\p{L}*))?|no|without|except)(?:\s+\p{L}+){0,2}\s*$/iu.test(before);
}
function matches(text, rules) {
  const positive = [], negative = [];
  for (const rule of rules) for (const match of text.matchAll(new RegExp(rule[3].source, 'giu'))) {
    (negated(text, match.index) ? negative : positive).push({ rule, index: match.index });
  }
  return { positive: positive.sort((a, b) => a.index - b.index), negative };
}
function parseEra(text, year = new Date().getFullYear()) {
  let found = text.match(/(?<!\d)((?:18|19|20)\d{2})\s*[-–—]\s*((?:18|19|20)\d{2})(?!\d)/u);
  if (found) {
    const from = Number(found[1]), to = Number(found[2]);
    if (from > to || to > year + 1 || to - from > 200) throw new Error('Уточни период: начальный год должен быть раньше конечного.');
    return { from, to, label: from + '–' + to, literal: found[0] };
  }
  found = text.match(/(?<!\d)((?:18|19|20)\d0)[- ]?(?:х|е|s)(?!\p{L})/iu);
  if (found) {
    const from = Number(found[1]); if (from > year) throw new Error('Этот период ещё не наступил. Уточни годы.');
    return { from, to: Math.min(from + 9, year), label: found[1] + '-е', literal: found[0] };
  }
  found = text.match(/(?<!\d)(\d0)[- ]?(?:х|е|s)(?!\p{L})/iu);
  if (found) {
    const decade = Number(found[1]), century = /прошло\p{L}*\s+век/iu.test(text) || decade > year % 100 ? 1900 : 2000, from = century + decade;
    return { from, to: Math.min(from + 9, year), label: from + '-е', literal: found[0] };
  }
  if (/(?:начал\p{L}*|перв\p{L}*\s+четверт\p{L}*)\s+(?:xx|20)[- ]?(?:го\s+)?век/iu.test(text)) return { from: 1900, to: 1924, label: 'Начало XX века', literal: '' };
  if (/(?<!\p{L})(?:xx|20)[- ]?(?:го\s+)?век/iu.test(text)) return { from: 1900, to: 1999, label: 'XX век', literal: '' };
  found = text.match(/(?<!\d)((?:18|19|20)\d{2})(?!\d)/u);
  if (found) {
    const from = Number(found[1]); if (from > year + 1) throw new Error('Этот год ещё не наступил. Уточни период.');
    return { from, to: from, label: String(from), literal: found[0] };
  }
  return null;
}
function parseRequest(value) {
  if (typeof value !== 'string' || value.length > 240) throw new Error('Опиши музыку текстом до 240 символов.');
  const raw = clean(value, 240).trim(); if (raw.length < 3 || !/\p{L}/u.test(raw)) throw new Error('Напиши жанр, настроение, исполнителя или эпоху.');
  // Quoted track/artist names must remain literal, including years in a title.
  const quoted = [...raw.matchAll(/["«“]([^"»”]+)["»”]/gu)].map(match => match[1]);
  const text = norm(raw.replace(/["«“][^"»”]+["»”]/gu, ' '));
  const genreHits = matches(text, GENRES), moodHits = matches(text, MOODS), activityHits = matches(text, ACTIVITIES);
  const genres = [...new Set(genreHits.positive.map(hit => hit.rule[0]))], excluded = [...new Set(genreHits.negative.map(hit => hit.rule[0]))];
  if (genres.some(id => excluded.includes(id))) throw new Error('В запросе один жанр одновременно выбран и исключён. Уточни, что хочется послушать.');
  const mood = moodHits.positive.at(-1)?.rule, activity = activityHits.positive.at(-1)?.rule, era = parseEra(text);
  let language = /без\s+(?:слов|вокала)|инструментал\p{L}*|instrumental/iu.test(text) ? 'instrumental'
    : /русск\p{L}*|на\s+русском|russian/iu.test(text) ? 'ru' : /англ\p{L}*|на\s+английском|english/iu.test(text) ? 'en' : 'any';
  const settings = { ...DEFAULTS, autoContext: false, mood: mood?.[0] || (activity?.[0] === 'workout' ? 'energetic' : ['sleep', 'relax'].includes(activity?.[0]) ? 'calm' : 'any'), activity: activity?.[0] || 'any', language };
  if (/из\s+(?:моих\s+)?лайков|любим\p{L}*\s+треки|favorites/iu.test(text)) settings.character = 'familiar';
  if (/незнаком\p{L}*|не\s+слушал|новые\s+исполнител|discover/iu.test(text)) settings.character = 'discover';
  const labels = [...genres.map(id => GENRES.find(row => row[0] === id)[1]), ...excluded.map(id => 'Без ' + GENRES.find(row => row[0] === id)[1]), mood?.[1], activity?.[1], era?.label, language === 'instrumental' ? 'Без слов' : language === 'ru' ? 'На русском' : language === 'en' ? 'На английском' : ''].filter(Boolean);
  // Remove only understood spans; keep unknown names and topics for real search.
  let residual = text;
  for (const hit of [...genreHits.positive, ...genreHits.negative, ...moodHits.positive, ...moodHits.negative, ...activityHits.positive, ...activityHits.negative].sort((a, b) => b.index - a.index)) {
    const match = residual.slice(hit.index).match(new RegExp('^(?:' + hit.rule[3].source + ')', 'iu'));
    if (match) residual = residual.slice(0, hit.index) + ' '.repeat(match[0].length) + residual.slice(hit.index + match[0].length);
  }
  residual = residual.replace(/(?:18|19|20)\d{2}(?:[- ]?(?:х|е|s))?|\d0[- ]?(?:х|е|s)/giu, ' ').replace(/(?<!\p{L})(?:включи|поставь|найди|подбери|давай|хочу|мне|пожалуйста|какие|нибудь|песн\p{L}*|музык\p{L}*|трек\p{L}*|такие|чтобы|которые|просто|немного|для|без|кроме|не|и|или|а|в|на|год\p{L}*|начал\p{L}*|xx|века|русск\p{L}*|англ\p{L}*|слов|вокала|инструментал\p{L}*)(?!\p{L})/giu, ' ').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const topic = [quoted.join(' '), residual].filter(Boolean).join(' ').slice(0, 110);
  const genre = genres.map(id => GENRES.find(row => row[0] === id)[2]).join(' '), tone = [mood?.[2], activity?.[2], language === 'instrumental' ? 'instrumental' : language === 'ru' ? 'russian' : language === 'en' ? 'english' : ''].filter(Boolean).join(' ');
  const period = era ? era.from === era.to ? String(era.from) : String(Math.floor(era.from / 10) * 10) + 's' : '';
  const base = [genre, topic, tone].filter(Boolean).join(' ').trim();
  if (!base && !era) throw new Error('Добавь настроение, жанр или исполнителя — например «поднять настроение» или «джаз для работы».');
  const queries = [...new Set([[genre, topic, period, tone].filter(Boolean).join(' '), era ? [genre, topic, String(era.from)].filter(Boolean).join(' ') : '', base || period].filter(Boolean))].slice(0, 3).map(query => query.slice(0, 140));
  return { raw, settings, genres, excluded, excludedMoods: [...new Set(moodHits.negative.map(hit => hit.rule[0]))], era, labels: labels.length ? labels : [topic || raw], queries,
    note: era ? 'Период проверяем по году выпуска и описанию трека. Дата загрузки не считается годом записи.' : 'Подбираем по названиям, жанрам и описанию треков.' };
}
function requestMatch(track, request) {
  if (!request) return { eligible: true, score: 0, reason: '' };
  const text = norm([track.title, track.artist, track.genre, track.tags, track.description].join(' '));
  if (request.excluded.some(id => GENRES.find(row => row[0] === id)[3].test(text))) return { eligible: false };
  const genre = request.genres.find(id => GENRES.find(row => row[0] === id)[3].test(text));
  if (request.genres.length && !genre) return { eligible: false };
  if (request.excludedMoods.some(id => MOODS.find(row => row[0] === id)[3].test(text))) return { eligible: false };
  if (request.settings.mood === 'happy' && /sad|depress|груст|печаль/iu.test(text) && !/happy|joy|весел|радост/iu.test(text)) return { eligible: false };
  let evidence = '';
  if (request.era) {
    const { from, to } = request.era, year = Number(track.releaseYear);
    if (year && (year < from || year > to)) return { eligible: false };
    if (year) evidence = 'Год выпуска: ' + year;
    else {
      const years = [...text.matchAll(/(?<!\d)((?:18|19|20)\d{2})(?!\d)/gu)].map(hit => Number(hit[1]));
      const matching = years.find(value => value >= from && value <= to);
      if (!matching || years.some(value => value >= 1950 && value > to) || /remix|ремикс|sped\s*up|speed\s*up|slowed/iu.test(text)) return { eligible: false };
      evidence = matching + ' · по описанию';
    }
  }
  return { eligible: true, score: (genre ? 9 : 0) + (evidence ? 8 : 0), reason: evidence || (genre ? GENRES.find(row => row[0] === genre)[1] + ' · по твоему запросу' : '') };
}
module.exports = { parseRequest, requestMatch, parseEra };
