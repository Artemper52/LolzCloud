'use strict';
const { app, BrowserWindow, session } = require('electron'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const temporary = process.env.LOLZCLOUD_PWA_TEST_PROFILE, output = process.env.LOLZCLOUD_PWA_TEST_OUTPUT, root = path.join(__dirname, '../website');
if (!temporary || !path.basename(temporary).startsWith('LolzCloud-pwa-ui-') || !output) throw new Error('An isolated profile and output are required.');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', temporary); app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let server, window, failure = ''; const checks = [], screenshots = [], errors = [];
  const check = (value, label) => { assert.ok(value, label); checks.push(label); };
  const js = async code => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(error.message + '\nExpression: ' + code); } };
  async function capture(name) { await delay(150); const filename = path.join(output, name + '.png'); fs.writeFileSync(filename, (await window.webContents.capturePage()).toPNG()); screenshots.push(filename); }
  try {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    server = http.createServer((req, res) => { const url = new URL(req.url, 'http://localhost'), file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname)); if (!file.startsWith(path.resolve(root) + path.sep) || !types[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'Content-Type': types[path.extname(file)] }); fs.createReadStream(file).pipe(res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port, ses = session.fromPartition('website-isolated');
    window = new BrowserWindow({ show: false, width: 390, height: 844, useContentSize: true, webPreferences: { session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true, offscreen: true } });
    window.webContents.on('console-message', (_event, ...args) => { const message = typeof args[0] === 'object' ? args[0].message : args[1]; if (/Uncaught|TypeError|SyntaxError/.test(message || '')) errors.push(message); });
    await window.loadURL(origin + '/'); await js('document.fonts.ready');
    for (const width of [390, 360, 1440]) {
      window.setContentSize(width, width === 1440 ? 1000 : 844); await js('window.scrollTo({top:0,behavior:"instant"})'); await capture('website-home-' + width);
      check(await js('document.documentElement.scrollWidth<=innerWidth'), 'Homepage has no horizontal overflow at ' + width + 'px');
      await js('document.getElementById("download").scrollIntoView({behavior:"instant",block:"start"})'); await capture('website-downloads-' + width);
      check(await js('[...document.querySelectorAll(".download-option .button")].every(link=>{const r=link.getBoundingClientRect();return r.width>100&&r.height>=44&&r.left>=0&&r.right<=innerWidth})'), 'All platform download actions remain readable and fit at ' + width + 'px');
    }
    check(await js('[...document.querySelectorAll("[data-platform-card]")].map(card=>card.dataset.platformCard).sort().join(",")==="android,ios,linux,windows"'), 'Four real platform choices are present');
    check(await js('document.querySelector("[data-ios]").href==="https://lolzcloud.com/app/"&&document.querySelector("[data-platform-card=ios]").textContent.includes("ВЕБ-ПРИЛОЖЕНИЕ")'), 'iOS links to the installable web app and labels it explicitly');
    check(await js('[...document.querySelectorAll("[data-download],[data-portable],[data-linux-x64],[data-linux-arm64],[data-linux-x64-tar],[data-legacy],[data-legacy-portable],[data-source-archive]")].every(link=>link.href.includes("/downloads/LolzCloud-0.9.15-"))'), 'Desktop, Linux, Legacy and source links consistently target version 0.9.15');
    check(await js('document.querySelector("[data-android]").href.endsWith("/LolzCloud-Android-0.1.5.apk")'), 'Android download targets the declared 0.1.5 APK');
    await js('document.querySelector("[data-demo=lyrics]").click()'); await delay(200); check(await js('document.getElementById("tab-lyrics").getAttribute("aria-selected")==="true"&&document.getElementById("demo-image").src.endsWith("/assets/lyrics.png")'), 'Screenshot tabs switch the actual image and accessible selected state');
    await js('document.getElementById("demo-zoom").click()'); check(await js('document.getElementById("lightbox").open'), 'Screenshot opens in a working lightbox'); await js('document.getElementById("lightbox").close()');
    await window.loadURL(origin + '/install.html');
    for (const width of [390, 360, 1440]) { window.setContentSize(width, width === 1440 ? 1000 : 844); await js('document.getElementById("ios").scrollIntoView({behavior:"instant",block:"start"})'); await capture('website-install-ios-' + width); check(await js('document.documentElement.scrollWidth<=innerWidth'), 'Install article and iOS instructions fit at ' + width + 'px'); }
    check(await js('(()=>{const section=document.getElementById("ios-native"),text=section.textContent,links=[...section.querySelectorAll("a")].map(link=>link.getAttribute("href"));return ["/downloads/LolzCloud-iOS-0.1.1-unsigned.ipa","/downloads/LolzCloud-iOS-0.1.1-simulator.zip","/downloads/LolzCloud-iOS-0.1.1-source.zip"].every(href=>links.includes(href))&&text.includes("Сборка в Xcode прошла")&&text.includes("нельзя установить на iPhone или iPad напрямую")&&text.includes("нужна своя подпись Apple")&&text.includes("Проверка на физическом устройстве пока не проводилась")&&!!(document.getElementById("ios").compareDocumentPosition(section)&Node.DOCUMENT_POSITION_FOLLOWING)})()'), 'Native iOS links expose compiled unsigned IPA, simulator and source while keeping the PWA first and requiring personal Apple signing');
    check(await js('[...document.querySelectorAll(".article-nav a")].every(link=>!!document.querySelector(link.hash))'), 'All installation table-of-contents links resolve to real sections');
    window.webContents.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'); window.setContentSize(390, 844); await window.loadURL(origin + '/'); await js('document.getElementById("download").scrollIntoView({behavior:"instant",block:"start"})'); await capture('website-ios-downloads-390');
    check(await js('(()=>{const chosen=document.querySelector(".download-option.recommended");return chosen.dataset.platformCard==="ios"&&[...document.querySelectorAll(".download-option")].every(card=>card.getBoundingClientRect().top>=chosen.getBoundingClientRect().top)})()'), 'iPhone visitors see their installable platform first in the download choices');
    check(await js('document.querySelector(".platforms-grid").firstElementChild.dataset.platformCard==="ios"&&document.querySelector(".platforms-grid a").hasAttribute("data-ios")'), 'Recommended visual order matches DOM, screen-reader and keyboard link order');
    check(errors.length === 0, 'Website scenarios have no uncaught JavaScript errors');
    console.log(JSON.stringify({ ok: true, count: checks.length, checks, screenshots }, null, 2));
  } catch (error) { failure = error.stack || String(error); console.error(failure); if (window) try { await capture('website-failure'); } catch {} }
  finally { fs.writeFileSync(path.join(output, 'website-ui-results.json'), JSON.stringify({ ok: !failure, count: checks.length, checks, screenshots, errors, failure, limitation: 'Local rendering and link target verification only; publication availability and release signatures are verified by the release coordinator.' }, null, 2)); if (window && !window.isDestroyed()) window.destroy(); if (server) { server.closeAllConnections(); server.close(); } app.exit(failure ? 1 : 0); }
}).catch(error => { console.error(error); app.exit(1); });
