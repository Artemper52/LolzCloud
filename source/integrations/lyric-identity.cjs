'use strict';
const normalName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[\p{M}\p{Cf}]/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
function cleanName(value) {
  return String(value || '').normalize('NFKC').replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/(?:@(?:tg|тг|telegram)\s*[:=]\s*|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/)[^\s)\]]+/giu, '')
    .replace(/[([]\s*(?:prod(?:uced)?\.?\s*(?:by|[.:])?|прод\.?|official\s*(?:audio|video|music\s*video)|lyrics?|visuali[sz]er|music\s*video|\d{3,4}p|hq|hd)\b[^)\]]*[)\]]/giu, '')
    .replace(/\s+/g, ' ').trim();
}
function artistNames(value) { return cleanName(value).split(/\s*(?:,|&|\+|\bfeat\.?|\bft\.?|\s[xх×]\s|\band\b)\s*/iu).map(row => row.trim().replace(/^@(?=[\p{L}\p{N}])/u, '')).filter(Boolean); }
function lyricIdentity(track) {
  let title = cleanName(track?.title), artists = artistNames(track?.artist);
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (dash && artists.some(artist => artistNames(dash[1]).some(name => normalName(name) === normalName(artist)))) { artists = artistNames(dash[1]); title = dash[2].trim(); }
  const featuring = title.match(/^(.+?)\s+(?:\+|feat\.?|ft\.?)\s+(.+)$/iu);
  if (featuring && !/\b(?:remix|slowed|reverb|speed|mashup)\b/iu.test(featuring[2])) {
    title = featuring[1].trim(); artists.push(...artistNames(featuring[2].replace(/\s*[([][^)\]]*[)\]]\s*$/u, '')));
  }
  const seen = new Set(); artists = artists.filter(artist => { const key = normalName(artist); if (!key || seen.has(key)) return false; seen.add(key); return true; });
  return { ...track, title, artist: artists.join(', ') };
}
function sameArtists(left, right) {
  const a = new Set(artistNames(left).map(normalName)), b = new Set(artistNames(right).map(normalName));
  if (!a.size || !b.size) return false;
  // A catalogue may omit a featured performer, but two explicitly different
  // collaborations must not be treated as the same recording.
  return a.size <= b.size ? [...a].every(name => b.has(name)) : [...b].every(name => a.has(name));
}
function lyricCandidates(track) {
  const base = lyricIdentity(track), candidates = [base], dash = base.title.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (dash && !/\b(?:remix|slowed|sped|speed|reverb|live|version|cover|instrumental|nightcore|edit|prod)\b/iu.test(dash[1] + ' ' + dash[2])) {
    for (const [artist, title] of [[dash[1], dash[2]], [dash[2], dash[1]]]) if (artist.length <= 100 && title.length > 1) candidates.push(lyricIdentity({ ...track, artist, title }));
  }
  const seen = new Set(); return candidates.filter(value => { const key = normalName(value.title) + '\n' + normalName(value.artist); if (seen.has(key)) return false; seen.add(key); return true; });
}
module.exports = { lyricIdentity, lyricCandidates, cleanName, normalName, artistNames, sameArtists };
