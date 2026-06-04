// =====================================================
// main.js — Electron main process
// =====================================================
// 啟動視窗,管理 OBS + Cloud 兩條 WebSocket,IPC 跟 renderer 溝通。
// =====================================================

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const settings = require('./lib/settings');
const { CloudClient } = require('./lib/cloudClient');
const { ObsClient } = require('./lib/obsClient');
const { VtsClient } = require('./lib/vtsClient');
const { Relay } = require('./lib/relay');
const { autoUpdater } = require('electron-updater');

// 全域單例
const cloud = new CloudClient();
const obs = new ObsClient();
const vts = new VtsClient();
let relay = null;
let mainWindow = null;

// log buffer(renderer 連上後一次給最近 200 條)
const LOG_BUFFER_MAX = 200;
const logBuffer = [];
function pushLog(entry) {
  const e = { ts: new Date().toISOString(), ...entry };
  logBuffer.push(e);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', e);
  }
  // 也印到主程序 stdout
  const tag = `[${e.level}]`;
  console.log(`${tag} ${e.msg}`);
}

// ======= 視窗 =======
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 480,
    minHeight: 480,
    title: 'CharaCast Desktop',
    backgroundColor: '#0f0c14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,        // renderer 跑在 OS sandbox(preload 只用 contextBridge/ipcRenderer,相容)
    },
    autoHideMenuBar: true,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ======= IPC handlers =======
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('settings:get', () => settings.all());

// renderer 只允許改這些 key(白名單,擋掉亂塞鍵 / 原型污染)
const SETTABLE_KEYS = new Set(['cloudUrl', 'cloudHttpsUrl', 'obs', 'vts', 'resonance']);

ipcMain.handle('settings:set', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    for (const [k, v] of Object.entries(patch)) {
      if (!SETTABLE_KEYS.has(k)) {
        pushLog({ level: 'warn', msg: `忽略不允許的設定鍵:${k}` });
        continue;
      }
      // Cloud URL 一律驗證(必須 wss/https + 屬於 characast.co/本機),擋掉把 token 導去攻擊者
      if (k === 'cloudUrl' || k === 'cloudHttpsUrl') {
        const chk = settings.validateCloudUrl(v, { kind: k === 'cloudHttpsUrl' ? 'https' : 'ws' });
        if (!chk.ok) {
          pushLog({ level: 'err', msg: `拒絕設定 ${k}:${chk.error}` });
          continue;
        }
        settings.set(k, chk.value);
        continue;
      }
      settings.set(k, v);
    }
  }
  return settings.all();
});

ipcMain.handle('status:get', () => ({
  cloud: cloud.getStatus(),
  obs: obs.getStatus(),
  vts: vts.getStatus(),
  hasToken: Boolean(settings.get('desktopToken')),
}));

ipcMain.handle('connect:vts', () => { reconnectVts(); return { ok: true }; });
// VTS 重新授權:清掉 token 再連(會重新跳 VTS 允許視窗)
ipcMain.handle('vts:reauth', () => {
  const cfg = settings.get('vts') || {};
  settings.set('vts', { ...cfg, token: '' });
  reconnectVts();
  return { ok: true };
});
// renderer 播 TTS 時送來的振幅 → 注入 VTS 嘴型(高頻,用 .on 不用 .handle)
ipcMain.on('tts:amplitude', (_e, v) => { vts.setMouth(v); });
// renderer 抓麥算出的歌聲共鳴 → 轉給 cloud(再由 cloud 轉發給 OBS overlay)
// 高頻 fire-and-forget;cloud 沒連上就直接丟棄(不排隊、不重送)
ipcMain.on('resonance:data', (_e, d) => {
  if (!d || !cloud.isConnected()) return;
  cloud.send({ type: 'resonance', energy: Number(d.energy) || 0, freq: Number(d.freq) || 0, centroid: Number(d.centroid) || 0 });
});
// 本機測試:直接觸發某情緒對應的表情 hotkey
ipcMain.handle('vts:test-expression', (_e, emotion) => {
  const map = (settings.get('vts') || {}).emotions || {};
  const hotkey = map[emotion] || map.neutral;
  if (hotkey) vts.triggerExpression(hotkey);
  return { ok: Boolean(hotkey), hotkey: hotkey || null };
});
// 本機測試:跑一段假嘴型(0→1→0 波動 1.5 秒)看 VTS 嘴巴有沒有動
ipcMain.handle('vts:refresh-hotkeys', () => { vts.refreshHotkeys(); return { ok: true }; });
ipcMain.handle('vts:test-mouth', () => {
  let t = 0;
  const iv = setInterval(() => {
    t += 0.1;
    vts.setMouth(Math.abs(Math.sin(t * 6)) * 0.9);
    if (t >= 1.5) { clearInterval(iv); vts.setMouth(0); }
  }, 60);
  return { ok: true };
});

ipcMain.handle('logs:recent', () => logBuffer.slice(-100));

ipcMain.handle('pair:exchange', async (_e, code) => {
  // call CharaCast HTTPS endpoint to exchange 6-char code for desktop_token
  const httpsUrl = settings.get('cloudHttpsUrl');
  // 用前再驗一次(防 store 檔被直接竄改把 token 導去攻擊者)
  const chk = settings.validateCloudUrl(httpsUrl, { kind: 'https' });
  if (!chk.ok) {
    pushLog({ level: 'err', msg: `配對中止:cloud 位址不合法(${chk.error})` });
    return { ok: false, error: 'cloud 位址不合法' };
  }
  const url = `${httpsUrl.replace(/\/$/, '')}/api/v1/desktop/exchange-code`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(code || '').trim().toUpperCase() }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    settings.set('desktopToken', j.desktopToken);
    pushLog({ level: 'info', msg: `配對成功:tenantId=${j.tenantId?.slice(0,8)}…` });
    // 立即連線
    reconnectCloud();
    return { ok: true, tenantId: j.tenantId, email: j.email };
  } catch (e) {
    pushLog({ level: 'err', msg: `配對失敗:${e.message}` });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pair:revoke', () => {
  settings.delete('desktopToken');
  cloud.disconnect();
  pushLog({ level: 'warn', msg: '本機配對已撤銷' });
  return { ok: true };
});

ipcMain.handle('connect:cloud', () => { reconnectCloud(); return { ok: true }; });
ipcMain.handle('connect:obs', () => { reconnectObs(); return { ok: true }; });

function reconnectVts() {
  const cfg = settings.get('vts') || {};
  vts.disconnect();
  vts.connect({ enabled: cfg.enabled, host: cfg.host, port: cfg.port, token: cfg.token });
}

// ======= reconnect wrappers =======
function reconnectCloud() {
  const token = settings.get('desktopToken');
  const url = settings.get('cloudUrl');
  cloud.disconnect();
  if (!token) {
    pushLog({ level: 'warn', msg: '尚未配對,跳過 cloud 連線' });
    return;
  }
  // 連線會帶上 desktopToken,用前再驗一次位址(防 store 被竄改導向)
  const chk = settings.validateCloudUrl(url, { kind: 'ws' });
  if (!chk.ok) {
    pushLog({ level: 'err', msg: `cloud 位址不合法(${chk.error}),已停止連線以保護 token` });
    return;
  }
  cloud.connect({ url: chk.value, desktopToken: token });
}

function reconnectObs() {
  const cfg = settings.get('obs') || {};
  obs.disconnect();
  obs.connect({ host: cfg.host, port: cfg.port, password: cfg.password });
}

// ======= 啟動 =======
app.whenReady().then(() => {
  // 舊網域 onrender → characast.co(網域收斂;舊裝置存著 onrender 會被位址驗證鎖死)
  try {
    const n = settings.migrateCloudUrls();
    if (n) pushLog({ level: 'info', msg: `cloud 位址已從舊網域 onrender 自動更新為 characast.co(${n} 項)` });
  } catch (e) { pushLog({ level: 'warn', msg: `cloud 位址遷移略過:${e?.message || e}` }); }

  // 把舊版明文機密(token / OBS 密碼 / VTS token)就地升級成 OS 加密儲存
  try { settings.migrateSecrets(); } catch (e) { pushLog({ level: 'warn', msg: `機密加密升級略過:${e?.message || e}` }); }

  // 權限白名單:只允許「麥克風」(歌聲共鳴需要),其餘(相機 / 定位 / 通知…)一律拒絕。
  // renderer 跑在 sandbox,getUserMedia 仍要 main 這關放行。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  // 接 log → buffer + 廣播 renderer
  cloud.on('log', pushLog);
  obs.on('log', pushLog);
  vts.on('log', pushLog);
  // VTS 首次授權拿到 token → 存進 settings(下次免再跳允許視窗)
  vts.on('token', (token) => {
    const cfg = settings.get('vts') || {};
    settings.set('vts', { ...cfg, token: token || '' });
  });
  // 模型表情清單 → renderer 做下拉選單
  vts.on('hotkeys', (names) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vts:hotkeys', names);
  });

  // 連線狀態變動 → renderer
  const broadcastStatus = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', {
        cloud: cloud.getStatus(),
        obs: obs.getStatus(),
        vts: vts.getStatus(),
        hasToken: Boolean(settings.get('desktopToken')),
      });
    }
  };
  cloud.on('status', broadcastStatus);
  obs.on('status', broadcastStatus);
  vts.on('status', broadcastStatus);

  // 串接 relay
  relay = new Relay({
    obs, cloud, onLog: pushLog,
    onTts: (msg) => {
      // 把 TTS 訊息(tts.say / tts.audio)轉給 renderer;renderer 依 msg.type 分流
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tts', msg);
      }
      // AI 情緒 → VTS 表情(emotion 對應主播設定的 hotkey 名稱)
      if (msg?.emotion) {
        const map = (settings.get('vts') || {}).emotions || {};
        const hotkey = map[msg.emotion] || map.neutral;
        if (hotkey) vts.triggerExpression(hotkey);
      }
    },
  });
  relay.start();

  createWindow();

  // 開機自動嘗試連線
  setTimeout(() => {
    reconnectCloud();
    reconnectObs();
    reconnectVts();
  }, 500);

  // 自動更新(從 GitHub Releases 抓 latest.yml;dev 模式會略過)
  autoUpdater.on('update-available', (info) => pushLog({ level: 'info', msg: `有新版 ${info.version},背景下載中…` }));
  autoUpdater.on('update-not-available', () => pushLog({ level: 'info', msg: '已是最新版' }));
  autoUpdater.on('error', (e) => pushLog({ level: 'warn', msg: `更新檢查失敗:${e?.message || e}` }));
  autoUpdater.on('update-downloaded', (info) => pushLog({ level: 'info', msg: `新版 ${info.version} 已下載,下次開啟自動更新` }));
  try { autoUpdater.checkForUpdatesAndNotify(); }
  catch (e) { pushLog({ level: 'warn', msg: `更新檢查例外:${e.message}` }); }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { cloud.disconnect(); } catch {}
  try { obs.disconnect(); } catch {}
  try { vts.disconnect(); } catch {}
});
