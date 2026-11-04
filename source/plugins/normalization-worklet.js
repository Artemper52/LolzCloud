(function (root) {
  'use strict';
  function install() {
    function coefficients(frequency, q, gain) {
      const k = Math.tan(Math.PI * frequency / sampleRate), a0 = 1 + k / q + k * k;
      if (gain === undefined) return [1, -2, 1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0];
      const vh = 10 ** (gain / 20), vb = vh ** .4996667741545416;
      return [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0];
    }
    class Loudness extends AudioWorkletProcessor {
      constructor() {
        super(); this.shelf = coefficients(1681.974450955533, .7071752369554196, 3.999843853973347); this.highpass = coefficients(38.13547087602444, .5003270373238773);
        this.channels = []; this.enabled = false; this.key = ''; this.gainDb = 0; this.targetDb = 0; this.energy = 0; this.count = 0; this.blocks = []; this.postFrames = 0; this.totalFrames = 0; this.inputVolume = 1;
        this.port.onmessage = event => { const data = event.data || {}; if (typeof data.key === 'string' && data.key !== this.key) { this.key = data.key; this.energy = this.count = this.totalFrames = this.postFrames = 0; this.blocks = []; this.channels = []; this.targetDb = Number.isFinite(data.gainDb) ? Math.max(-8, Math.min(8, data.gainDb)) : 0; this.gainDb = this.targetDb; } if (typeof data.enabled === 'boolean') this.enabled = data.enabled; if (Number.isFinite(data.inputVolume)) this.inputVolume = Math.max(0, Math.min(1, data.inputVolume)); };
      }
      filter(value, coefficients, memory) { const out = coefficients[0] * value + memory[0]; memory[0] = coefficients[1] * value - coefficients[3] * out + memory[1]; memory[1] = coefficients[2] * value - coefficients[4] * out; return out; }
      process(inputs, outputs) {
        const input = inputs[0] || [], output = outputs[0] || [], frames = output[0]?.length || 128;
        for (let channel = this.channels.length; channel < input.length; channel++) this.channels.push([new Float64Array(2), new Float64Array(2)]);
        const destinationDb = this.enabled ? this.targetDb : 0, maximumStep = frames / sampleRate;
        this.gainDb += Math.max(-maximumStep, Math.min(maximumStep, destinationDb - this.gainDb)); const gain = 10 ** (this.gainDb / 20);
        for (let index = 0; index < frames; index++) {
          for (let channel = 0; channel < output.length; channel++) output[channel][index] = (input[channel]?.[index] ?? input[0]?.[index] ?? 0) * gain;
          if (this.enabled && this.inputVolume > .001) for (let channel = 0; channel < input.length; channel++) { const memories = this.channels[channel]; const value = this.filter(this.filter((input[channel][index] || 0) / this.inputVolume, this.shelf, memories[0]), this.highpass, memories[1]); this.energy += value * value; }
          this.count++; this.totalFrames++; this.postFrames++;
          if (this.count >= sampleRate * .4) {
            const energy = this.energy / this.count, loudness = -.691 + 10 * Math.log10(Math.max(energy, 1e-12));
            if (this.enabled && loudness > -70) { this.blocks.push(energy); if (this.blocks.length > 1500) this.blocks.shift(); const mean = this.blocks.reduce((sum, value) => sum + value, 0) / this.blocks.length; const gated = this.blocks.filter(value => value >= mean / 10); const integrated = -.691 + 10 * Math.log10(gated.reduce((sum, value) => sum + value, 0) / Math.max(1, gated.length)); if (this.totalFrames >= sampleRate * 3) this.targetDb = Math.max(-8, Math.min(8, -14 - integrated)); this.loudness = integrated; }
            this.energy = this.count = 0;
          }
        }
        if (this.postFrames >= sampleRate * 5) { this.postFrames = 0; this.port.postMessage({ key: this.key, measured: this.blocks.length >= 8, loudness: Number.isFinite(this.loudness) ? this.loudness : null, gainDb: this.enabled ? this.targetDb : 0, enabled: this.enabled }); }
        return true;
      }
    }
    registerProcessor('lolzcloud-normalization', Loudness);
  }
  if (typeof AudioWorkletProcessor === 'function') install();
  else { const source = '(' + install.toString() + ')();'; root.LolzCloudNormalizerSource = source; if (typeof module === 'object' && module.exports) module.exports = { source }; }
})(typeof window === 'object' ? window : globalThis);
