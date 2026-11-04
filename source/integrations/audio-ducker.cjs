'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeProtection } = require('./sound-protection.cjs');
const VOICE_APPS = /^(discord(?:canary|ptb)?|chrome|msedge|firefox|brave|opera|opera_gx|vivaldi|browser|yandex|thorium|zen|floorp|waterfox|librewolf|telegram|zoom|teams|ms-teams|skype|whatsapp|webex|slack|vesktop|legcord)$/i;
function eligibleSession(row, settings, ownName = 'LolzCloud', ownPid = process.pid) {
  return row && Number.isInteger(row.pid) && row.pid > 0 && row.pid !== ownPid && typeof row.name === 'string' && /^[\w .-]{1,64}$/.test(row.name)
    && ![ownName, 'LolzCloud'].some(name => row.name.toLowerCase() === name.toLowerCase())
    && Number.isFinite(row.peak) && row.peak >= 0 && row.peak <= 1 && (settings.scope === 'all' || VOICE_APPS.test(row.name));
}
class DuckEnvelope {
  constructor(settings, { ownName = 'LolzCloud', ownPid = process.pid } = {}) {
    Object.assign(this, { ownName, ownPid }); this.settings = normalizeProtection(settings); this.aboveSince = null; this.lastSound = null; this.lastAt = null;
    this.value = { available: false, active: false, gain: 1, sources: [], peakDb: -96 };
  }
  configure(settings) { this.settings = normalizeProtection(settings); this.aboveSince = this.lastSound = null; this.lastAt = null; this.value = { ...this.value, active: false, gain: 1, sources: [], peakDb: -96 }; }
  update(sample, now = Date.now()) {
    const settings = this.settings, available = sample?.available === true;
    const eligible = settings.ducking && available && Array.isArray(sample.sessions) ? sample.sessions.slice(0, 256).filter(row => eligibleSession(row, settings, this.ownName, this.ownPid)) : [];
    // Windows loopback/capture sessions can report the output mix under Discord,
    // Steam or OBS. Compare on the same endpoint, without recording any audio.
    // A copied LolzCloud meter must never turn our own music into a duck trigger.
    const ownAudio = Array.isArray(sample?.ownAudio) ? sample.ownAudio.filter(row => Number.isInteger(row.device) && Number.isFinite(row.peak) && row.peak > .00001 && row.peak <= 1) : [];
    const echoes = eligible.filter(row => Number.isInteger(row.device) && ownAudio.some(own => own.device === row.device && Math.abs(own.peak - row.peak) <= Math.max(.00002, own.peak * .05)));
    const rows = eligible.filter(row => !echoes.includes(row));
    const peak = Math.max(0, ...rows.map(row => row.peak)), threshold = 10 ** (settings.thresholdDb / 20), above = peak >= threshold;
    if (this.lastAt !== null && (now - this.lastAt > 1000 || now < this.lastAt)) { this.aboveSince = null; this.lastSound = null; }
    this.lastAt = now;
    if (above) { if (this.aboveSince === null) this.aboveSince = now; if (now - this.aboveSince >= 100) this.lastSound = now; }
    else this.aboveSince = null;
    const active = settings.ducking && available && this.lastSound !== null && now - this.lastSound <= 900;
    const sources = above ? [...new Set(rows.filter(row => row.peak >= threshold).map(row => row.name))].slice(0, 8) : active ? this.value.sources : [];
    this.value = { available, active, gain: active ? 10 ** (settings.duckDb / 20) : 1, sources, ignoredEchoes: [...new Set(echoes.map(row => row.name))].slice(0, 8), peakDb: peak > 0 ? Math.max(-96, 20 * Math.log10(peak)) : -96 };
    return this.value;
  }
}
class AudioDucker {
  constructor({ directory, settings, onChange = () => {}, platform = process.platform, spawnProcess = spawn }) {
    Object.assign(this, { directory, onChange, platform, spawnProcess });
    this.ownName = path.basename(process.execPath, '.exe'); this.envelope = new DuckEnvelope(settings, { ownName: this.ownName });
    this.child = null; this.closed = false; this.failures = 0; this.receivedAt = 0; this.lastSent = ''; this.reason = ''; this.revision = 0;
  }
  state() { return { ...this.envelope.value, enabled: this.envelope.settings.ducking, reason: this.reason }; }
  config() { return { ...this.envelope.settings, duckGain: this.envelope.value.gain, revision: this.revision }; }
  publish() {
    const key = JSON.stringify([this.envelope.settings, this.envelope.value.active, this.envelope.value.available, this.envelope.value.sources, this.reason]);
    if (key !== this.lastSent) { this.lastSent = key; this.revision++; this.onChange(this.config(), this.state()); }
  }
  configure(settings) {
    this.envelope.configure(settings); this.reason = ''; this.failures = 0; this.publish();
    if (this.envelope.settings.ducking) this.start(); else this.stop();
  }
  ingest(sample) {
    this.receivedAt = Date.now(); this.envelope.update(sample, this.receivedAt);
    this.reason = sample?.error ? 'Windows не предоставила уровни звука приложений.' : !sample?.available ? 'Нет доступного устройства вывода звука.' : '';
    this.publish();
  }
  start() {
    if (this.closed || this.child || !this.envelope.settings.ducking) return;
    if (this.platform !== 'win32') { this.reason = 'Автоматическое приглушение приложений доступно в Windows.'; this.publish(); return; }
    clearTimeout(this.retry);
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      for (const file of ['audio-sessions.ps1', 'audio-sessions.cs']) {
        const contents = fs.readFileSync(path.join(__dirname, 'windows', file)), target = path.join(this.directory, file);
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(contents)) fs.writeFileSync(target, contents);
      }
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = this.child = this.spawnProcess(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.directory, 'audio-sessions.ps1'), '-ParentId', String(process.pid), '-ExcludeName', this.ownName], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let buffer = ''; this.receivedAt = Date.now();
      child.stdout.setEncoding('utf8'); child.stdout.on('data', data => {
        if (this.child !== child) return;
        buffer += data;
        if (buffer.length > 131072) { buffer = ''; return; }
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary).trim(); buffer = buffer.slice(boundary + 1);
          try { const sample = JSON.parse(line); if (typeof sample?.available === 'boolean') this.ingest(sample); } catch { /* Ignore non-protocol output. */ }
        }
      });
      const exited = () => {
        if (this.child !== child) return;
        this.child = null; clearInterval(this.watchdog); this.envelope.update({ available: false }, Date.now());
        this.reason = 'Не удалось прочитать звук приложений Windows.'; this.publish();
        if (!this.closed && this.envelope.settings.ducking && ++this.failures <= 5) this.retry = setTimeout(() => this.start(), Math.min(30000, 1000 * 2 ** this.failures));
      };
      child.once('error', exited); child.once('exit', exited);
      this.watchdog = setInterval(() => { if (Date.now() - this.receivedAt > 4000) { this.envelope.update({ available: false }); this.reason = 'Ожидаем уровни звука Windows.'; this.publish(); } }, 1000);
      this.watchdog.unref?.();
    } catch { this.reason = 'Не удалось запустить проверку звука Windows.'; this.publish(); }
  }
  stop() {
    clearTimeout(this.retry); clearInterval(this.watchdog);
    const child = this.child; this.child = null; child?.kill();
    this.envelope.update({ available: false }); this.publish();
  }
  dispose() { this.closed = true; this.stop(); }
}
module.exports = { AudioDucker, DuckEnvelope, eligibleSession };
