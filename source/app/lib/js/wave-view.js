(() => {
  'use strict';
  class WaveView {
    constructor(canvas, { ambient = false, fps = 30 } = {}) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.visible = false; this.playing = false; this.time = 0; this.frame = null; this.energy = 0;
      this.ambient = ambient; this.palette = window.LolzCloudColors.fallback.map(color => [...color]); this.targetPalette = this.palette;
      this.frameInterval = 1000 / Math.max(15, Math.min(30, fps));
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced.addEventListener('change', () => this.update());
      document.addEventListener('visibilitychange', () => this.update());
      new MutationObserver(() => this.update()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
      new ResizeObserver(() => { this.resize(); this.update(); }).observe(canvas);
      window.LolzCloudVisuals.subscribe(this);
    }
    resize() {
      const bounds = this.canvas.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(1.25, devicePixelRatio || 1, 1000 / Math.max(bounds.width, bounds.height)), width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    }
    setState(visible, playing) { this.visible = visible; this.playing = playing; this.update(); }
    setPalette(palette) { this.targetPalette = palette.map(color => [...color]); if (document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches) this.palette = this.targetPalette.map(color => [...color]); if (this.ctx) this.update(); }
    update() {
      if (!this.ctx) return;
      const still = this.reduced.matches || document.documentElement.dataset.motion === 'reduced';
      if (still) { this.palette = this.targetPalette.map(color => [...color]); this.energy = 0; }
      if (this.visible && !document.hidden) {
        this.resize(); this.draw();
        if (!still && !this.frame) this.frame = requestAnimationFrame(value => this.tick(value));
      } else if (this.frame) { cancelAnimationFrame(this.frame); this.frame = null; this.lastFrame = 0; }
      if (still && this.frame) { cancelAnimationFrame(this.frame); this.frame = null; }
    }
    tick(now) {
      this.frame = null;
      if (!this.visible || document.hidden || this.reduced.matches || document.documentElement.dataset.motion === 'reduced') return;
      if (now - (this.lastFrame || 0) >= this.frameInterval - 1) {
        const delta = this.lastFrame ? Math.min(64, now - this.lastFrame) : 33;
        const pulse = this.playing ? window.LolzCloudVisuals.pulse() : 0;
        this.energy += (pulse - this.energy) * (1 - Math.exp(-delta / (pulse > this.energy ? 150 : 600)));
        this.time += delta / 1000 * (this.playing ? 1 : .3); this.lastFrame = now;
        const mix = 1 - Math.exp(-delta / 2400);
        this.palette = this.palette.map((color, index) => color.map((value, channel) => value + (this.targetPalette[index][channel] - value) * mix));
        this.draw();
      }
      this.frame = requestAnimationFrame(value => this.tick(value));
    }
    draw() {
      const ctx = this.ctx, width = this.canvas.width, height = this.canvas.height, t = this.time;
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);
      const still = this.reduced?.matches || document.documentElement.dataset.motion === 'reduced';
      const pulse = this.playing && !still ? this.energy : 0;
      const breath = 1 + pulse * (this.ambient ? .008 : .012);
      const backdrop = this.palette[0].map(value => Math.round(value * .07 + 8)); ctx.fillStyle = 'rgb(' + backdrop.join(',') + ')'; ctx.fillRect(0, 0, width, height);
      const layers = [
        { x: .24, y: .33, rx: .70, ry: .95, color: 0, phase: .4, opacity: .54 },
        { x: .77, y: .27, rx: .61, ry: .84, color: 1, phase: 2.1, opacity: .42 },
        { x: .57, y: .70, rx: .67, ry: .88, color: 2, phase: 4.4, opacity: .38 },
        { x: .44, y: .14, rx: .48, ry: .62, color: 3, phase: 5.7, opacity: .25 },
      ];
      for (const layer of layers) {
        const rgb = this.palette[layer.color].map(Math.round).join(',');
        const x = width * (layer.x + Math.sin(t * .085 + layer.phase) * .075), y = height * (layer.y + Math.cos(t * .065 + layer.phase) * .08);
        ctx.save(); ctx.translate(x, y); ctx.scale(width * layer.rx * breath, height * layer.ry * breath);
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gradient.addColorStop(0, 'rgba(' + rgb + ',' + layer.opacity + ')');
        gradient.addColorStop(.42, 'rgba(' + rgb + ',' + layer.opacity * .48 + ')');
        gradient.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.fillStyle = gradient; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      }
      const shade = ctx.createLinearGradient(0, 0, 0, height); shade.addColorStop(0, '#0b101208'); shade.addColorStop(1, this.ambient ? '#0b101230' : '#0b101280'); ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
    }
  }
  window.LolzCloudWaveView = WaveView;
})();
