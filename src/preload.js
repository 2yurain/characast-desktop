// =====================================================
// preload.js — Context bridge for renderer → main IPC
// =====================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('characast', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getStatus: () => ipcRenderer.invoke('status:get'),
  getRecentLogs: () => ipcRenderer.invoke('logs:recent'),
  exchangePairCode: (code) => ipcRenderer.invoke('pair:exchange', code),
  revokePair: () => ipcRenderer.invoke('pair:revoke'),
  reconnectCloud: () => ipcRenderer.invoke('connect:cloud'),
  reconnectObs: () => ipcRenderer.invoke('connect:obs'),
  reconnectVts: () => ipcRenderer.invoke('connect:vts'),
  reauthVts: () => ipcRenderer.invoke('vts:reauth'),
  // TTS 播放振幅 → main → VTS 嘴型(高頻 fire-and-forget)
  ttsAmplitude: (v) => ipcRenderer.send('tts:amplitude', v),
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
    ipcRenderer.on('tts', handler);
    return () => ipcRenderer.removeListener('tts', handler);
  },
  // 為了取得 TTS 設定(從 cloud 拉),我們直接讓 main 用 HTTPS 拿
  fetchTtsConfig: () => ipcRenderer.invoke('tts:get-config'),
});
