// =====================================================
// settings.js — electron-store wrapper(主播裝置端設定)
// =====================================================
// 存:
//   cloudUrl              CharaCast cloud WS URL(預設 prod)
//   desktopToken          配對後拿到的 long-lived token
//   obs.host / port / pwd OBS WebSocket 連線設定
// =====================================================

const Store = require('electron-store');

const store = new Store({
  defaults: {
    cloudUrl: 'wss://characast.co/api/v1/desktop/ws',
    cloudHttpsUrl: 'https://characast.co',
    desktopToken: null,
    obs: {
      host: 'localhost',
      port: 4455,
      password: '',
    },
    // VTube Studio(AI 角色立繪:情緒表情 + TTS 嘴型）
    vts: {
      enabled: false,
      host: 'localhost',
      port: 8001,
      token: '',            // VTS 授權 token(首次授權後存)
      // 情緒 → VTS hotkey 名稱(主播在 VTS 設好表情快捷鍵,把名稱填這)
      emotions: { happy: '', sad: '', surprised: '', teasing: '', neutral: '' },
    },
  },
});

module.exports = {
  get: (key) => store.get(key),
  set: (key, val) => store.set(key, val),
  delete: (key) => store.delete(key),
  all: () => store.store,
};
