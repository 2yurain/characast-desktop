// =====================================================
// preload.js — Context bridge for renderer → main IPC
// =====================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('characast', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getStatus: () => ipcRenderer.invoke('status:get'),
  getRecentLogs: () => ipcRenderer.invoke('logs:recent'),
  exchangePairCode: (code) => ipcRenderer.invoke('pair:exchange', code),
  revokePair: () => ipcRenderer.invoke('pair:revoke'),
  reconnectCloud: () => ipcRenderer.invoke('connect:cloud'),
  reconnectObs: () => ipcRenderer.invoke('connect:obs'),
  onLog: (cb) => {
    const handler = (_e, entry) => cb(entry);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('status', handler);
    return () => ipcRenderer.removeListener('status', handler);
  },
  onTts: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('tts.say', handler);
    return () => ipcRenderer.removeListener('tts.say', handler);
  },
  // 為了取得 TTS 設定(從 cloud 拉),我們直接讓 main 用 HTTPS 拿
  fetchTtsConfig: () => ipcRenderer.invoke('tts:get-config'),
});
