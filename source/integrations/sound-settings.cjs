'use strict';
const DEFAULT_SOUND = Object.freeze({ enabled: false, preset: 'Original', gains: [0, 0, 0, 0, 0], rate: 1, preservesPitch: false, reverb: 0, echo: 0 });
const SOUND_PRESETS = Object.freeze({
  Original: { label: 'Original', description: 'Чистое звучание трека', icon: '◉', color: 'mint', gains: [0, 0, 0, 0, 0] },
  'Speed Up': { label: 'Speed Up', description: 'Быстрее и выше', icon: '↗', color: 'lime', rate: 1.2 },
  Slowed: { label: 'Slowed', description: 'Медленнее и глубже', icon: '↘', color: 'blue', rate: .8 },
  'Slowed + Reverb': { label: 'Slowed + Reverb', description: 'Замедление и объём', icon: '≋', color: 'violet', rate: .85, reverb: .32 },
  Nightcore: { label: 'Nightcore', description: 'Больше энергии', icon: 'ϟ', color: 'pink', rate: 1.35, gains: [1, 0, 0, 2, 2] },
  'Bass Boost': { label: 'Bass Boost', description: 'Плотный, упругий бас', icon: '◒', color: 'amber', gains: [7, 4, 0, -1, 0] },
  'Deep Bass': { label: 'Deep Bass', description: 'Глубокие низкие частоты', icon: '◓', color: 'coral', gains: [11, 6, -1, -2, -1] },
  Reverb: { label: 'Reverb', description: 'Пространство вокруг музыки', icon: '◎', color: 'violet', reverb: .4 },
  Echo: { label: 'Echo', description: 'Мягкое повторяющееся эхо', icon: ')))', color: 'blue', echo: .32 },
  'Lo-Fi': { label: 'Lo-Fi', description: 'Тёплый приглушённый звук', icon: '▤', color: 'amber', gains: [2, 1, -1, -5, -9], reverb: .12 },
  'Чистый вокал': { label: 'Чистый вокал', description: 'Голос на первом плане', icon: '♩', color: 'mint', gains: [-2, -1, 4, 3, -1] },
  'Ночной': { label: 'Ночной', description: 'Мягко и спокойно', icon: '☾', color: 'blue', gains: [-4, -2, 2, 0, -3] },
});
const validGains = value => Array.isArray(value) && value.length === 5 && value.every(item => Number.isFinite(item) && item >= -12 && item <= 12);
function validateSoundPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Некорректные настройки звука.');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['enabled', 'preservesPitch'].includes(key)) { if (typeof value !== 'boolean') throw new Error('Нужен переключатель звукового эффекта.'); }
    else if (key === 'gains') { if (!validGains(value)) throw new Error('Уровни эквалайзера должны быть от −12 до +12 дБ.'); }
    else if (key === 'rate') { if (!Number.isFinite(value) || value < .65 || value > 1.5) throw new Error('Выбери скорость от 0,65× до 1,5×.'); }
    else if (['reverb', 'echo'].includes(key)) { if (!Number.isFinite(value) || value < 0 || value > .8) throw new Error('Сила эффекта должна быть от 0 до 80%.'); }
    else throw new Error('Неизвестная настройка звука.');
    result[key] = key === 'gains' ? [...value] : value;
  }
  return result;
}
function normalizeSound(saved = {}) {
  const result = { ...DEFAULT_SOUND, gains: [...DEFAULT_SOUND.gains] };
  for (const key of ['enabled', 'gains', 'rate', 'preservesPitch', 'reverb', 'echo']) {
    if (saved[key] !== undefined) { try { Object.assign(result, validateSoundPatch({ [key]: saved[key] })); } catch { /* Ignore malformed saved values. */ } }
  }
  if (typeof saved.preset === 'string') result.preset = saved.preset.slice(0, 32);
  return result;
}
function presetSound(name, custom = {}) {
  const preset = SOUND_PRESETS[name] || custom[name];
  if (!preset) throw new Error('Такого пресета пока нет.');
  return { ...normalizeSound(preset), preset: name, enabled: name !== 'Original' };
}
module.exports = { DEFAULT_SOUND, SOUND_PRESETS, validGains, validateSoundPatch, normalizeSound, presetSound };
