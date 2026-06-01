// =====================================================
// main.js — Electron main process
// =====================================================
// 啟動視窗,管理 OBS + Cloud 兩條 WebSocket,IPC 跟 renderer 溝通。
// =====================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const settings = require('./lib/settings');
const { CloudClient } = require('./lib/cloudClient');
const { ObsClient } = require('./lib/obsClient');
const { Relay } = require('./lib/relay');

// 全域單例
const cloud = new CloudClient();
const obs = new ObsClient();
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
    },
    autoHideMenuBar: true,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ======= IPC handlers =======
ipcMain.handle('settings:get', () => settings.all());

ipcMain.handle('settings:set', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    for (const [k, v] of Object.entries(patch)) settings.set(k, v);
  }
  return settings.all();
});

ipcMain.handle('status:get', () => ({
  cloud: cloud.getStatus(),
  obs: obs.getStatus(),
  hasToken: Boolean(settings.get('desktopToken')),
}));

ipcMain.handle('logs:recent', () => logBuffer.slice(-100));

ipcMain.handle('pair:exchange', async (_e, code) => {
  // call CharaCast HTTPS endpoint to exchange 6-char code for desktop_token
  const httpsUrl = settings.get('cloudHttpsUrl');
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

// ======= reconnect wrappers =======
function reconnectCloud() {
  const token = settings.get('desktopToken');
  const url = settings.get('cloudUrl');
  cloud.disconnect();
  if (!token) {
    pushLog({ level: 'warn', msg: '尚未配對,跳過 cloud 連線' });
    return;
  }
  cloud.connect({ url, desktopToken: token });
}

function reconnectObs() {
  const cfg = settings.get('obs') || {};
  obs.disconnect();
  obs.connect({ host: cfg.host, port: cfg.port, password: cfg.password });
}

// ======= 啟動 =======
app.whenReady().then(() => {
  // 接 log → buffer + 廣播 renderer
  cloud.on('log', pushLog);
  obs.on('log', pushLog);

  // 連線狀態變動 → renderer
  const broadcastStatus = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', {
        cloud: cloud.getStatus(),
        obs: obs.getStatus(),
        hasToken: Boolean(settings.get('desktopToken')),
      });
    }
  };
  cloud.on('status', broadcastStatus);
  obs.on('status', broadcastStatus);

  // 串接 relay
  relay = new Relay({
    obs, cloud, onLog: pushLog,
    onTts: (msg) => {
      // 把 tts.say 廣播給 renderer 用 Web Speech API 播
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tts.say', msg);
      }
    },
  });
  relay.start();

  createWindow();

  // 開機自動嘗試連兩邊
  setTimeout(() => {
    reconnectCloud();
    reconnectObs();
  }, 500);

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
});
