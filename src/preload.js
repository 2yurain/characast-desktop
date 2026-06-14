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
  setupObsScenes: (opts) => ipcRenderer.invoke('obs:setup-scenes', opts),
  reconnectVts: () => ipcRenderer.invoke('connect:vts'),
  reauthVts: () => ipcRenderer.invoke('vts:reauth'),
  testVtsExpression: (emotion) => ipcRenderer.invoke('vts:test-expression', emotion),
  testVtsMouth: () => ipcRenderer.invoke('vts:test-mouth'),
  refreshVtsHotkeys: () => ipcRenderer.invoke('vts:refresh-hotkeys'),
  onVtsHotkeys: (cb) => {
    const handler = (_e, names) => cb(names);
    ipcRenderer.on('vts:hotkeys', handler);
    return () => ipcRenderer.removeListener('vts:hotkeys', handler);
  },
  // TTS 播放振幅 → main → VTS 嘴型(高頻 fire-and-forget)
  ttsAmplitude: (v) => ipcRenderer.send('tts:amplitude', v),
  // 歌聲共鳴 → main → cloud → OBS overlay(高頻 fire-and-forget)
  resonanceData: (v) => ipcRenderer.send('resonance:data', v),
  // AI 感知:跟雲端要 STT/Vision 設定(開關 + 效能等級)
  getPerceptionConfig: () => ipcRenderer.invoke('perception:get'),
  // 本地 whisper 辨識出的主播語音 → main → cloud(只送短文字當脈絡)
  sendStreamerSpeech: (text) => ipcRenderer.send('streamer:speech', text),
  // 歌唱音準:本場累計聚合 → main → cloud(成長報告 B 維度;低頻)
  sendPitchStats: (stats) => ipcRenderer.send('streamer:pitch', stats),
  // Vision:跟 main 要 OBS 目前畫面縮圖(base64);CLIP 看完的短描述 → main → cloud
  getObsScreenshot: (opts) => ipcRenderer.invoke('obs:screenshot', opts),
  sendStreamerVision: (text) => ipcRenderer.send('streamer:vision', text),
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
