const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lyricsSettingsAPI', {
  get: () => ipcRenderer.invoke('lyrics-style-get'),
  set: (style) => ipcRenderer.send('lyrics-style-set', style),
  close: () => ipcRenderer.invoke('lyrics-settings-close'),
  onUpdate: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on('lyrics-style-update', handler); return () => ipcRenderer.removeListener('lyrics-style-update', handler); },
});
