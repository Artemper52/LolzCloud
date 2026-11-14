(() => {
  'use strict';
  const { ipcRenderer } = require('electron');
  const audio = document.createElement('audio'); audio.hidden = true; audio.preload = 'auto'; document.body.append(audio);
  let current = null, generation = 0, playRevision = 0, wantsPlay = false, context = null, graph = null, config = { enabled: false }, normalization = { enabled: false }, lastGainSave = 0, volume = 1;
  function report() { if (!current) return; ipcRenderer.send('player-tools:local-state', { id: current.id, token: current.token, duration: Number.isFinite(audio.duration) ? audio.duration : 0, position: audio.currentTime, playing: !audio.paused && !audio.ended, ended: audio.ended, error: !!audio.error }); }
  function impulse(owner) { const buffer = owner.createBuffer(2, Math.ceil(owner.sampleRate * 1.2), owner.sampleRate); let seed = 143; for (let channel = 0; channel < 2; channel++) { const data = buffer.getChannelData(channel); for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 2 ** 31 - 1) * (1 - i / data.length) ** 3; } } return buffer; }
  async function attach() {
    if (graph) return;
    context ||= new AudioContext(); const source = context.createMediaElementSource(audio), filters = [60, 230, 910, 3600, 14000].map((frequency, index) => { const node = context.createBiquadFilter(); node.type = index === 0 ? 'lowshelf' : index === 4 ? 'highshelf' : 'peaking'; node.frequency.value = frequency; return node; });
    const dry = context.createGain(), reverb = context.createGain(), echo = context.createGain(), feedback = context.createGain(), delay = context.createDelay(1), convolver = context.createConvolver(), mix = context.createGain(), compressor = context.createDynamicsCompressor(), master = context.createGain();
    convolver.buffer = impulse(context); delay.delayTime.value = .28; reverb.gain.value = echo.gain.value = feedback.gain.value = 0;
    filters.forEach((node, index) => node.connect(filters[index + 1] || dry)); dry.connect(mix); dry.connect(convolver); convolver.connect(reverb); reverb.connect(mix); dry.connect(delay); delay.connect(echo); echo.connect(mix); delay.connect(feedback); feedback.connect(delay); mix.connect(compressor); compressor.threshold.value = -3; compressor.knee.value = 0; compressor.ratio.value = 20; compressor.attack.value = .003; compressor.release.value = .1; compressor.connect(master); master.connect(context.destination);
    graph = { source, filters, dry, reverb, echo, feedback, compressor, master, normalizer: null }; source.connect(filters[0]);
    if (window.LolzCloudNormalizerSource && context.audioWorklet) {
      const url = URL.createObjectURL(new Blob([window.LolzCloudNormalizerSource, '\n', window.LolzCloudTempoWorkletSource || ''], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); const normalizer = new AudioWorkletNode(context, 'lolzcloud-normalization', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); normalizer.port.onmessage = event => { const value = event.data; if (value.measured && normalization.enabled && Date.now() - lastGainSave > 20000) { lastGainSave = Date.now(); ipcRenderer.send('player-tools:gain', { url: value.key, gainDb: value.gainDb }); } }; normalizer.connect(filters[0]); source.disconnect(filters[0]); source.connect(normalizer); graph.normalizer = normalizer;
        if (window.LolzCloudTempoWorkletSource) { const limiter = new AudioWorkletNode(context, 'lolzcloud-limiter', { outputChannelCount: [2], parameterData: { enabled: 1, ceilingDb: -3 } }); compressor.disconnect(master); compressor.connect(limiter); limiter.connect(master); }
      } catch { /* Basic playback and the compressor remain available. */ } finally { URL.revokeObjectURL(url); }
    }
    apply();
  }
  function apply() {
    audio.playbackRate = config.enabled ? Math.max(.65, Math.min(1.5, config.rate || 1)) : 1; audio.preservesPitch = config.preservesPitch === true;
    if (!graph) return;
    const target = (node, value) => node.setTargetAtTime(value, context.currentTime, .04);
    target(graph.master.gain, volume); graph.filters.forEach((filter, index) => target(filter.gain, config.enabled ? config.gains?.[index] || 0 : 0)); target(graph.reverb.gain, config.enabled ? (config.reverb || 0) * .7 : 0); target(graph.echo.gain, config.enabled ? (config.echo || 0) * .6 : 0); target(graph.feedback.gain, config.enabled ? (config.echo || 0) * .55 : 0);
    graph.normalizer?.port.postMessage({ enabled: normalization.enabled, key: current?.url || '', gainDb: current?.cachedGain });
  }
  async function resumePlayback() {
    const token = generation, request = ++playRevision; wantsPlay = true;
    const valid = () => current && token === generation && request === playRevision && wantsPlay;
    try { await attach(); if (!valid()) return; apply(); await context?.resume(); if (!valid()) return; await audio.play(); } catch { if (valid()) { wantsPlay = false; report(); } }
  }
  function pausePlayback() { wantsPlay = false; playRevision++; audio.pause(); }
  async function play(value) {
    if (!value || !/^[a-f0-9]{32}$/.test(value.id) || !String(value.source).startsWith('file:')) return;
    const token = ++generation; audio.pause(); current = { ...value }; normalization.enabled = value.normalization === true; volume = Math.max(0, Math.min(1, Number(value.volume) || 0)); audio.volume = 1; audio.src = value.source; audio.load();
    const position = Number(value.position) || 0;
    audio.onloadedmetadata = () => { if (token !== generation) return; if (position > 0) audio.currentTime = Math.min(audio.duration, position); report(); };
    await resumePlayback();
  }
  function stop() { generation++; current = null; pausePlayback(); audio.removeAttribute('src'); audio.load(); }
  function command({ command, value }) { if (!current) return; if (command === 'playPause') command = wantsPlay || !audio.paused ? 'pause' : 'play'; if (command === 'play') void resumePlayback(); else if (command === 'pause') pausePlayback(); else if (command === 'seek' && Number.isFinite(value) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, value)); else if (command === 'volume' && Number.isFinite(value)) { volume = Math.max(0, Math.min(1, value)); apply(); } report(); }
  audio.addEventListener('ended', () => { wantsPlay = false; });
  for (const event of ['play', 'pause', 'seeked', 'ended', 'error', 'durationchange']) audio.addEventListener(event, report);
  setInterval(() => { if (current && !audio.paused) report(); }, 500);
  ipcRenderer.on('lolzcloud:local-play', (_event, value) => { void play(value); }); ipcRenderer.on('lolzcloud:local-stop', stop); ipcRenderer.on('lolzcloud:local-media', (_event, value) => command(value)); ipcRenderer.on('lolzcloud:dsp', (_event, value) => { config = value; apply(); }); ipcRenderer.on('lolzcloud:normalization', (_event, value) => { normalization = value; apply(); });
  window.addEventListener('lolzcloud:state', event => { config = event.detail.features?.dsp || config; apply(); });
  window.LolzCloudLocal = { get current() { return current; }, position: () => current ? audio.currentTime : null, stop, command, async shutdown() { stop(); if (context && context.state !== 'closed') await context.close(); } };
})();
