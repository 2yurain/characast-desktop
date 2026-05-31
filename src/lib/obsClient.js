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
      this.emit('log', { level: 'warn', msg: `obs:連線失敗 ${e.message}` });
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
