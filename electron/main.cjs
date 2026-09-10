const { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { TRAY_LYRICS_BOUNDS, lockLyricsBounds, shouldHideToTray } = require('./windowBehavior.cjs');
const { DEFAULT_LYRICS_STYLE, normalizeLyricsStyle } = require('./lyrics-style.cjs');
const { readLyricsPreferences, writeLyricsPreferences } = require('./lyrics-preferences.cjs');

function readPackagedAppUrl() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'desktop-runtime-config.json'), 'utf8'));
    const url = new URL(String(raw?.appUrl || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

const appUrl = process.env.OPENMUSIC_URL
  || (app.isPackaged ? readPackagedAppUrl() || 'http://localhost:4000' : 'http://localhost:5173');
const appIcon = path.join(__dirname, 'openmusic.ico');
Menu.setApplicationMenu(null);
let mainWindow;
let tray;
let isQuitting = false;
let lyricsWindow;
let lyricsSettingsWindow;
let lyricsStyle = { ...DEFAULT_LYRICS_STYLE };
let lyricsLocked = false;
let lyricsPosition = null;
let lyricsPreferencesPath = '';
let lyricsDragOffset = null;
let lastLyrics = { title: 'OpenMusic', artist: '', source: '', pic: '', activeText: '暂无歌词', translation: '', nextText: '' };

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 920, minWidth: 1080, minHeight: 700,
    backgroundColor: '#09090b', icon: appIcon, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => { if (shouldHideToTray(isQuitting)) { event.preventDefault(); mainWindow.hide(); } });
  void mainWindow.loadURL(appUrl);
}

function saveLyricsPreferences() {
  if (!lyricsPreferencesPath) return;
  writeLyricsPreferences(lyricsPreferencesPath, { locked: lyricsLocked, position: lyricsPosition, style: lyricsStyle });
}

function setLyricsLocked(locked) {
  lyricsLocked = Boolean(locked);
  lyricsWindow?.setMovable(!lyricsLocked);
  lyricsWindow?.webContents.send('lyrics-lock-update', lyricsLocked);
  saveLyricsPreferences();
}

function lyricsWorkArea() {
  const point = lyricsWindow?.getBounds() ?? screen.getCursorScreenPoint();
  return screen.getDisplayMatching(typeof point.x === 'number' ? point : { x: point.x, y: point.y, width: 1, height: 1 }).workArea;
}

function positionLyricsWindow() {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  const workArea = lyricsWorkArea();
  const [width, height] = lyricsWindow.getSize();
  if (lyricsPosition) {
    lyricsWindow.setPosition(lyricsPosition.x, lyricsPosition.y);
    constrainLyricsWindow();
    return;
  }
  lyricsWindow.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.max(workArea.y, workArea.y + workArea.height - height - 6),
  );
}

function constrainLyricsWindow() {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  const bounds = lyricsWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const maxX = workArea.x + workArea.width - bounds.width;
  const maxY = workArea.y + workArea.height - bounds.height;
  const x = Math.min(Math.max(bounds.x, workArea.x), maxX);
  const y = Math.min(Math.max(bounds.y, workArea.y), maxY);
  if (x !== bounds.x || y !== bounds.y) lyricsWindow.setPosition(x, y);
}

function showLyricsSettings() {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (lyricsSettingsWindow && !lyricsSettingsWindow.isDestroyed()) { lyricsSettingsWindow.show(); lyricsSettingsWindow.focus(); return; }
  const parentBounds = lyricsWindow.getBounds();
  const width = 266;
  const height = 258;
  const workArea = screen.getDisplayMatching(parentBounds).workArea;
  const x = Math.min(Math.max(parentBounds.x + parentBounds.width - width, workArea.x), workArea.x + workArea.width - width);
  const y = Math.max(workArea.y, parentBounds.y - height - 8);
  lyricsSettingsWindow = new BrowserWindow({
    width, height, x, y, parent: lyricsWindow, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#151515', show: false,
    webPreferences: { preload: path.join(__dirname, 'lyrics-settings-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  lyricsSettingsWindow.once('ready-to-show', () => lyricsSettingsWindow?.show());
  lyricsSettingsWindow.on('closed', () => { lyricsSettingsWindow = undefined; });
  void lyricsSettingsWindow.loadFile(path.join(__dirname, 'lyrics-settings.html'));
}

function openLyricsContextMenu() {
  const menu = Menu.buildFromTemplate([
    { label: lyricsLocked ? '解锁歌词位置' : '锁定歌词位置', click: () => setLyricsLocked(!lyricsLocked) },
    { label: '歌词样式…', click: showLyricsSettings },
    { type: 'separator' },
    { label: '关闭桌面歌词', click: () => lyricsWindow?.close() },
  ]);
  menu.popup({ window: lyricsWindow });
}

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) { lyricsWindow.showInactive(); return; }
  lyricsWindow = new BrowserWindow({
    width: TRAY_LYRICS_BOUNDS.width, height: TRAY_LYRICS_BOUNDS.height,
    minWidth: TRAY_LYRICS_BOUNDS.width, minHeight: TRAY_LYRICS_BOUNDS.height,
    maxWidth: TRAY_LYRICS_BOUNDS.width, maxHeight: TRAY_LYRICS_BOUNDS.height,
    frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, focusable: false,
    resizable: false, skipTaskbar: true, hasShadow: false, icon: appIcon, title: 'OpenMusic 桌面歌词',
    webPreferences: { preload: path.join(__dirname, 'lyrics-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  lyricsWindow.setAlwaysOnTop(true, 'floating');
  lyricsWindow.setMovable(!lyricsLocked);
  lyricsWindow.on('closed', () => {
    lyricsDragOffset = null;
    lyricsWindow = undefined;
    if (lyricsSettingsWindow && !lyricsSettingsWindow.isDestroyed()) lyricsSettingsWindow.close();
    mainWindow?.webContents.send('lyrics-closed');
  });
  lyricsWindow.on('will-resize', (event) => { event.preventDefault(); });
  lyricsWindow.on('resize', () => {
    const bounds = lyricsWindow?.getBounds();
    if (!bounds || (bounds.width === TRAY_LYRICS_BOUNDS.width && bounds.height === TRAY_LYRICS_BOUNDS.height)) return;
    lyricsWindow.setBounds(lockLyricsBounds(bounds));
  });
  lyricsWindow.on('move', () => {
    constrainLyricsWindow();
    const bounds = lyricsWindow?.getBounds();
    if (!bounds) return;
    lyricsPosition = { x: bounds.x, y: bounds.y };
    saveLyricsPreferences();
  });
  lyricsWindow.webContents.on('context-menu', openLyricsContextMenu);
  positionLyricsWindow();
  lyricsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void lyricsWindow.loadFile(path.join(__dirname, 'lyrics.html')).then(() => {
    lyricsWindow?.webContents.send('lyrics-update', lastLyrics);
    lyricsWindow?.webContents.send('lyrics-style-update', lyricsStyle);
    lyricsWindow?.webContents.send('lyrics-lock-update', lyricsLocked);
  });
}

function sanitizeLyrics(value) {
  const text = (input, max) => typeof input === 'string' ? input.slice(0, max) : '';
  let pic = text(value?.pic, 2048);
  if (pic) {
    try { pic = new URL(pic, appUrl).protocol.match(/^https?:$/) ? new URL(pic, appUrl).href : ''; } catch { pic = ''; }
  }
  return { title: text(value?.title, 160), artist: text(value?.artist, 160), source: text(value?.source, 32), pic, activeText: text(value?.activeText, 500) || '暂无歌词', translation: text(value?.translation, 500), nextText: text(value?.nextText, 500) };
}

function broadcastLyricsStyle() {
  lyricsWindow?.webContents.send('lyrics-style-update', lyricsStyle);
  lyricsSettingsWindow?.webContents.send('lyrics-style-update', lyricsStyle);
}

ipcMain.handle('lyrics-open', createLyricsWindow);
ipcMain.handle('lyrics-close', () => { if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.close(); });
ipcMain.handle('lyrics-settings-open', () => { showLyricsSettings(); });
ipcMain.handle('lyrics-settings-close', () => { if (lyricsSettingsWindow && !lyricsSettingsWindow.isDestroyed()) lyricsSettingsWindow.close(); });
ipcMain.handle('lyrics-lock-toggle', (event) => {
  if (event.sender !== lyricsWindow?.webContents) return lyricsLocked;
  setLyricsLocked(!lyricsLocked);
  return lyricsLocked;
});
ipcMain.on('lyrics-drag-start', (event) => {
  if (lyricsLocked || event.sender !== lyricsWindow?.webContents) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = lyricsWindow.getBounds();
  lyricsDragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
});
ipcMain.on('lyrics-drag-move', (event) => {
  if (!lyricsDragOffset || lyricsLocked || event.sender !== lyricsWindow?.webContents) return;
  const cursor = screen.getCursorScreenPoint();
  lyricsWindow.setPosition(cursor.x - lyricsDragOffset.x, cursor.y - lyricsDragOffset.y);
  constrainLyricsWindow();
});
ipcMain.on('lyrics-drag-end', (event) => { if (event.sender === lyricsWindow?.webContents) lyricsDragOffset = null; });
ipcMain.on('lyrics-update', (_event, value) => { lastLyrics = sanitizeLyrics(value); lyricsWindow?.webContents.send('lyrics-update', lastLyrics); });
ipcMain.handle('lyrics-style-get', () => lyricsStyle);
ipcMain.on('lyrics-style-set', (_event, value) => { lyricsStyle = normalizeLyricsStyle({ ...lyricsStyle, ...value }); broadcastLyricsStyle(); saveLyricsPreferences(); });

ipcMain.handle('app-show-main', () => { mainWindow?.show(); mainWindow?.focus(); });
ipcMain.handle('app-quit', () => { isQuitting = true; app.quit(); });

function createTray() {
  tray = new Tray(appIcon);
  tray.setToolTip('OpenMusic');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 OpenMusic', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '打开桌面歌词', click: createLyricsWindow },
    { type: 'separator' },
    { label: '退出 OpenMusic', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

app.whenReady().then(() => {
  lyricsPreferencesPath = path.join(app.getPath('userData'), 'lyrics-preferences.json');
  const preferences = readLyricsPreferences(lyricsPreferencesPath);
  lyricsStyle = preferences.style;
  lyricsLocked = preferences.locked;
  lyricsPosition = preferences.position;
  createMainWindow(); createTray();
  screen.on('display-metrics-changed', () => constrainLyricsWindow());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); else mainWindow?.show(); });
});
app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
