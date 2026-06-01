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
  },
});

module.exports = {
  get: (key) => store.get(key),
  set: (key, val) => store.set(key, val),
  delete: (key) => store.delete(key),
  all: () => store.store,
};
