// =====================================================
// main.js — Electron main process
// =====================================================
// 啟動視窗,管理 OBS + Cloud 兩條 WebSocket,IPC 跟 renderer 溝通。
// =====================================================

const { app, BrowserWindow, ipcMain, session, desktopCapturer } = require('electron');
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
  // 記住上次視窗大小/位置 → 下次開一樣大,不用每次自己拉大
  const saved = settings.get('windowBounds') || {};
  mainWindow = new BrowserWindow({
    width: Number(saved.width) || 880,
    height: Number(saved.height) || 940,
    x: Number.isInteger(saved.x) ? saved.x : undefined,
    y: Number.isInteger(saved.y) ? saved.y : undefined,
    minWidth: 560,
    minHeight: 600,
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
  // 視窗大小/位置變動 → debounce 存起來(最大化時不存,避免還原成怪尺寸)
  let _boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(_boundsTimer);
    _boundsTimer = setTimeout(() => {
      try { if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) settings.set('windowBounds', mainWindow.getBounds()); } catch {}
    }, 500);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  // 縱深防禦:UI 是本機檔,正常不會開新視窗或導航到外站。
  // 一律拒絕 window.open / target=_blank,並擋掉任何離開本機 UI 的 navigation。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ======= IPC handlers =======
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('settings:get', () => settings.all());

// renderer 只允許改這些 key(白名單,擋掉亂塞鍵 / 原型污染)
const SETTABLE_KEYS = new Set(['cloudUrl', 'cloudHttpsUrl', 'obs', 'vts', 'resonance', 'mic', 'stt', 'vision', 'visionProfiles', 'visionHud', 'voice', 'coachLevels']);

// Vision 框選區:每款遊戲一組 zones(畫面比例 0~1)。
//   { [game]: { zones: [ { id, label, mode:'rate'|'ocr', rect:{x,y,w,h} } ] } }
//   - rate:盯變化率(戰鬥框 / 戰況框)；ocr:讀數字(人頭比數 / KDA)
//   - 向後相容:舊的 { kf:{...} } 自動轉成一個 rate 框(label「戰鬥」)
const VISION_ZONE_MODES = new Set(['rate', 'ocr']);
function sanitizeVisionHud(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  const f = (n) => { const x = Number(n); return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; };
  const cleanZone = (z, i) => {
    if (!z || typeof z !== 'object' || !z.rect) return null;
    const r = z.rect;
    if (!(Number(r.w) > 0 && Number(r.h) > 0)) return null;
    return {
      id: String(z.id || ('z' + i)).slice(0, 24),
      label: String(z.label || '區域').slice(0, 16),
      mode: VISION_ZONE_MODES.has(z.mode) ? z.mode : 'rate',
      rect: { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) },
    };
  };
  let games = 0;
  for (const [game, cfg] of Object.entries(v)) {
    if (game === '__proto__' || game === 'constructor') continue;
    if (++games > 30 || !cfg || typeof cfg !== 'object') continue;
    let zones = [];
    if (Array.isArray(cfg.zones)) {
      zones = cfg.zones.slice(0, 12).map(cleanZone).filter(Boolean);
    } else if (cfg.kf) {   // 舊格式 → 單一 rate 框
      const z = cleanZone({ id: 'kf', label: '戰鬥', mode: 'rate', rect: cfg.kf }, 0);
      if (z) zones = [z];
    }
    if (zones.length) out[String(game).slice(0, 80)] = { zones };
  }
  return out;
}

// Vision 校準檔:{ [game]: { [label]: [ [floats…], … ] } }。重建乾淨結構 + 上限,擋亂塞/巨型/原型污染。
function sanitizeVisionProfiles(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  let games = 0;
  for (const [game, labels] of Object.entries(v)) {
    if (game === '__proto__' || game === 'constructor') continue;
    if (++games > 30 || !labels || typeof labels !== 'object') continue;
    const g = {};
    let nLabels = 0;
    for (const [label, samples] of Object.entries(labels)) {
      if (label === '__proto__' || label === 'constructor') continue;
      if (++nLabels > 24 || !Array.isArray(samples)) continue;
      const arr = [];
      for (const vec of samples) {
        if (arr.length >= 8 || !Array.isArray(vec)) continue;
        const clean = vec.slice(0, 1024).map((n) => Number(n)).filter((n) => Number.isFinite(n));
        if (clean.length) arr.push(clean);
      }
      if (arr.length) g[String(label).slice(0, 24)] = arr;
    }
    if (Object.keys(g).length) out[String(game).slice(0, 80)] = g;
  }
  return out;
}

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
      // resonance:只取已知欄位與型別,擋掉亂塞鍵 / 原型污染 / 巨型字串
      if (k === 'resonance') {
        const src = (v && typeof v === 'object') ? v : {};
        settings.set('resonance', {
          enabled: Boolean(src.enabled),
          deviceId: String(src.deviceId || '').slice(0, 256),   // 保留:舊版相容
        });
        continue;
      }
      // mic:共用麥克風裝置(共鳴 + STT 共用這支)
      if (k === 'mic') {
        const src = (v && typeof v === 'object') ? v : {};
        settings.set('mic', { deviceId: String(src.deviceId || '').slice(0, 256) });
        continue;
      }
      // stt:本地語音辨識的「桌面端開關」(跟後台 AI 感知是 AND 關係)
      if (k === 'stt') {
        const src = (v && typeof v === 'object') ? v : {};
        settings.set('stt', { enabled: Boolean(src.enabled) });
        continue;
      }
      // vision:本地看畫面的「桌面端開關」(跟後台 AI 感知是 AND 關係)
      if (k === 'vision') {
        const src = (v && typeof v === 'object') ? v : {};
        settings.set('vision', { enabled: Boolean(src.enabled) });
        continue;
      }
      // visionProfiles:Vision Layer 2 每款遊戲的校準向量(本地存)
      if (k === 'visionProfiles') {
        settings.set('visionProfiles', sanitizeVisionProfiles(v));
        continue;
      }
      // visionHud:每款遊戲的框選區 zones(rate 戰鬥/戰況 + ocr 人頭/KDA)
      if (k === 'visionHud') {
        settings.set('visionHud', sanitizeVisionHud(v));
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
// AI 感知設定:renderer 跟雲端要 STT/Vision 開關 + 效能等級(連不上回 null,讓 renderer 稍後重試)
ipcMain.handle('perception:get', async () => {
  try { return await cloud.requestPerceptionConfig(); }
  catch { return null; }
});
// 本地 whisper 辨識出的主播語音 → 轉給 cloud(只送短文字當脈絡;沒連上就丟棄)
ipcMain.on('streamer:speech', (_e, text) => {
  const t = String(text || '').trim();
  if (!t || !cloud.isConnected()) return;
  cloud.send({ type: 'streamer.speech', text: t.slice(0, 300) });
});
// 歌唱音準:renderer 定期送「本場累計音準聚合」→ 轉給 cloud(成長報告 B 維度;沒連上就丟棄)
ipcMain.on('streamer:pitch', (_e, stats) => {
  if (!stats || typeof stats !== 'object' || !cloud.isConnected()) return;
  cloud.send({ type: 'streamer.pitch', stats });
});
// 點唱歌單:桌面端用 desktopToken 控制(GET 狀態 / POST 動作)
async function _songQueueReq(method, body) {
  const token = settings.get('desktopToken');
  const httpsUrl = settings.get('cloudHttpsUrl');
  const chk = settings.validateCloudUrl(httpsUrl, { kind: 'https' });
  if (!token) return { error: '尚未配對' };
  if (!chk.ok) return { error: 'cloud 位址不合法' };
  try {
    const res = await fetch(`${httpsUrl.replace(/\/$/, '')}/api/v1/desktop/songqueue`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-desktop-token': token },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    const j = await res.json();
    if (!res.ok) return { error: j.error || `HTTP ${res.status}` };
    return j;
  } catch (e) { return { error: e.message }; }
}
ipcMain.handle('songqueue:get', () => _songQueueReq('GET'));
ipcMain.handle('songqueue:action', (_e, action) => _songQueueReq('POST', { action: String(action || '') }));

// 歷史歌唱教練評語(GET;desktopToken)→ 回看不用重錄
ipcMain.handle('singing:coachHistory', async () => {
  const token = settings.get('desktopToken');
  const httpsUrl = settings.get('cloudHttpsUrl');
  if (!token || !settings.validateCloudUrl(httpsUrl, { kind: 'https' }).ok) return { ok: false, items: [] };
  try {
    const res = await fetch(`${httpsUrl.replace(/\/$/, '')}/api/v1/desktop/coach-history`, {
      headers: { 'x-desktop-token': token },
    });
    const j = await res.json();
    return res.ok ? j : { ok: false, items: [] };
  } catch { return { ok: false, items: [] }; }
});
ipcMain.handle('singing:coachHistoryDelete', async (_e, id) => {
  const token = settings.get('desktopToken');
  const httpsUrl = settings.get('cloudHttpsUrl');
  if (!token || !settings.validateCloudUrl(httpsUrl, { kind: 'https' }).ok) return { ok: false };
  try {
    const res = await fetch(`${httpsUrl.replace(/\/$/, '')}/api/v1/desktop/coach-history/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-desktop-token': token },
      body: JSON.stringify({ id: String(id || '') }),
    });
    return res.ok ? await res.json() : { ok: false };
  } catch { return { ok: false }; }
});

// 歌唱教練:renderer 錄好一段清唱 WAV → 這裡帶 desktopToken HTTP POST 上雲(Gemini 聽 → 回饋)
ipcMain.handle('singing:coachAudio', async (_e, payload) => {
  const wavBuf = payload && payload.wav ? payload.wav : payload;   // 相容舊呼叫(直接傳 buffer)
  const song = (payload && typeof payload.song === 'string') ? payload.song.trim() : '';
  const question = (payload && typeof payload.question === 'string') ? payload.question.trim() : '';
  const mix = Boolean(payload && payload.mix);   // 有沒有混伴奏 → 雲端決定要不要評音準
  const token = settings.get('desktopToken');
  const httpsUrl = settings.get('cloudHttpsUrl');
  const chk = settings.validateCloudUrl(httpsUrl, { kind: 'https' });
  if (!token) return { ok: false, error: '尚未配對' };
  if (!chk.ok) return { ok: false, error: 'cloud 位址不合法' };
  if (!wavBuf || !wavBuf.byteLength) return { ok: false, error: '沒有錄到聲音' };
  try {
    const parts = [];
    if (song) parts.push('song=' + encodeURIComponent(song.slice(0, 60)));
    if (question) parts.push('q=' + encodeURIComponent(question.slice(0, 200)));
    if (mix) parts.push('mix=1');
    const qs = parts.length ? '?' + parts.join('&') : '';
    const res = await fetch(`${httpsUrl.replace(/\/$/, '')}/api/v1/desktop/singing-coach${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'x-desktop-token': token },
      body: Buffer.from(wavBuf),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    pushLog({ level: 'info', msg: `歌唱教練:上傳 ${Math.round((wavBuf.byteLength || 0) / 1024)}KB → ${j.ok ? (j.song ? '《' + j.song + '》' : '回饋已產生') : '無回饋(' + (j.reason || '?') + ')'}` });
    return j;
  } catch (e) {
    pushLog({ level: 'err', msg: `歌唱教練上傳失敗:${e.message}` });
    return { ok: false, error: e.message };
  }
});
// Vision:renderer 要 OBS 目前畫面縮圖(回 base64 data URL 或 null)
ipcMain.handle('obs:screenshot', async (_e, opts) => {
  try { return await obs.getScreenshot(opts || {}); }
  catch { return null; }
});
// Vision:桌面端看圖(CLIP)後的短場景描述 → 轉給 cloud
ipcMain.on('streamer:vision', (_e, text) => {
  const t = String(text || '').trim();
  if (!t || !cloud.isConnected()) return;
  cloud.send({ type: 'streamer.vision', text: t.slice(0, 200) });
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
    // 驗 token 型別/長度後再存(防 server 回傳異常 / 被中間人塞髒值)
    if (typeof j.desktopToken !== 'string' || j.desktopToken.length < 16 || j.desktopToken.length > 4096) {
      throw new Error('回傳的 token 格式不正確');
    }
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

// 一鍵設置 OBS 場景:跟雲端要 overlay 網址 → 在 OBS 建「遊戲 / 聊天 / 唱歌」場景(只加不減,同名場景跳過)
const SCENE_SRC = {
  avatar:      { key: 'avatar',      inputName: 'CharaCast 形象' },
  overlay:     { key: 'overlay',     inputName: 'CharaCast 多功能overlay' },
  resonance:   { key: 'resonance',   inputName: 'CharaCast 聲音共鳴' },
  songqueue:   { key: 'songqueue',   inputName: 'CharaCast 點歌清單' },
  rebellionBg: { key: 'rebellionBg', inputName: 'CharaCast 叛變背景' },
};
// 不再放文字佔位(會爆大疊最上面);場景只建乾淨的 CharaCast overlay,遊戲/鏡頭主播自己加。
const SCENE_TEMPLATES = {
  game: { name: '遊戲', sources: [SCENE_SRC.avatar, SCENE_SRC.overlay] },
  chat: { name: '聊天', sources: [SCENE_SRC.avatar, SCENE_SRC.overlay] },
  sing: { name: '唱歌', sources: [SCENE_SRC.avatar, SCENE_SRC.resonance, SCENE_SRC.songqueue] },
  // AI 叛變橋段:發動時自動切來、平叛切回。rebellionBg 放陣列最前 → 建場景時最先建 = z 序最底層(背景),小夏立繪/overlay 疊在上面
  rebellion: { name: '叛變', sources: [SCENE_SRC.rebellionBg, SCENE_SRC.avatar, SCENE_SRC.overlay] },
};
ipcMain.handle('obs:setup-scenes', async (_e, opts) => {
  try {
    if (!obs.isConnected()) return { ok: false, reason: 'OBS 未連線 — 先在「OBS」分頁連上 OBS' };
    if (!cloud.isConnected()) return { ok: false, reason: '雲端未連線 — 先完成配對' };
    const pick = (opts && Array.isArray(opts.scenes) && opts.scenes.length) ? opts.scenes : ['game', 'chat', 'sing', 'rebellion'];
    const addPlaceholders = !opts || opts.addPlaceholders !== false;
    const urls = await cloud.requestOverlayUrls();
    const scenes = pick.map((k) => SCENE_TEMPLATES[k]).filter(Boolean);
    return await obs.setupScenes({ scenes, urls, addPlaceholders });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

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
  // 歌唱教練「混音」用:讓 renderer 抓系統音(伴奏)做 loopback,不跳螢幕選擇器。
  // 只在 renderer 呼叫 getDisplayMedia 時觸發;我們只取 audio: 'loopback'(video 拿來占位,renderer 立刻丟掉)。
  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
    }, { useSystemPicker: false });
  } catch (e) { pushLog({ level: 'warn', msg: '系統音擷取 handler 設定失敗:' + e.message }); }

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
  // 情緒 → VTS 表情(emotion 對應主播在設定填的 hotkey 名稱);TTS 跟「叛變變兇」共用
  const applyEmotion = (emotion) => {
    if (!emotion) return;
    const map = (settings.get('vts') || {}).emotions || {};
    const hotkey = map[emotion] || map.neutral;
    if (hotkey) vts.triggerExpression(hotkey);
  };
  relay = new Relay({
    obs, cloud, onLog: pushLog,
    onTts: (msg) => {
      // 把 TTS 訊息(tts.say / tts.audio)轉給 renderer;renderer 依 msg.type 分流
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tts', msg);
      }
      applyEmotion(msg?.emotion);   // AI 情緒 → VTS 表情
    },
    // 叛變 start/end:雲端送 vts.expression(rebel / neutral)→ 立繪變兇 / 還原
    onVtsExpression: (emotion) => applyEmotion(emotion),
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
