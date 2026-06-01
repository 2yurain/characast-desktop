// =====================================================
// obsClient.js — 連到 localhost OBS WebSocket(obs-websocket 5.x)
// =====================================================
// 訂閱事件 → emit 給上層 relay:
//   - InputMuteStateChanged       麥(或任何 input)mute 切換
//   - CurrentProgramSceneChanged  場景變動
//   - StreamStateChanged          開/停 stream
//   - 之後加更多
//
// 自動重連(OBS 沒開機 / 重啟)。
// =====================================================

const OBSWebSocket = require('obs-websocket-js').default;
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// 把類別/暱稱清成合法檔名片段(去掉 \ / : * ? " < > | 等),限長度
function sanitizeForFilename(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

class ObsClient extends EventEmitter {
  constructor() {
    super();
    this.obs = null;
    this.connected = false;
    this.config = null;
    this.reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._stopped = false;
  }

  connect({ host = 'localhost', port = 4455, password = '' }) {
    this.config = { host, port, password };
    this._stopped = false;
    this._open();
  }

  disconnect() {
    this._stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.obs) {
      try { this.obs.disconnect(); } catch {}
      this.obs = null;
    }
    this.connected = false;
    this.emit('status', this.getStatus());
  }

  isConnected() { return this.connected; }

  getStatus() {
    return {
      connected: this.connected,
      config: this.config ? { host: this.config.host, port: this.config.port } : null,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  /** 主動切場景 — relay 從 cloud 收到 obs.set_scene 時呼叫 */
  async setScene(sceneName) {
    if (!this.connected || !this.obs) return false;
    try {
      await this.obs.call('SetCurrentProgramScene', { sceneName });
      return true;
    } catch (e) {
      this.emit('log', { level: 'err', msg: `obs:SetCurrentProgramScene 失敗 ${e.message}` });
      return false;
    }
  }

  /** 啟動重播緩存(冪等;已在跑就略過)。需 OBS 設定→輸出→已啟用「重播緩衝」。 */
  async startReplayBuffer() {
    if (!this.connected || !this.obs) return false;
    try {
      await this.obs.call('StartReplayBuffer');
      this.emit('log', { level: 'info', msg: 'obs:重播緩存已啟動' });
      return true;
    } catch (e) {
      const m = String(e?.message || e);
      if (/active|running|already/i.test(m)) return true; // 已在跑
      this.emit('log', { level: 'warn', msg: `obs:啟動重播緩存失敗(OBS 設定→輸出→啟用「重播緩衝」?):${m}` });
      return false;
    }
  }

  /**
   * 存重播緩存 → 本機 .mp4。relay 收到 cloud 的 clip.replay 時呼叫。回 { ok, path }。
   * category/requester 會加進檔名(參照舊作法,剪輯時帶類別),OBS 本身 SaveReplayBuffer
   * 不能指定檔名,所以存完拿到路徑後在同資料夾改名:「[類別] 原檔名」(失敗就保留原檔)。
   */
  async saveReplay(category, requester) {
    if (!this.connected || !this.obs) return { ok: false, reason: 'obs 未連' };
    try {
      await this.startReplayBuffer(); // 確保在跑(開播時通常已自動起)
      await this.obs.call('SaveReplayBuffer');
      let savedPath = null;
      try { const r = await this.obs.call('GetLastReplayBufferReplay'); savedPath = r?.savedReplayPath || null; } catch { /* 舊版可能沒這 request */ }

      // 改名加上類別(+ 兌換者),例:「[神操作 by 阿明] Replay 2026-06-01 14-32-10.mp4」
      if (savedPath) {
        const cat = sanitizeForFilename(category) || '精華';
        const who = sanitizeForFilename(requester);
        const tag = `[${cat}${who ? ' by ' + who : ''}]`;
        try {
          const dir = path.dirname(savedPath);
          const base = path.basename(savedPath);
          const target = path.join(dir, `${tag} ${base}`);
          if (target !== savedPath && !fs.existsSync(target)) {
            fs.renameSync(savedPath, target);
            savedPath = target;
          }
        } catch (re) {
          this.emit('log', { level: 'warn', msg: `obs:重播改名失敗(保留原檔):${re?.message || re}` });
        }
      }

      this.emit('log', { level: 'info', msg: `obs:✂️ 重播已存${savedPath ? ' → ' + savedPath : ''}` });
      return { ok: true, path: savedPath };
    } catch (e) {
      const m = String(e?.message || e);
      this.emit('log', { level: 'err', msg: `obs:存重播失敗(緩存還沒跑滿 / 未啟用?):${m}` });
      return { ok: false, reason: m };
    }
  }

  async _open() {
    if (!this.config) return;
    if (this.obs) { try { this.obs.disconnect(); } catch {} this.obs = null; }
    const obs = new OBSWebSocket();
    this.obs = obs;

    const url = `ws://${this.config.host}:${this.config.port}`;
    this.emit('log', { level: 'info', msg: `obs:連線中 ${url}` });

    try {
      await obs.connect(url, this.config.password || undefined);
    } catch (e) {
      const m = String(e?.message || e);
      // 偵測常見錯誤,給友善提示
      if (m.includes('authentication') && !this.config.password) {
        this.emit('log', { level: 'err', msg: '⚠ OBS 需要密碼:Tools → WebSocket Server Settings → Show Connect Info,複製 Server Password 貼到下方「OBS 連線設定」' });
      } else if (m.includes('authentication')) {
        this.emit('log', { level: 'err', msg: '⚠ OBS 密碼錯誤,請從 OBS Tools → WebSocket Server Settings → Show Connect Info 重新複製' });
      } else if (m.includes('ECONNREFUSED') || m.includes('connect')) {
        this.emit('log', { level: 'warn', msg: '⚠ OBS WebSocket 沒回應 — 確認 OBS 已開啟 + Tools → WebSocket Server Settings → Enable WebSocket Server 已勾' });
      } else {
        this.emit('log', { level: 'warn', msg: `obs:連線失敗 ${m}` });
      }
      this._scheduleReconnect();
      return;
    }

    this.connected = true;
    this.reconnectAttempt = 0;
    this.emit('log', { level: 'info', msg: 'obs:連線成功 ✓' });
    this.emit('status', this.getStatus());
    this.emit('connected');

    // 訂閱事件
    obs.on('InputMuteStateChanged', (data) => {
      // data: { inputName, inputMuted }
      this.emit('event', {
        type: 'mic.state',
        inputName: data.inputName,
        muted: Boolean(data.inputMuted),
      });
    });
    obs.on('CurrentProgramSceneChanged', (data) => {
      // data: { sceneName }
      this.emit('event', {
        type: 'obs.scene_changed',
        scene: data.sceneName,
      });
    });
    obs.on('StreamStateChanged', (data) => {
      // data: { outputActive, outputState }
      this.emit('event', {
        type: 'obs.stream_state',
        active: Boolean(data.outputActive),
        state: data.outputState,
      });
      // 開播自動起重播緩存,之後 !剪輯 才剪得到(緩存要先跑著才有內容)
      if (data.outputActive) this.startReplayBuffer().catch(() => {});
    });
    obs.on('ConnectionClosed', () => {
      this.connected = false;
      this.emit('log', { level: 'warn', msg: 'obs:連線關閉' });
      this.emit('status', this.getStatus());
      if (!this._stopped) this._scheduleReconnect();
    });
    obs.on('ConnectionError', (e) => {
      this.emit('log', { level: 'err', msg: `obs:WS error ${e?.message || e}` });
    });
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    if (this._reconnectTimer) return;
    this.reconnectAttempt++;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(1.5, this.reconnectAttempt - 1));
    this.emit('log', { level: 'info', msg: `obs:${Math.round(delay/1000)}s 後重連(第 ${this.reconnectAttempt} 次)` });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open();
    }, delay);
  }
}

module.exports = { ObsClient };
