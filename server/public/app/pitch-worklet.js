/* Fixed-length STFT transposition with a linked stereo phase reference.
   Derived from the phase-vocoder analysis/synthesis equations (Laroche/Dolson):
   https://labrosa.ee.columbia.edu/~dpwe/papers/LaroD99-pvoc.pdf
   No formant-preserving or studio-quality claim. One input/output frame per sample. */
(root => {
  function install() {
    'use strict';
    class LolzCloudPitch extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [{ name: 'pitch', defaultValue: 1, minValue: .5, maxValue: 2, automationRate: 'k-rate' }, { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
      }
      constructor() {
        super(); this.size = 2 ** Math.ceil(Math.log2(Math.max(8000, Math.min(384000, sampleRate)) * .04)); this.hop = this.size / 8; this.bins = this.size / 2 + 1; this.capacity = this.size * 2;
        const channels = 8, bits = Math.log2(this.size); this.input = new Array(channels); this.output = new Array(channels); this.real = new Array(channels); this.imaginary = new Array(channels); this.magnitude = new Array(channels); this.phase = new Array(channels); this.previousPhase = new Array(channels); this.synthesisMagnitude = new Array(channels);
        for (let c = 0; c < channels; c++) { this.input[c] = new Float32Array(this.size); this.output[c] = new Float64Array(this.capacity); this.real[c] = new Float64Array(this.size); this.imaginary[c] = new Float64Array(this.size); this.magnitude[c] = new Float64Array(this.bins); this.phase[c] = new Float64Array(this.bins); this.previousPhase[c] = new Float64Array(this.bins); this.synthesisMagnitude[c] = new Float64Array(this.bins); }
        this.window = new Float64Array(this.size); this.cosine = new Float64Array(this.size / 2); this.sine = new Float64Array(this.size / 2); this.reverse = new Uint16Array(this.size);
        this.peaks = new Uint16Array(this.bins); this.peakCurrent = new Uint8Array(this.bins); this.frequency = new Float64Array(this.bins); this.strength = new Float64Array(this.bins); this.owner = new Uint16Array(this.bins); this.reference = new Uint8Array(this.bins); this.synthesisPhase = new Float64Array(this.bins); this.phaseValid = new Uint8Array(this.bins); this.ratioSum = new Float64Array(this.capacity); this.weightSum = new Float64Array(this.capacity);
        for (let i = 0; i < this.size; i++) { this.window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / this.size); let value = i, reversed = 0; for (let b = 0; b < bits; b++) { reversed = (reversed << 1) | (value & 1); value >>>= 1; } this.reverse[i] = reversed; }
        for (let i = 0; i < this.size / 2; i++) { this.cosine[i] = Math.cos(2 * Math.PI * i / this.size); this.sine[i] = Math.sin(2 * Math.PI * i / this.size); }
        this.cursor = this.outCursor = this.untilFrame = this.frames = this.epoch = this.processedFrames = 0; this.ratio = this.lastPitch = this.target = 1; this.mix = 0; this.smoothing = 1 - Math.exp(-1 / (sampleRate * .012)); this.fade = 1 / Math.max(1, sampleRate * .012);
        this.port.onmessage = event => { const value = event.data; if (!value || !Number.isSafeInteger(value.epoch) || value.epoch < 0) return;
          if (value.type === 'reset' && value.epoch > this.epoch) { this.epoch = value.epoch; this.reset(); }
          else if (value.type === 'status' && value.epoch === this.epoch) this.port.postMessage({ type: 'status', epoch: this.epoch, processedFrames: this.processedFrames, pitch: this.lastPitch, latencyFrames: this.size, wetMix: this.mix, settled: this.mix >= .999 && this.processedFrames > 0 && Math.abs(this.lastPitch - this.target) <= .001 });
        };
      }
      reset() {
        this.cursor = this.outCursor = this.untilFrame = this.frames = this.processedFrames = 0; this.mix = 0; this.lastPitch = 1;
        for (let c = 0; c < 8; c++) { this.input[c].fill(0); this.output[c].fill(0); this.previousPhase[c].fill(0); }
        this.phaseValid.fill(0); this.synthesisPhase.fill(0); this.ratioSum.fill(0); this.weightSum.fill(0);
      }
      fft(real, imaginary, inverse) {
        const n = this.size;
        for (let i = 0; i < n; i++) { const j = this.reverse[i]; if (j > i) { let temp = real[i]; real[i] = real[j]; real[j] = temp; temp = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = temp; } }
        for (let width = 2; width <= n; width *= 2) { const half = width / 2, step = n / width;
          for (let base = 0; base < n; base += width) for (let i = 0; i < half; i++) { const angle = i * step, wr = this.cosine[angle], wi = inverse ? this.sine[angle] : -this.sine[angle], a = base + i, b = a + half, re = real[b] * wr - imaginary[b] * wi, im = real[b] * wi + imaginary[b] * wr; real[b] = real[a] - re; imaginary[b] = imaginary[a] - im; real[a] += re; imaginary[a] += im; }
        }
        if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imaginary[i] /= n; }
      }
      frame(channels, start, destination, ratio) {
        const n = this.size, bins = this.bins, angular = 2 * Math.PI * this.hop / n;
        this.strength.fill(0); this.peakCurrent.fill(0);
        for (let c = 0; c < channels; c++) { const re = this.real[c], im = this.imaginary[c], input = this.input[c];
          for (let i = 0; i < n; i++) { re[i] = input[(start + i) & (n - 1)] * this.window[i]; im[i] = 0; }
          this.fft(re, im, false);
          for (let k = 0; k < bins; k++) { const strength = Math.hypot(re[k], im[k]); this.magnitude[c][k] = strength; this.phase[c][k] = Math.atan2(im[k], re[k]); if (strength > this.strength[k]) { this.strength[k] = strength; this.reference[k] = c; } }
        }
        let count = 0;
        for (let k = 0; k < bins; k++) if (this.strength[k] > 1e-10 && (k === 0 || this.strength[k] >= this.strength[k - 1]) && (k === bins - 1 || this.strength[k] > this.strength[k + 1])) { this.peaks[count++] = k; this.peakCurrent[k] = 1; }
        for (let p = 0; p < count; p++) { const k = this.peaks[p], reference = this.reference[k]; let delta = this.phase[reference][k] - this.previousPhase[reference][k] - angular * k; delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
          this.frequency[k] = this.frames ? k + delta / angular : k;
          if (!this.phaseValid[k]) this.synthesisPhase[k] = this.phase[reference][k]; else { this.synthesisPhase[k] += angular * this.frequency[k] * ratio; this.synthesisPhase[k] -= 2 * Math.PI * Math.round(this.synthesisPhase[k] / (2 * Math.PI)); }
        }
        this.phaseValid.set(this.peakCurrent);
        for (let c = 0; c < channels; c++) { this.previousPhase[c].set(this.phase[c]); this.real[c].fill(0); this.imaginary[c].fill(0); }
        // Move complete peak regions together. Scaling individual bins destroys
        // their vertical phase relation and can cancel otherwise correct tones.
        let region = 0;
        if (count) for (let k = 0; k < bins; k++) { while (region + 1 < count && k > (this.peaks[region] + this.peaks[region + 1]) / 2) region++;
          const peak = this.peaks[region], reference = this.reference[peak], target = k + Math.round((ratio - 1) * this.frequency[peak]); if (target < 0 || target >= bins) continue;
          for (let c = 0; c < channels; c++) { const phase = this.synthesisPhase[peak] + this.phase[c][k] - this.phase[reference][peak], magnitude = this.magnitude[c][k]; this.real[c][target] += magnitude * Math.cos(phase); this.imaginary[c][target] += magnitude * Math.sin(phase); }
        }
        for (let c = 0; c < channels; c++) { const re = this.real[c], im = this.imaginary[c]; im[0] = im[bins - 1] = 0; for (let k = 1; k < bins - 1; k++) { re[n - k] = re[k]; im[n - k] = -im[k]; }
          this.fft(re, im, true); const out = this.output[c]; for (let i = 0; i < n; i++) out[(destination + i) & (this.capacity - 1)] += re[i] * this.window[i] / 3;
        }
        for (let i = 0; i < n; i++) { const index = (destination + i) & (this.capacity - 1), weight = this.window[i] * this.window[i] / 3; this.weightSum[index] += weight; this.ratioSum[index] += ratio * weight; }
        this.frames++;
      }
      process(inputs, outputs, parameters) {
        const input = inputs[0], output = outputs[0]; if (!output || !output.length) return true;
        const length = output[0].length, channels = Math.min(8, output.length), raw = parameters.pitch?.[0], target = Number.isFinite(raw) ? Math.max(.5, Math.min(2, raw)) : 1, active = parameters.enabled?.[0] >= .5 && Math.abs(target - 1) > .000001; this.target = target;
        for (let i = 0; i < length; i++) {
          this.ratio += this.smoothing * (target - this.ratio); const destination = active && this.frames >= 9 ? 1 : 0; this.mix += Math.max(-this.fade, Math.min(this.fade, destination - this.mix));
          for (let c = 0; c < output.length; c++) { const rawSample = input?.[c]?.[i] ?? input?.[0]?.[i] ?? 0, dry = Number.isFinite(rawSample) ? rawSample : 0; if (c >= 8) { output[c][i] = dry; continue; }
            this.input[c][this.cursor] = dry; const wet = this.output[c][this.outCursor]; this.output[c][this.outCursor] = 0; const value = dry + this.mix * (wet - dry); output[c][i] = Number.isFinite(value) ? value : 0;
          }
          const weight = this.weightSum[this.outCursor]; if (input?.length && this.mix > 0 && weight > 1e-10) { this.processedFrames++; this.lastPitch = this.ratioSum[this.outCursor] / weight; } else if (input?.length && !this.mix) this.lastPitch = 1;
          this.weightSum[this.outCursor] = this.ratioSum[this.outCursor] = 0;
          if (++this.untilFrame >= this.hop) { this.untilFrame = 0; if (active || this.mix > 0) this.frame(channels, (this.cursor + 1) & (this.size - 1), (this.outCursor + 1) & (this.capacity - 1), this.ratio); else if (this.frames) { this.frames = 0; this.phaseValid.fill(0); } }
          this.cursor = (this.cursor + 1) & (this.size - 1); this.outCursor = (this.outCursor + 1) & (this.capacity - 1);
        }
        return true;
      }
    }
    registerProcessor('lolzcloud-pitch', LolzCloudPitch);
  }
  if (typeof AudioWorkletProcessor === 'function') install();
  else { const source = '(' + install.toString() + ')();'; root.LolzCloudPitchWorkletSource = source; if (typeof module === 'object' && module.exports) module.exports = { source }; }
})(typeof window === 'object' ? window : globalThis);
