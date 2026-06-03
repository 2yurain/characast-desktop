// =====================================================
// settings.js — electron-store wrapper(主播裝置端設定)
// =====================================================
// 存:
//   cloudUrl              CharaCast cloud WS URL(預設 prod)
//   desktopToken          配對後拿到的 long-lived token
//   obs.host / port / pwd OBS WebSocket 連線設定
//
// 機密欄位(desktopToken / obs.password / vts.token)用 Electron safeStorage
// (OS keychain / Windows DPAPI)在「落地前」加密,store 檔裡只留密文,
// 避免本機其他程式直接讀走 token / OBS 密碼。讀取時自動解密,UI 照常顯示。
// =====================================================

const Store = require('electron-store');
const { safeStorage } = require('electron');

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

// ============== 機密欄位的落地加密 ==============
const ENC_PREFIX = 'enc:v1:';
// 「會被當機密」的葉節點路徑(相對於整包 settings)
const SECRET_PATHS = ['desktopToken', 'obs.password', 'vts.token'];

function canEncrypt() {
  try { return safeStorage && safeStorage.isEncryptionAvailable(); }
  catch { return false; }
}

// 把明文機密 → 'enc:v1:<base64>';加密不可用(少數 Linux 無 keyring)時退回明文(best-effort)
function encField(plain) {
  if (plain == null || plain === '') return plain;
  if (typeof plain === 'string' && plain.startsWith(ENC_PREFIX)) return plain; // 已加密
  if (!canEncrypt()) return plain;
  try {
    const buf = safeStorage.encryptString(String(plain));
    return ENC_PREFIX + buf.toString('base64');
  } catch { return plain; }
}

// 還原機密;非密文(legacy 明文)直接回傳
function decField(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored;
  if (!canEncrypt()) return ''; // 有密文但這台機器解不開 → 當作沒有,讓使用者重新填
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch { return ''; }
}

// 取/設巢狀路徑(只支援一層 a.b,夠用)
function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const k of parts) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}
function setPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

// 對「整包設定 / 子物件」就地加解密相關葉節點。mode = 'enc' | 'dec'。
// scopeKey 給定時只處理屬於該 top-level key 的路徑(set 子物件時用)。
function transformSecrets(node, mode, scopeKey) {
  const fn = mode === 'enc' ? encField : decField;
  for (const full of SECRET_PATHS) {
    const parts = full.split('.');
    if (scopeKey) {
      if (parts[0] !== scopeKey) continue;
      // node 就是該 top-level 物件,路徑去掉第一段
      const sub = parts.slice(1).join('.');
      if (!sub) { /* 整個 top-level 是機密(理論上不會) */ continue; }
      const v = getPath(node, sub);
      if (v !== undefined) setPath(node, sub, fn(v));
    } else {
      const v = getPath(node, full);
      if (v !== undefined) setPath(node, full, fn(v));
    }
  }
  return node;
}

module.exports = {
  get: (key) => {
    const raw = store.get(key);
    // 整包機密(desktopToken)
    if (SECRET_PATHS.includes(key)) return decField(raw);
    // top-level 物件(obs / vts)→ 解密其中機密葉
    if (raw && typeof raw === 'object') {
      return transformSecrets(JSON.parse(JSON.stringify(raw)), 'dec', key);
    }
    return raw;
  },
  set: (key, val) => {
    if (SECRET_PATHS.includes(key)) return store.set(key, encField(val));
    if (val && typeof val === 'object') {
      const clone = JSON.parse(JSON.stringify(val));
      return store.set(key, transformSecrets(clone, 'enc', key));
    }
    return store.set(key, val);
  },
  delete: (key) => store.delete(key),
  all: () => {
    const clone = JSON.parse(JSON.stringify(store.store));
    return transformSecrets(clone, 'dec'); // 全包解密(給 UI 顯示)
  },
  // 開機時把舊網域 characast-core.onrender.com 的 cloud 位址就地改成 characast.co。
  // (網域收斂後 validateCloudUrl 只放行 characast.co,舊裝置存著 onrender 會被鎖死、無法配對/連線。)
  // 回傳改了幾個 key。
  migrateCloudUrls: () => {
    let changed = 0;
    for (const key of ['cloudUrl', 'cloudHttpsUrl']) {
      const raw = store.get(key);
      if (typeof raw !== 'string' || !raw) continue;
      let u;
      try { u = new URL(raw); } catch { continue; }
      if (u.hostname.toLowerCase() === 'characast-core.onrender.com') {
        u.hostname = 'characast.co';
        store.set(key, u.toString());
        changed++;
      }
    }
    return changed;
  },
  // 開機時把舊的明文機密就地升級成密文(safeStorage 可用才做)
  migrateSecrets: () => {
    if (!canEncrypt()) return;
    for (const full of SECRET_PATHS) {
      const raw = store.get(full);
      if (typeof raw === 'string' && raw && !raw.startsWith(ENC_PREFIX)) {
        store.set(full, encField(raw));
      }
    }
  },
  validateCloudUrl,
};

// ============== Cloud URL 驗證(防 token 被導去攻擊者) ==============
// 規則:必須是 wss(或本機 ws),且 host 屬於 characast.co 或本機。
// 不合法 → 回 { ok:false } 讓呼叫端拒絕寫入,維持原值。
// 舊網域 characast-core.onrender.com 已統一收斂到 characast.co(見 migrateCloudUrls)。
const ALLOWED_HOST_SUFFIXES = ['characast.co'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function isAllowedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (LOCAL_HOSTS.includes(h)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suf) => h === suf || h.endsWith('.' + suf));
}

function validateCloudUrl(value, { kind = 'ws' } = {}) {
  let u;
  try { u = new URL(String(value || '')); }
  catch { return { ok: false, error: 'URL 格式不正確' }; }
  const local = LOCAL_HOSTS.includes(u.hostname.toLowerCase());
  const okScheme = kind === 'https'
    ? (u.protocol === 'https:' || (local && u.protocol === 'http:'))
    : (u.protocol === 'wss:' || (local && u.protocol === 'ws:'));
  if (!okScheme) return { ok: false, error: '必須使用加密連線(wss/https)' };
  if (!isAllowedHost(u.hostname)) return { ok: false, error: `不允許的主機:${u.hostname}` };
  return { ok: true, value: u.toString() };
}
