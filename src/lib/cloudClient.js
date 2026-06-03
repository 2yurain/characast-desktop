// =====================================================
// cloudClient.js — 連到 CharaCast cloud /api/v1/desktop/ws
// =====================================================
// 自動重連 + 心跳 + 訊息收發。
// 跟 server 的訊息協議:
//   client → server:
//     { type: 'hello', desktopToken }      連上第一封必送
//     { type: 'pong' }
//     { type: 'mic.state', muted, durationSeconds }
//     { type: 'obs.scene_changed', scene }
//     { type: 'resonance', energy, freq }       歌聲共鳴 音高 F0(高頻 ~12/s,雲端轉發給 OBS overlay)
//   server → client:
//     { type: 'auth.ok' | 'auth.fail' }
//     { type: 'ping' }
//     { type: 'tts.say', text }
//     { type: 'obs.set_scene', scene }
//     { type: 'mic.mute', seconds, inputName? }   // 閉麥主播 power
// =====================================================

const WebSocket = require('ws');
const EventEmitter = require('events');

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
const PING_SEND_MS = 25_000;       // server 30s 心跳,我們 25s 主動 ping

class CloudClient extends EventEmitter {
  constructor() {
    super();
    this.url = null;
    this.token = null;
    this.ws = null;
    this.authed = false;
    this.connectedAt = null;
    this.reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._stopped = false;
  }

  connect({ url, desktopToken }) {
    this.url = url;
    this.token = desktopToken;
    this._stopped = false;
    this._openSocket();
  }

  disconnect() {
    this._stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this.ws) {
      try { this.ws.close(1000, 'manual'); } catch {}
      this.ws = null;
    }
    this.authed = false;
    this.connectedAt = null;
    this.emit('status', this.getStatus());
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(msg)); return true; }
    catch { return false; }
  }

  isConnected() { return Boolean(this.ws && this.ws.readyState === 1 && this.authed); }

  getStatus() {
    return {
      url: this.url,
      authed: this.authed,
      connectedAt: this.connectedAt,
      reconnectAttempt: this.reconnectAttempt,
      readyState: this.ws ? this.ws.readyState : -1,
    };
  }

  _openSocket() {
    if (!this.url || !this.token) {
      this.emit('log', { level: 'warn', msg: 'cloud:跳過連線 — 缺 url 或 token' });
      return;
    }
    this.emit('log', { level: 'info', msg: `cloud:連線中 ${this.url}` });
    let ws;
    try { ws = new WebSocket(this.url); }
    catch (e) {
      this.emit('log', { level: 'err', msg: `cloud:建立 WS 失敗 ${e.message}` });
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.authed = false;

    ws.on('open', () => {
      this.connectedAt = new Date();
      this.reconnectAttempt = 0;
      this.emit('log', { level: 'info', msg: 'cloud:連線開啟,送 hello' });
      this.send({ type: 'hello', desktopToken: this.token });
      this._startPing();
      this.emit('status', this.getStatus());
    });

    ws.on('message', (raw) => this._handleMessage(raw));
    ws.on('close', (code, reason) => {
      this.emit('log', { level: 'warn', msg: `cloud:斷線 ${code} ${reason}` });
      this.authed = false;
      this._stopPing();
      this.emit('status', this.getStatus());
      if (!this._stopped) this._scheduleReconnect();
    });
    ws.on('error', (e) => {
      this.emit('log', { level: 'err', msg: `cloud:WS error ${e.message}` });
    });
  }

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); }
    catch { return; }

    if (msg.type === 'auth.ok') {
      this.authed = true;
      this.emit('log', { level: 'info', msg: 'cloud:認證成功 ✓' });
      this.emit('status', this.getStatus());
      this.emit('authed');
      return;
    }
    if (msg.type === 'auth.fail') {
      this.emit('log', { level: 'err', msg: `cloud:認證失敗 ${msg.error || ''}` });
      this.disconnect();
      this.emit('authFail', msg.error || 'unknown');
      return;
    }
    if (msg.type === 'ping') {
      this.send({ type: 'pong' });
      return;
    }
    // Dispatch — main 訂閱
    this.emit('message', msg);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.send({ type: 'pong' });
      }
    }, PING_SEND_MS);
  }
  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  _scheduleReconnect() {
    if (this._stopped) return;
    if (this._reconnectTimer) return;
    this.reconnectAttempt++;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(1.7, this.reconnectAttempt - 1));
    this.emit('log', { level: 'info', msg: `cloud:${Math.round(delay/1000)}s 後重連(第 ${this.reconnectAttempt} 次)` });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openSocket();
    }, delay);
  }
}

module.exports = { CloudClient };
