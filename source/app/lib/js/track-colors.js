((root, factory) => {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api;
  root.LolzCloudColors = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const fallback = [[57, 83, 74], [55, 65, 78], [98, 138, 112], [126, 153, 132]];
  function palette(pixels) {
    const bins = new Map(); let red = 0, green = 0, blue = 0, count = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      const [r, g, b, alpha] = pixels.slice(at, at + 4); if (alpha < 128) continue;
      red += r; green += g; blue += b; count++;
      const high = Math.max(r, g, b), low = Math.min(r, g, b), light = (high + low) / 510;
      if (light < .08 || light > .92) continue;
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4), bin = bins.get(key) || { r: 0, g: 0, b: 0, n: 0, weight: 0 };
      bin.r += r; bin.g += g; bin.b += b; bin.n++; bin.weight += .2 + (high - low) / 255;
      bins.set(key, bin);
    }
    if (!count) return fallback.map(color => [...color]);
    const candidates = [...bins.values()].map(bin => ({ color: [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n], weight: bin.weight })).sort((a, b) => b.weight - a.weight);
    const selected = [];
    while (candidates.length && selected.length < 3) {
      candidates.sort((a, b) => score(b) - score(a)); selected.push(candidates.shift().color);
    }
    function score(candidate) { return candidate.weight * (selected.length ? Math.min(...selected.map(color => Math.hypot(...color.map((value, i) => value - candidate.color[i])))) / 100 : 1); }
    const base = selected[0] || [red / count, green / count, blue / count];
    while (selected.length < 4) { const factor = [.8, 1.15, .92, 1.22][selected.length]; selected.push(base.map(value => Math.max(20, Math.min(205, value * factor)))); }
    return selected.map(color => {
      const high = Math.max(...color), low = Math.min(...color), average = (high + low) / 2;
      return color.map(value => Math.round(Math.max(18, Math.min(210, average * .18 + value * .72))));
    });
  }
  return { palette, fallback };
});
