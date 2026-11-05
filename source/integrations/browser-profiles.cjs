'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const label = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120) : '';
function discoverBrowsers({ local = process.env.LOCALAPPDATA, roaming = process.env.APPDATA, programs = process.env.ProgramFiles, programsX86 = process.env['ProgramFiles(x86)'], platform = process.platform } = {}) {
  if (platform !== 'win32' || !local || !roaming) return [];
  const join = (base, ...parts) => base ? path.join(base, ...parts) : '';
  const definitions = [
    ['chrome', 'Google Chrome', ['Google', 'Chrome', 'Application', 'chrome.exe'], join(local, 'Google', 'Chrome', 'User Data')],
    ['edge', 'Microsoft Edge', ['Microsoft', 'Edge', 'Application', 'msedge.exe'], join(local, 'Microsoft', 'Edge', 'User Data')],
    ['brave', 'Brave', ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
    ['yandex', 'Яндекс Браузер', ['Yandex', 'YandexBrowser', 'Application', 'browser.exe'], join(local, 'Yandex', 'YandexBrowser', 'User Data')],
    ['vivaldi', 'Vivaldi', ['Vivaldi', 'Application', 'vivaldi.exe'], join(local, 'Vivaldi', 'User Data')],
  ];
  const rows = [];
  function add(family, name, executable, profile, args, detail = '') {
    if (!executable || !fs.existsSync(executable)) return;
    const id = crypto.createHash('sha256').update(family + '\n' + executable + '\n' + profile).digest('hex').slice(0, 24);
    rows.push({ id, family, name, detail: label(detail), executable: path.resolve(executable), args });
  }
  for (const [family, name, parts, directory] of definitions) {
    const executable = [programs, programsX86, local].map(base => join(base, ...parts)).find(file => file && fs.existsSync(file));
    if (!executable) continue;
    let profiles = [];
    // Profile names are public browser metadata. Cookie/password databases and
    // OS/browser encryption keys are never used to transfer a session here.
    try {
      const file = path.join(directory, 'Local State');
      if (fs.statSync(file).size <= 8 * 1024 * 1024) profiles = Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).profile?.info_cache || {}).filter(([key]) => /^(?:Default|Profile \d+)$/.test(key)).slice(0, 30);
    } catch { /* A first browser profile may not have metadata yet. */ }
    if (!profiles.length) profiles = [['Default', { name: 'Основной профиль' }]];
    for (const [profile, value] of profiles) add(family, name, executable, profile, ['--profile-directory=' + profile], [label(value.name) || profile, label(value.user_name)].filter(Boolean).join(' · '));
  }
  for (const [family, name, folder] of [['opera', 'Opera', 'Opera'], ['opera-gx', 'Opera GX', 'Opera GX']]) {
    const executable = [join(local, 'Programs', folder, 'launcher.exe'), join(programs, folder, 'launcher.exe'), join(programsX86, folder, 'launcher.exe')].find(file => file && fs.existsSync(file));
    add(family, name, executable, 'default', [], 'Открытый профиль браузера');
  }
  const firefox = [programs, programsX86].map(base => join(base, 'Mozilla Firefox', 'firefox.exe')).find(file => file && fs.existsSync(file));
  if (firefox) {
    let names = [];
    try {
      const file = join(roaming, 'Mozilla', 'Firefox', 'profiles.ini');
      if (fs.statSync(file).size < 65536) names = [...fs.readFileSync(file, 'utf8').matchAll(/^Name=([^\r\n]+)$/gm)].map(match => label(match[1])).filter(Boolean).slice(0, 30);
    } catch { /* A first Firefox profile may not have metadata yet. */ }
    if (!names.length) names = [''];
    for (const profile of names) add('firefox', 'Firefox', firefox, profile, profile ? ['-P', profile, '-new-tab'] : ['-new-tab'], profile || 'Открытый профиль браузера');
  }
  return rows;
}
class BrowserProfiles {
  constructor({ discover = discoverBrowsers, launch = spawn } = {}) { this.discover = discover; this.launch = launch; this.rows = []; }
  list(refresh = false) { if (refresh || !this.rows.length) this.rows = this.discover(); return this.rows.map(({ id, family, name, detail }) => ({ id, family, name, detail })); }
  async open(id, url) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/transfer\/[a-f0-9]{48}\/$/.test(url)) throw Error('Неверная страница переноса.');
    const row = this.rows.find(item => item.id === id);
    if (!row) throw Error('Браузер или профиль уже недоступен. Обнови список.');
    await new Promise((resolve, reject) => { const child = this.launch(row.executable, [...row.args, url], { windowsHide: true, detached: true, stdio: 'ignore' }); child.once('error', () => reject(Error('Не удалось открыть выбранный браузер.'))); child.once('spawn', () => { child.unref(); resolve(); }); });
  }
}
module.exports = { BrowserProfiles, discoverBrowsers };
