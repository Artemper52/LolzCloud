(() => {
  if (window.__lolzcloudAudioFX) return;
  const audio = new Set(), graphs = new WeakMap(), sources = new WeakMap(), sourceNodes = new WeakMap(), settling = new WeakSet(), impulses = new WeakMap(), corsManaged = new WeakSet(), corsFallback = new WeakSet(), wantedPlayback = new WeakSet();
  const mediaTracks = new WeakMap();
  const selectActive = () => [...audio].find(media => !media.paused) || [...audio].at(-1);
  const defaults = { enabled: false, gains: [0, 0, 0, 0, 0], rate: 1, preservesPitch: false, reverb: 0, echo: 0 };
  const status = window.__lolzcloudAudioFX = { config: { ...defaults }, attached: 0, unavailable: false, reason: '', rate: 1, mediaCount: 0, audio };
  const safety = { limiter: true, ceilingDb: -3, duckGain: 1 };
  let normalization = { enabled: false, url: '', gainDb: 0 }, normalizationMeter = { available: false };
  window.__lolzcloudSetNormalization = value => {
    normalization = { enabled: value?.enabled === true, url: typeof value?.url === 'string' ? value.url : '', gainDb: Number.isFinite(value?.gainDb) ? Math.max(-8, Math.min(8, value.gainDb)) : 0 };
    for (const media of audio) { const graph = graphs.get(media); if (graph?.normalizer) graph.normalizer.port.postMessage({ ...normalization, inputVolume: media.volume, key: mediaTracks.get(media) || normalization.url }); }
  };
  let context;
  let desiredVolume = null;
  const tracker = window.LolzCloudBeatTracker ? new window.LolzCloudBeatTracker() : null;
  const rhythm = { key: '', url: '', available: false, lastAt: 0, position: 0, rate: 1 };
  const workletModules = new WeakMap();
  const rhythmMedia = () => {
    const usable = media => media && !media.paused && !media.error && media.duration > 1;
    return usable(status.currentMedia) ? status.currentMedia : [...audio].find(usable);
  };
  function rhythmFrame(media, record, time, energy) {
    if (!tracker || rhythmMedia() !== media || !Number.isFinite(time) || !Number.isFinite(energy)) return;
    const url = document.querySelector('.playbackSoundBadge__titleLink')?.href || '', rate = media.playbackRate || 1, key = url + '\n' + (media.currentSrc || media.src);
    if (key !== rhythm.key || rate !== rhythm.rate || time - rhythm.lastAt > 3) tracker.reset();
    Object.assign(rhythm, { key, url, record, available: true, lastAt: time, position: media.currentTime, rate });
    tracker.push(time, energy);
  }
  function workletModule(owner) {
    if (!owner.audioWorklet || !window.LolzCloudTempoWorkletSource || !window.AudioWorkletNode) return null;
    let module = workletModules.get(owner);
    if (!module) {
      const url = URL.createObjectURL(new Blob([window.LolzCloudTempoWorkletSource, '\n', window.LolzCloudNormalizerSource || ''], { type: 'text/javascript' }));
      module = owner.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)); workletModules.set(owner, module);
    }
    return module;
  }
  function prepareWorklet(media, record) {
    if (record.workletPromise) return;
    const module = workletModule(record.context); if (!module) return;
    record.workletPromise = module.then(() => {
      const node = new AudioWorkletNode(record.context, 'lolzcloud-tempo', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      record.worklet = node; node.port.onmessage = event => rhythmFrame(media, record, Number(event.data?.time), Number(event.data?.energy));
      if (rhythm.record === record) tracker?.reset();
      connect(record.node, node); if (!media.paused) connect(node, record.context.destination);
    }).catch(() => { record.workletUnavailable = true; });
  }
  const nativeConnect = AudioNode.prototype.connect, nativeDisconnect = AudioNode.prototype.disconnect;
  const connect = (node, ...args) => Reflect.apply(nativeConnect, node, args);
  const disconnect = (node, ...args) => Reflect.apply(nativeDisconnect, node, args);
  function rememberSource(media, node, owner) {
    if (sources.has(media)) return;
    const record = { node, context: owner, routes: [], graph: null };
    sources.set(media, record); sourceNodes.set(node, record); add(media);
  }
  // SoundCloud already owns a MediaElementAudioSourceNode. Splice into that graph
  // instead of trying to create a forbidden second source for the same element.
  for (const Constructor of new Set([window.AudioContext, window.webkitAudioContext].filter(Boolean))) {
    const prototype = Constructor.prototype, createSource = prototype?.createMediaElementSource;
    if (typeof createSource !== 'function') continue;
    prototype.createMediaElementSource = function(media) { const node = Reflect.apply(createSource, this, [media]); rememberSource(media, node, this); return node; };
  }
  if (window.MediaElementAudioSourceNode) {
    const NativeSource = window.MediaElementAudioSourceNode;
    window.MediaElementAudioSourceNode = new Proxy(NativeSource, { construct(target, args, newTarget) { const node = Reflect.construct(target, args, newTarget); if (args[1]?.mediaElement) rememberSource(args[1].mediaElement, node, args[0]); return node; } });
  }
  AudioNode.prototype.connect = function(...args) {
    const record = sourceNodes.get(this);
    if (!record) return connect(this, ...args);
    const result = connect(record.graph?.output || this, ...args);
    if (!record.routes.some(route => route[0] === args[0] && (route[1] || 0) === (args[1] || 0) && (route[2] || 0) === (args[2] || 0))) record.routes.push(args);
    return result;
  };
  AudioNode.prototype.disconnect = function(...args) {
    const record = sourceNodes.get(this);
    if (!record) return disconnect(this, ...args);
    const result = disconnect(record.graph?.output || this, ...args);
    record.routes = record.routes.filter(route => {
      if (!args.length) return false;
      if (typeof args[0] === 'number') return (route[1] || 0) !== args[0];
      return route[0] !== args[0] || (args.length > 1 && (route[1] || 0) !== args[1]) || (args.length > 2 && (route[2] || 0) !== args[2]);
    });
    return result;
  };
  function prepareCors(media, value) {
    try {
      const url = new URL(value, location.href);
      const supported = ['soundcloud.com', 'sndcdn.com', 'soundcloud.cloud'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      if (url.protocol === 'https:' && supported && !media.crossOrigin && !corsFallback.has(media)) { media.crossOrigin = 'anonymous'; corsManaged.add(media); }
    } catch { /* Ignore an incomplete media source. */ }
  }
  function smooth(parameter, value, owner) {
    if (parameter.setTargetAtTime) parameter.setTargetAtTime(value, owner.currentTime, .045);
    else parameter.value = value;
  }
  function roomImpulse(owner) {
    if (impulses.has(owner)) return impulses.get(owner);
    const length = Math.floor(owner.sampleRate * 2.8);
    const impulse = owner.createBuffer(2, length, owner.sampleRate);
    let seed = 92371;
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[index] = (seed / 2147483648 - 1) * (1 - index / length) ** 3.2;
      }
    }
    impulses.set(owner, impulse); return impulse;
  }
  function setTempo(media) {
    const rate = status.config.enabled ? status.config.rate : 1;
    try {
      if (Math.abs(media.playbackRate - rate) > .001) media.playbackRate = rate;
      media.preservesPitch = status.config.enabled ? status.config.preservesPitch : true;
      if (desiredVolume !== null) media.volume = desiredVolume;
      status.rate = rate;
    } catch { /* Some advertisement media elements disallow playback changes. */ }
  }
  function attach(media) {
    if (graphs.has(media) || media.readyState < 2 || media.error || (media.paused && !wantedPlayback.has(media))) return;
    const src = media.currentSrc || media.src;
    if (!src) return;
    try {
      // Never route an opaque media response: Web Audio would mute that element.
      if (!src.startsWith('blob:') && !src.startsWith('data:') && new URL(src, location.href).origin !== location.origin && media.crossOrigin !== 'anonymous') { status.unavailable = true; status.reason = 'opaque-source'; return; }
      let record = sources.get(media);
      if (!record && !settling.has(media)) { settling.add(media); setTimeout(() => attach(media), 100); return; }
      if (!record) {
        context ||= new AudioContext();
        const node = context.createMediaElementSource(media);
        record = sources.get(media);
        if (!record) { rememberSource(media, node, context); record = sources.get(media); }
        record.routes.push([context.destination]);
      }
      const owner = record.context, source = record.node;
      const filters = [60, 230, 910, 3600, 14000].map((frequency, index) => {
        const filter = owner.createBiquadFilter();
        filter.type = index === 0 ? 'lowshelf' : index === 4 ? 'highshelf' : 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1;
        return filter;
      });
      const headroom = owner.createGain(), dry = owner.createGain(), wet = owner.createGain(), echo = owner.createGain(), feedback = owner.createGain();
      const convolver = owner.createConvolver(), delay = owner.createDelay(1), compressor = owner.createDynamicsCompressor(), output = owner.createGain();
      output.gain.value = safety.duckGain;
      compressor.threshold.value = 0; compressor.knee.value = 0; compressor.ratio.value = 1;
      compressor.attack.value = .006; compressor.release.value = .15;
      wet.gain.value = 0; echo.gain.value = 0; feedback.gain.value = 0;
      convolver.buffer = roomImpulse(owner); delay.delayTime.value = .28;
      filters.forEach((node, index) => node.connect(filters[index + 1] || headroom));
      headroom.connect(dry); dry.connect(compressor);
      headroom.connect(convolver); convolver.connect(wet); wet.connect(compressor);
      headroom.connect(delay); delay.connect(echo); echo.connect(compressor);
      delay.connect(feedback); feedback.connect(delay);
      compressor.connect(output);
      const graph = { context: owner, filters, headroom, dry, wet, echo, feedback, compressor, output, limiter: null, meter: { peakDb: -96, reductionDb: 0 } };
      // Build first. If rewiring fails, restore every SDK destination before reporting it.
      try {
        disconnect(source); connect(source, filters[0]);
        for (const route of record.routes) connect(output, ...route);
      } catch (error) {
        disconnect(source); disconnect(output);
        for (const route of record.routes) connect(source, ...route);
        throw error;
      }
      record.graph = graph; graphs.set(media, graph);
      const module = workletModule(owner);
      if (module) graph.limiterReady = module.then(() => {
        if (window.LolzCloudNormalizerSource) {
          const normalizer = new AudioWorkletNode(owner, 'lolzcloud-normalization', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
          normalizer.port.onmessage = event => { if (media === selectActive()) normalizationMeter = { available: true, ...event.data }; };
          connect(normalizer, filters[0]); disconnect(source, filters[0]); connect(source, normalizer); graph.normalizer = normalizer;
          normalizer.port.postMessage({ ...normalization, inputVolume: media.volume, key: mediaTracks.get(media) || normalization.url });
        }
        const limiter = new AudioWorkletNode(owner, 'lolzcloud-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], parameterData: { enabled: safety.limiter ? 1 : 0, ceilingDb: safety.ceilingDb } });
        limiter.port.onmessage = event => { const value = event.data; if (Number.isFinite(value?.peakDb) && Number.isFinite(value?.reductionDb)) graph.meter = { peakDb: Math.max(-96, Math.min(24, value.peakDb)), reductionDb: Math.max(0, Math.min(60, value.reductionDb)) }; };
        connect(limiter, output); disconnect(compressor, output); connect(compressor, limiter); graph.limiter = limiter;
      }).catch(() => { graph.limiterUnavailable = true; });
      status.attached++; status.unavailable = false; status.reason = '';
      applyGraph(media);
      if (owner.state === 'suspended') void owner.resume().catch(() => {});
    } catch (error) { status.unavailable = true; status.reason = error.name || 'audio-graph'; }
  }
  function applyGraph(media) {
    const graph = graphs.get(media); if (!graph) return;
    const target = (parameter, value) => smooth(parameter, value, graph.context);
    const config = status.config, active = config.enabled;
    const gains = active ? config.gains : defaults.gains;
    graph.filters.forEach((node, index) => target(node.gain, gains[index]));
    target(graph.headroom.gain, active ? 10 ** (-Math.max(0, ...gains) * .65 / 20) : 1);
    const reverb = active ? config.reverb : 0, echo = active ? config.echo : 0;
    target(graph.dry.gain, Math.cos(reverb * Math.PI / 2));
    target(graph.wet.gain, Math.sin(reverb * Math.PI / 2) * .7);
    target(graph.echo.gain, echo * .6); target(graph.feedback.gain, echo * .55);
    target(graph.compressor.threshold, active ? -3 : 0); target(graph.compressor.knee, active ? 8 : 0);
    target(graph.compressor.ratio, active ? 4 : 1); target(graph.compressor.attack, .006); target(graph.compressor.release, .15);
  }
  function applySafety(graph) {
    if (!graph) return;
    const now = graph.context.currentTime, gain = graph.output.gain;
    gain.cancelScheduledValues(now); gain.setTargetAtTime(safety.duckGain, now, safety.duckGain < gain.value ? .065 : .38);
    if (graph.limiter) {
      graph.limiter.parameters.get('enabled').setValueAtTime(safety.limiter ? 1 : 0, now);
      graph.limiter.parameters.get('ceilingDb').setValueAtTime(safety.ceilingDb, now);
    }
  }
  window.__lolzcloudSetAudioSafety = value => {
    if (typeof value?.limiter === 'boolean') safety.limiter = value.limiter;
    if (Number.isFinite(value?.ceilingDb)) safety.ceilingDb = Math.max(-24, Math.min(0, value.ceilingDb));
    if (Number.isFinite(value?.duckGain)) safety.duckGain = Math.max(0, Math.min(1, value.duckGain));
    for (const media of audio) applySafety(graphs.get(media));
  };
  function add(media) {
    if (audio.has(media)) return media;
    audio.add(media); status.mediaCount = audio.size;
    media.addEventListener('playing', () => { mediaTracks.set(media, document.querySelector('.playbackSoundBadge__titleLink')?.href || location.href); wantedPlayback.add(media); status.currentMedia = media; setTempo(media); attach(media); window.__lolzcloudSnapshot?.(); });
    media.addEventListener('loadedmetadata', () => { setTempo(media); attach(media); });
    media.addEventListener('canplay', () => { setTempo(media); attach(media); });
    media.addEventListener('ratechange', () => setTempo(media));
    media.addEventListener('volumechange', () => graphs.get(media)?.normalizer?.port.postMessage({ inputVolume: media.volume }));
    media.addEventListener('seeking', () => { if (sources.get(media) === rhythm.record) tracker?.reset(); });
    media.addEventListener('pause', () => { const record = sources.get(media); if (record?.worklet) disconnect(record.worklet); });
    media.addEventListener('ended', () => { window.__lolzcloudSnapshot?.(); const url = mediaTracks.get(media); if (url && window.__lolzcloudWaveActive && media.duration > 1 && media.currentTime >= media.duration - .5) console.log('LolzCloudReceive|WaveEnded|' + JSON.stringify({ url })); });
    media.addEventListener('error', () => {
      // Retry a CORS-incompatible source through the original media path before creating a graph.
      if (!corsManaged.has(media) || corsFallback.has(media) || graphs.has(media) || ![2, 4].includes(media.error?.code)) return;
      corsFallback.add(media); status.unavailable = true; status.reason = 'cors-fallback';
      const position = media.currentTime || 0, resume = wantedPlayback.has(media), source = media.src;
      media.removeAttribute('crossorigin');
      media.addEventListener('loadedmetadata', () => {
        if (media.src !== source) return;
        if (position > 0 && Number.isFinite(media.duration)) media.currentTime = Math.min(position, media.duration);
        if (resume) void Reflect.apply(nativePlay, media, []).catch(() => {});
      }, { once: true });
      media.load();
    });
    setTempo(media); if (!media.paused) attach(media);
    return media;
  }
  function apply() {
    status.unavailable = false;
    for (const media of audio) {
      setTempo(media);
      if (!graphs.has(media) && !media.paused) attach(media);
      applyGraph(media);
      const owner = graphs.get(media)?.context; if (owner?.state === 'suspended') void owner.resume().catch(() => {});
    }
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  }
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(...args) {
    if (this.tagName?.toLowerCase() === 'audio') { wantedPlayback.add(this); add(this); setTempo(this); attach(this); }
    return Reflect.apply(nativePlay, this, args);
  };
  const sourceProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (sourceProperty?.set && sourceProperty.configurable) Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...sourceProperty, set(value) { prepareCors(this, value); return sourceProperty.set.call(this, value); } });
  const setAttribute = HTMLMediaElement.prototype.setAttribute;
  HTMLMediaElement.prototype.setAttribute = function(name, value) { if (String(name).toLowerCase() === 'src') prepareCors(this, value); return Reflect.apply(setAttribute, this, [name, value]); };
  const NativeAudio = window.Audio;
  window.Audio = new Proxy(NativeAudio, { construct(target, args, newTarget) { const media = add(Reflect.construct(target, [], newTarget)); if (args[0] !== undefined) { prepareCors(media, args[0]); media.src = args[0]; } return media; } });
  const create = document.createElement.bind(document);
  document.createElement = function(name, options) { const node = create(name, options); return String(name).toLowerCase() === 'audio' ? add(node) : node; };
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeName === 'AUDIO') add(node);
      node.querySelectorAll?.('audio').forEach(add);
    }
  });
  const watchDocument = () => { observer.observe(document.documentElement, { subtree: true, childList: true }); document.querySelectorAll('audio').forEach(add); };
  if (document.documentElement) watchDocument(); else document.addEventListener('DOMContentLoaded', watchDocument, { once: true });
  window.__lolzcloudSetAudioFX = config => {
    const valid = config && Array.isArray(config.gains) && config.gains.length === 5 && config.gains.every(value => Number.isFinite(value) && Math.abs(value) <= 12);
    if (!valid) return false;
    status.config = { ...defaults, ...config, gains: [...config.gains], rate: Math.max(.65, Math.min(1.5, Number(config.rate) || 1)),
      reverb: Math.max(0, Math.min(.8, Number(config.reverb) || 0)), echo: Math.max(0, Math.min(.8, Number(config.echo) || 0)) };
    apply(); return true;
  };
  let transportRequest = 0;
  window.__lolzcloudMediaCommand = (command, value) => {
      if (command === 'seek' && window.__lolzcloudPlayback?.seek(value)) return;
    if (command === 'like') { document.querySelector('.playbackSoundBadge__like, .playControls .sc-button-like')?.click(); setTimeout(() => window.__lolzcloudSnapshot?.(), 80); return; }
    if (command === 'repeat') return window.__lolzcloudRepeat?.set(value);
    const button = document.querySelector('.playControls__elements .playControl, .playControls__play');
    if (command === 'playPause') { button?.click(); return; }
    if (command === 'next') { transportRequest++; document.querySelector('.playControls__next')?.click(); return; }
    if (command === 'previous') {
      const request = ++transportRequest, previous = document.querySelector('.playControls__prev'), badge = document.querySelector('.playbackSoundBadge__titleLink')?.href;
      const media = [...audio].find(node => !node.paused) || [...audio].at(-1), position = media?.currentTime || 0;
      previous?.click();
      // SoundCloud treats the first previous click after a few seconds as
      // restart. Only repeat it if that exact recording actually reset to 0.
      setTimeout(() => { if (request === transportRequest && position > 3 && media?.currentTime < 1 && document.querySelector('.playbackSoundBadge__titleLink')?.href === badge) previous?.click(); }, 160);
      return;
    }
    if (command === 'play' || command === 'pause') { if (button && button.classList.contains('playing') !== (command === 'play')) button.click(); return; }
    const candidates = [...audio].filter(media => Number.isFinite(media.duration) && media.duration > 0);
    const active = candidates.find(media => !media.paused) || candidates.at(-1);
    if (command === 'volume') { desiredVolume = Math.min(1, Math.max(0, Number(value) || 0)); for (const media of audio) media.volume = desiredVolume; return; }
    if (command === 'seek') { if (active) active.currentTime = Math.min(active.duration, Math.max(0, Number(value) || 0)); return; }
    if (active && ['volumeUp', 'volumeDown'].includes(command)) active.volume = Math.min(1, Math.max(0, active.volume + (command === 'volumeUp' ? .05 : -.05)));
  };
  window.__lolzcloudGetAudioState = () => {
    const active = [...audio].find(media => !media.paused);
    const graph = graphs.get(active || status.currentMedia);
    const players = [...document.querySelectorAll('.playControls,#playControls,[data-testid="play-controls"],[data-testid="playback-controls"]')];
    const ui = { nativePlayersVisible: players.filter(node => node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden').length,
      likeAvailable: !!document.querySelector('.playbackSoundBadge__like, .playControls .sc-button-like'), repeatAvailable: !!document.querySelector('.playControls .repeatControl, .playControls__repeat'), hiddenPromotions: Number(window.__lolzcloudPromotions?.hidden) || 0 };
    return { normalization: normalizationMeter, attached: status.attached, unavailable: status.unavailable, reason: status.reason, mediaCount: audio.size, rate: status.rate, volume: desiredVolume ?? active?.volume ?? 1, ui, safety: { limiterAvailable: !!graph?.limiter, limiter: safety.limiter, ceilingDb: safety.ceilingDb, duckGain: safety.duckGain, ...(graph?.meter || { peakDb: -96, reductionDb: 0 }) }, sampledAt: Date.now(), tempo: { url: rhythm.url, available: rhythm.available, method: rhythm.record?.worklet ? 'worklet' : 'analyser', ...(tracker?.state(rhythm.record?.context.currentTime ?? performance.now() / 1000) || { bpm: 0, confidence: 0, beatAge: null }) } };
  };
  if (tracker) setInterval(() => {
    const media = rhythmMedia(), record = media && sources.get(media);
    rhythm.available = false;
    if (!media || !record || record.context.state !== 'running') return;
    try {
      prepareWorklet(media, record);
      if (record.worklet) { connect(record.node, record.worklet); connect(record.worklet, record.context.destination); rhythm.available = true; return; }
      if (!record.analyser) { record.analyser = record.context.createAnalyser(); record.analyser.fftSize = 1024; record.analyser.smoothingTimeConstant = .15; record.spectrum = new Uint8Array(record.analyser.frequencyBinCount); }
      // A silent analysis branch leaves the SDK's audible destinations untouched.
      connect(record.node, record.analyser); record.analyser.getByteFrequencyData(record.spectrum);
      const binHz = record.context.sampleRate / record.analyser.fftSize;
      let low = 0, mid = 0, lowCount = 0, midCount = 0;
      for (let index = Math.max(1, Math.floor(40 / binHz)); index < Math.min(record.spectrum.length, Math.ceil(2400 / binHz)); index++) {
        const value = (record.spectrum[index] / 255) ** 2;
        if (index * binHz <= 190) { low += value; lowCount++; } else { mid += value; midCount++; }
      }
      rhythmFrame(media, record, record.context.currentTime, low / (lowCount || 1) + .22 * mid / (midCount || 1));
    } catch { /* An unavailable analyser does not affect music playback. */ }
  }, 33);
  document.querySelectorAll('audio').forEach(add);
  document.addEventListener('click', event => {
    if (window.__lolzcloudWaveActive && event.target.closest?.('.playControls__next')) { event.preventDefault(); event.stopImmediatePropagation(); console.log('LolzCloudReceive|WaveNext'); }
  }, true);
  document.addEventListener('pointerdown', () => { if (context?.state === 'suspended') void context.resume().catch(() => {}); }, true);
})();
