const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  openLyrics: () => ipcRenderer.invoke('lyrics-open'),
  closeLyrics: () => ipcRenderer.invoke('lyrics-close'),
  updateLyrics: (payload) => ipcRenderer.send('lyrics-update', payload),
  onLyricsClosed: (listener) => { const handler = () => listener(); ipcRenderer.on('lyrics-closed', handler); return () => ipcRenderer.removeListener('lyrics-closed', handler); },
});
