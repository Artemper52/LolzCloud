((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LolzCloudBeatTracker = api.BeatTracker;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  class BeatTracker {
    constructor() { this.reset(); }
    reset() { this.levels = []; this.beats = []; this.signal = []; this.last = -Infinity; this.anchor = -Infinity; this.previous = 0; this.bpm = 0; this.confidence = 0; this.updated = -Infinity; this.correlatedAt = -Infinity; }
    push(time, energy) {
      if (!Number.isFinite(time) || !Number.isFinite(energy)) return false;
      const values = this.levels, mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
      const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length || 1));
      const beat = values.length >= 12 && energy > Math.max(.0005, mean + deviation * 1.15) && energy > this.previous * 1.08 && time - this.last > .23;
      values.push(energy); if (values.length > 90) values.shift(); this.previous = energy;
      this.signal.push({ time, energy }); this.signal = this.signal.filter(frame => time - frame.time <= 12);
      if (beat) {
        this.last = this.anchor = time; this.beats.push(time); this.beats = this.beats.filter(value => time - value < 24).slice(-48);
        this.estimate();
      }
      if (time - this.correlatedAt >= 1) { this.correlatedAt = time; this.correlate(); }
      return beat;
    }
    correlate() {
      const frames = this.signal;
      if (frames.length < 180 || frames.at(-1).time - frames[0].time < 6) return;
      const step = (frames.at(-1).time - frames[0].time) / (frames.length - 1);
      if (step > .05 || step < .02) return;
      const mean = frames.reduce((sum, frame) => sum + frame.energy, 0) / frames.length;
      const signal = frames.map(frame => frame.energy - mean), correlation = [];
      for (let lag = 1; lag <= Math.min(100, signal.length / 2); lag++) {
        let product = 0, left = 0, right = 0;
        for (let index = lag; index < signal.length; index++) { product += signal[index] * signal[index - lag]; left += signal[index] ** 2; right += signal[index - lag] ** 2; }
        correlation[lag] = left * right > 1e-12 ? product / Math.sqrt(left * right) : 0;
      }
      let picked = null;
      for (let lag = Math.ceil(60 / 190 / step); lag <= Math.floor(60 / 55 / step); lag++) {
        const score = correlation[lag] + .35 * (correlation[lag * 2] || 0) + .15 * (correlation[lag * 3] || 0);
        const bpm = 60 / (lag * step), preference = this.bpm && Math.abs(Math.log2(bpm / this.bpm)) < .09 ? 1.08 : 1;
        if (!picked || score * preference > picked.score) picked = { lag, score: score * preference };
      }
      if (!picked || picked.score < .68) return;
      const lag = picked.lag, before = correlation[lag - 1] || 0, after = correlation[lag + 1] || 0, center = correlation[lag];
      const offset = Math.max(-.5, Math.min(.5, .5 * (before - after) / (before - 2 * center + after || 1)));
      const bpm = 60 / ((lag + offset) * step), confidence = Math.min(.96, picked.score / 1.5);
      if (confidence < .6 || (this.confidence > confidence + .08 && this.bpm)) return;
      this.bpm = Math.round(bpm * 10) / 10; this.confidence = confidence; this.updated = frames.at(-1).time;
      const recent = frames.filter(frame => frames.at(-1).time - frame.time < 60 / bpm);
      if (recent.length && frames.at(-1).time - this.anchor > 60 / bpm * 1.5) this.anchor = recent.reduce((a, b) => a.energy > b.energy ? a : b).time;
    }
    estimate() {
      const beats = this.beats;
      if (beats.length < 8 || beats.at(-1) - beats[0] < 4) return;
      const votes = new Map();
      for (let index = 1; index < beats.length; index++) {
        for (let prior = Math.max(0, index - 4); prior < index; prior++) {
          const gap = beats[index] - beats[prior];
          for (let count = 1; count <= 4; count++) {
            const bpm = 60 * count / gap; if (bpm < 55 || bpm > 190) continue;
            const bucket = Math.round(bpm), weight = 1 / ((index - prior) * Math.sqrt(count));
            for (let delta = -1; delta <= 1; delta++) votes.set(bucket + delta, (votes.get(bucket + delta) || 0) + weight * (delta ? .5 : 1));
          }
        }
      }
      const picked = [...votes].sort((a, b) => b[1] - a[1])[0]; if (!picked) return;
      const period = 60 / picked[0]; let good = 0; const intervals = [];
      for (let index = 1; index < beats.length; index++) {
        const gap = beats[index] - beats[index - 1], count = Math.round(gap / period);
        if (count >= 1 && count <= 4 && Math.abs(gap / count - period) < period * .12) { good++; intervals.push(gap / count); }
      }
      const confidence = good / (beats.length - 1) * Math.min(1, (beats.length - 4) / 10);
      if (confidence < .6 || intervals.length < 6) { this.confidence *= .8; return; }
      const bpm = 60 / (intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length);
      this.bpm = Math.round(bpm * 10) / 10; this.confidence = confidence; this.updated = beats.at(-1);
    }
    state(time) {
      const age = time - this.anchor, confidence = this.confidence * Math.max(0, 1 - Math.max(0, age - 2) / 5);
      return { bpm: confidence >= .6 ? this.bpm : 0, confidence: Math.round(confidence * 100) / 100, beatAge: Number.isFinite(age) ? Math.max(0, age) : null, onsets: this.beats.length, samples: this.signal.length };
    }
  }
  return { BeatTracker };
});
