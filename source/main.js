const { app, globalShortcut, shell, ipcMain, BrowserWindow, Tray, Menu, nativeImage, screen, session} = require('electron')
const path = require('node:path')
if (process.argv.includes('--import-soundcloud-session')) {
  require('./integrations/session-import.cjs').runImportChild(app);
  return;
}
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch'); // required 'fetch'
const { registerLolzteam } = require('./integrations/lolzteam/index.cjs');

// Migrate the saved login and encrypted token once, then use LolzCloud's own profile.
require('./integrations/profile-migration.cjs').configureProfile(app);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let lolzteam;
let finishedQuitting = false;
let quitStarted = false;


let mainWindow;
let tray;
function createWindow () {

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1000,
    minHeight: 650,
    frame: false,
    backgroundColor: '#101613',
    icon: path.join(__dirname, 'app/lib/assets', process.platform === 'linux' ? 'logo.png' : 'icon.ico'),
    webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			webviewTag: true,
			backgroundThrottling: false,
		}
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.on('will-attach-webview', (event, preferences) => {
    // SoundCloud plugins only use DOM APIs. Remote pages never need Node or the token.
    preferences.preload = path.join(__dirname, 'guest-preload.cjs');
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.backgroundThrottling = false;
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.loadFile(path.join(__dirname, 'app/index.html'), {
    query: process.argv.includes('--lolzteam') ? { lolzteam: '1' } : {},
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  mainWindow.on('close', event => {
    if (!finishedQuitting) {
      event.preventDefault();
      app.quit();
    }
  });
  mainWindow.on('query-session-end', () => { void lolzteam?.flushSession(); });
  mainWindow.on('session-end', () => { void lolzteam?.flushSession(); });
  
  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  if (!singleInstance) return;
  if (process.argv.includes('--reuse-login')) {
    try {
      const result = await require('./integrations/session-import.cjs').importFromInstalled(app, session.defaultSession);
      console.log('SoundCloud saved session imported: ' + result.count + ' cookies.');
    } catch (error) { console.log('SoundCloud session import: ' + error.message); }
  }
  lolzteam = registerLolzteam(app, () => mainWindow);
  await lolzteam.ready;
  createWindow()
  if (process.argv.includes('--mini')) void lolzteam.act({ type: 'mini' });

  apppath = __dirname
  console.log(apppath);

  // ON MAIN WINDOW LOAD
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.send("apppath", apppath)
    mainWindow.webContents.send('downloadpath', path.join(app.getPath('downloads'), 'LolzCloud'));
    // adblocker
    ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
      blocker.enableBlockingInSession(session.defaultSession);
    }).catch(() => console.log('Ad blocker unavailable while offline.'));
  });
  
  try {
  var trayicon = nativeImage.createFromPath(path.join(__dirname, 'app/lib/assets', process.platform === 'linux' ? 'logo.png' : 'icon.ico'))
  tray = new Tray(trayicon)
  tray.setTitle('LolzCloud')
  tray.setToolTip('LolzCloud')

  tray.on('click', event => {
    console.log('tray left clicked')
    event.preventDefault
    mainWindow.show()
  })

  var trayCtxMenu = Menu.buildFromTemplate([
    { label: 'Мини-плеер', type: 'normal', click: () => { void lolzteam.act({ type: 'mini' }); } },
    { label: 'Play/Pause', type: 'normal', click: () => mainWindow.webContents.send("appReqMediaPlayPause") },
    { label: 'Skip', type: 'normal', click: () => mainWindow.webContents.send("appReqMediaNextTrack") },
    { label: 'Exit', type: 'normal', click: () => app.quit() },
  ])
  tray.setContextMenu(trayCtxMenu)
  } catch { console.log('System tray unavailable in this desktop session.'); }

  app.on('second-instance', (event, argv) => {
    if (argv.includes('--quit')) { app.quit(); return; }
    if (argv.includes('--mini')) { void lolzteam.act({ type: 'mini' }); return; }
    const track = argv.find(value => value.startsWith('--play-track='));
    if (track) { lolzteam.act({ type: 'play-url', url: track.slice('--play-track='.length) }).catch(() => {}); return; }
    if (argv.includes('--broadcast-on')) { lolzteam.configure({ enabled: true }).catch(() => {}); return; }
    if (argv.includes('--pause')) { lolzteam.act({ type: 'media', command: 'pause' }).catch(() => {}); return; }
    if (argv.includes('--play')) { lolzteam.act({ type: 'media', command: 'play' }).catch(() => {}); return; }
    if (argv.includes('--studio')) { mainWindow.show(); mainWindow.webContents.send('lolzcloud:studio'); return; }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (argv.includes('--lolzteam')) mainWindow.webContents.send('lolzteam:open');
  });

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', event => {
  if (finishedQuitting || !lolzteam) return;
  event.preventDefault();
  if (quitStarted) return;
  quitStarted = true;
  lolzteam.shutdown().catch(() => {}).finally(() => {
    finishedQuitting = true;
    app.quit();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('browser-window-focus', function () {
	console.log("window focused")
  globalShortcut.register("CommandOrControl+R", () => {
		mainWindow.webContents.send("appReqCtrlR")
		console.log("CtrlR is pressed");
	});
  globalShortcut.register("F5", () => {
		mainWindow.webContents.send("appReqF5")
		console.log("F5 is pressed");
	});
  globalShortcut.register("Esc", () => {
		mainWindow.webContents.send("appReqEsc")
		console.log("Esc is pressed");
	});
  globalShortcut.register("MediaPlayPause", () => {
		mainWindow.webContents.send("appReqMediaPlayPause")
		console.log("MediaPlayPause is pressed");
	});
	globalShortcut.register("MediaNextTrack", () => {
		mainWindow.webContents.send("appReqMediaNextTrack")
		console.log("MediaNextTrack is pressed");
	});
	globalShortcut.register("MediaPreviousTrack", () => {
		mainWindow.webContents.send("appReqMediaPreviousTrack")
		console.log("MediaPreviousTrack is pressed");
	});
});

app.on('browser-window-blur', function () {
	console.log("window blurred")
	globalShortcut.unregister('CommandOrControl+R');
	globalShortcut.unregister('F5');
	globalShortcut.unregister('Esc');
});


// TODO: Fix icon states in renderer when switching
ipcMain.on("appReqMaximizeApp",() => {
  if (mainWindow.isFullScreen()) {
		mainWindow.setFullScreen(false)
    mainWindow.webContents.send("fixviewicons", "1icon")
	} else {
		mainWindow.setFullScreen(true)
    mainWindow.webContents.send("fixviewicons", "3icon")
	}
})
ipcMain.on("appReqFullscreenApp",() => {
	mainWindow.setFullScreen(true)
})
ipcMain.on("appReqMinimizeApp",() => {
  mainWindow.minimize();
});
ipcMain.on('appReqToggleWindowMaximize', event => {
  if (event.sender !== mainWindow?.webContents) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.on("appReqCloseApp",() => {
  app.quit();
});
ipcMain.on("appReqReloadApp",() => {
  app.relaunch();
  app.quit();
});
