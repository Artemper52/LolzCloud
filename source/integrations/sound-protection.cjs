'use strict';
const DEFAULT_PROTECTION = Object.freeze({ limiter: true, ceilingDb: -3, ducking: true, duckDb: -14, thresholdDb: -42, scope: 'voice-apps' });
function validateProtection(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Некорректные настройки громкости.');
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'limiter' || key === 'ducking') {
      if (typeof value !== 'boolean') throw new Error('Нужен переключатель громкости.');
    } else if (key === 'scope') {
      if (!['voice-apps', 'all'].includes(value)) throw new Error('Выбери приложения для приглушения.');
    } else {
      const bounds = { ceilingDb: [-24, 0], duckDb: [-30, -3], thresholdDb: [-60, -15] }[key];
      if (!bounds || !Number.isFinite(value) || value < bounds[0] || value > bounds[1]) throw new Error('Порог громкости вне допустимого диапазона.');
    }
    next[key] = value;
  }
  return next;
}
function normalizeProtection(value) {
  const next = { ...DEFAULT_PROTECTION };
  for (const [key, setting] of Object.entries(value || {})) {
    try { Object.assign(next, validateProtection({ [key]: setting })); } catch { /* Keep this setting's default. */ }
  }
  return next;
}
module.exports = { DEFAULT_PROTECTION, normalizeProtection, validateProtection };
