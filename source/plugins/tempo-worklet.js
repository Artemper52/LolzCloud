(root => {
  function install() {
    class PeakLimiter extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [{ name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }, { name: 'ceilingDb', defaultValue: -3, minValue: -24, maxValue: 0, automationRate: 'k-rate' }]; }
      constructor() {
        super(); this.delay = Math.ceil(sampleRate * .008); this.buffers = []; this.cursor = 0; this.gain = 1; this.hold = 0;
        this.attack = Math.exp(-1 / (sampleRate * .001)); this.release = Math.exp(-1 / (sampleRate * .16));
        this.meterFrames = 0; this.peak = 0; this.minimumGain = 1;
      }
      process(inputs, outputs, parameters) {
        const input = inputs[0] || [], output = outputs[0] || [], frames = output[0]?.length || 128;
        const enabled = parameters.enabled[0] >= .5, ceiling = 10 ** (parameters.ceilingDb[0] / 20);
        let peak = 0;
        for (const channel of input) for (let index = 0; index < channel.length; index++) peak = Math.max(peak, Math.abs(channel[index]));
        const desired = enabled && peak > ceiling ? ceiling / peak : 1;
        if (desired < this.gain) this.hold = Math.ceil(sampleRate * .035);
        for (let channel = this.buffers.length; channel < output.length; channel++) this.buffers.push(new Float32Array(this.delay));
        for (let index = 0; index < frames; index++) {
          if (!enabled) this.gain = 1;
          else if (desired < this.gain) this.gain = desired + this.attack * (this.gain - desired);
          else if (this.hold <= 0) this.gain = desired + this.release * (this.gain - desired);
          this.hold = Math.max(0, this.hold - 1);
          for (let channel = 0; channel < output.length; channel++) {
            const buffer = this.buffers[channel], value = buffer[this.cursor] * this.gain;
            buffer[this.cursor] = input[channel]?.[index] || 0;
            output[channel][index] = enabled ? Math.max(-ceiling, Math.min(ceiling, value)) : value;
          }
          this.cursor = (this.cursor + 1) % this.delay;
        }
        this.peak = Math.max(this.peak, peak); this.minimumGain = Math.min(this.minimumGain, this.gain); this.meterFrames += frames;
        if (this.meterFrames >= sampleRate * .1) {
          this.port.postMessage({ peakDb: this.peak ? Math.max(-96, 20 * Math.log10(this.peak)) : -96, reductionDb: enabled ? Math.max(0, -20 * Math.log10(this.minimumGain)) : 0 });
          this.peak = 0; this.minimumGain = 1; this.meterFrames = 0;
        }
        return true;
      }
    }
    class TempoFeatures extends AudioWorkletProcessor {
      constructor() { super(); this.low = 0; this.lowEnergy = 0; this.energy = 0; this.count = 0; this.previousLow = 0; this.previousFull = 0; this.alpha = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate); }
      process(inputs, outputs) {
        for (const channel of outputs[0] || []) channel.fill(0);
        const input = inputs[0]?.[0]; if (!input) return true;
        for (let index = 0; index < input.length; index++) {
          const value = input[index]; this.low += this.alpha * (value - this.low);
          this.lowEnergy += this.low ** 2; this.energy += value ** 2; this.count++;
          if (this.count >= sampleRate / 30) {
            const low = Math.log1p(Math.sqrt(this.lowEnergy / this.count) * 120), full = Math.log1p(Math.sqrt(this.energy / this.count) * 120);
            const flux = Math.max(0, low - this.previousLow) * 3 + Math.max(0, full - this.previousFull);
            this.port.postMessage({ time: currentTime + index / sampleRate, energy: low * .35 + full * .08 + flux });
            this.previousLow = low; this.previousFull = full; this.lowEnergy = this.energy = this.count = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('lolzcloud-tempo', TempoFeatures);
    registerProcessor('lolzcloud-limiter', PeakLimiter);
  }
  if (typeof AudioWorkletProcessor === 'function') install();
  else { const source = '(' + install.toString() + ')();'; root.LolzCloudTempoWorkletSource = source; if (typeof module === 'object' && module.exports) module.exports = { source }; }
})(typeof window === 'object' ? window : globalThis);
