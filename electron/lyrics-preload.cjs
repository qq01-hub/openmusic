const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lyricsAPI', {
  onUpdate: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on('lyrics-update', handler); return () => ipcRenderer.removeListener('lyrics-update', handler); },
  onStyleUpdate: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on('lyrics-style-update', handler); return () => ipcRenderer.removeListener('lyrics-style-update', handler); },
  onLockUpdate: (listener) => { const handler = (_event, locked) => listener(locked); ipcRenderer.on('lyrics-lock-update', handler); return () => ipcRenderer.removeListener('lyrics-lock-update', handler); },
  startDrag: () => ipcRenderer.send('lyrics-drag-start'),
  moveDrag: () => ipcRenderer.send('lyrics-drag-move'),
  endDrag: () => ipcRenderer.send('lyrics-drag-end'),
  toggleLock: () => ipcRenderer.invoke('lyrics-lock-toggle'),
  openSettings: () => ipcRenderer.invoke('lyrics-settings-open'),
  close: () => ipcRenderer.invoke('lyrics-close'),
});
