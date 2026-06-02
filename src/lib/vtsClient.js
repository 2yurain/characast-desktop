// =====================================================
// vtsClient.js — 連本機 VTube Studio(Public API, ws://localhost:8001)
// =====================================================
// 給 AI 角色一個會動的 VTuber 立繪:
//   - AI 情緒 → 觸發 VTS 表情(用 hotkey 名稱對應)
//   - TTS 播放振幅 → 注入嘴型參數(lip-sync)
// 授權流程(VTS plugin):AuthenticationTokenRequest(使用者在 VTS 按允許)→
//   拿 token 存起來 → AuthenticationRequest 認證 → 之後可下指令。
// 跟 obsClient 同模式:EventEmitter,emit 'log' / 'status' / 'token'。
// =====================================================

const WebSocket = require('ws');
const EventEmitter = require('events');

const RECONNECT_MS = 6000;
const PLUGIN_NAME = 'CharaCast';
const PLUGIN_DEV = 'CharaCast';
// 嘴型注入的參數:預設輸入 MouthOpen + 自建 CharaCastMouth(主播把模型嘴巴綁哪個都行)
const MOUTH_PARAMS = ['MouthOpen', 'CharaCastMouth'];

class VtsClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.config = null;          // { enabled, host, port, token }
    this.connected = false;
    this.authed = false;
    this._reqId = 0;
    this._pending = new Map();   // requestID -> {resolve, reject, timer}
    this._hotkeys = new Map();   // 小寫 name -> hotkeyID
    this._reconnectTimer = null;
    this._lastMouth = -1;
  }

  getStatus() { return { connected: this.connected, authed: this.authed }; }

  connect(config) {
    this.config = config || {};
    if (!this.config.enabled) { this.disconnect(); return; }
    this._open();
  }

  disconnect() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.connected = false; this.authed = false;
    this.emit('status');
  }

  _open() {
    const host = this.config.host || 'localhost';
    const port = this.config.port || 8001;
    const url = `ws://${host}:${port}`;
    this.emit('log', { level: 'info', msg: `vts:連線中 ${url}` });
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this._scheduleReconnect(`建立失敗 ${e.message}`); return; }
    this.ws = ws;

    ws.on('open', async () => {
      this.connected = true; this.emit('status');
      this.emit('log', { level: 'info', msg: 'vts:已連線,授權中…' });
      try { await this._authenticate(); } catch (e) { this.emit('log', { level: 'err', msg: `vts:授權失敗 ${e.message}` }); }
    });
    ws.on('message', (raw) => this._onMessage(raw));
    ws.on('error', (e) => this.emit('log', { level: 'warn', msg: `vts:ws error ${e?.message}` }));
    ws.on('close', () => {
      this.connected = false; this.authed = false; this.emit('status');
      if (this.config?.enabled) this._scheduleReconnect('連線關閉');
    });
  }

  _scheduleReconnect(why) {
    if (!this.config?.enabled) return;
    this.emit('log', { level: 'warn', msg: `vts:${why},${RECONNECT_MS / 1000}s 後重連` });
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._open(), RECONNECT_MS);
  }

  // ---- request/response 相關 ----
  _send(messageType, data, expectResponse = true) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('vts 未連線'));
    const requestID = `cc-${++this._reqId}`;
    const msg = { apiName: 'VTubeStudioPublicAPI', apiVersion: '1.0', requestID, messageType, data: data || {} };
    this.ws.send(JSON.stringify(msg));
    if (!expectResponse) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(requestID); reject(new Error(`${messageType} 逾時`)); }, 5000);
      this._pending.set(requestID, { resolve, reject, timer });
    });
  }

  _onMessage(raw) {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const p = msg.requestID && this._pending.get(msg.requestID);
    if (p) {
      clearTimeout(p.timer); this._pending.delete(msg.requestID);
      if (msg.messageType === 'APIError') p.reject(new Error(msg.data?.message || 'API error'));
      else p.resolve(msg.data || {});
    }
  }

  async _authenticate() {
    let token = this.config.token || '';
    if (!token) {
      const r = await this._send('AuthenticationTokenRequest', { pluginName: PLUGIN_NAME, pluginDeveloper: PLUGIN_DEV });
      token = r.authenticationToken;
      if (!token) throw new Error('沒拿到 token(可能在 VTS 被拒絕)');
      this.emit('token', token); // main 存進 settings
      this.emit('log', { level: 'info', msg: 'vts:已取得授權 token' });
    }
    const a = await this._send('AuthenticationRequest', { pluginName: PLUGIN_NAME, pluginDeveloper: PLUGIN_DEV, authenticationToken: token });
    if (!a.authenticated) {
      // token 失效 → 清掉重來一次
      this.config.token = ''; this.emit('token', '');
      throw new Error(a.reason || '認證被拒');
    }
    this.authed = true; this.emit('status');
    this.emit('log', { level: 'info', msg: 'vts:✅ 已授權' });
    // 建一個自訂嘴型參數(主播可把模型嘴巴綁到它);失敗不擋
    try {
      await this._send('ParameterCreationRequest', {
        parameterName: 'CharaCastMouth', explanation: 'CharaCast 嘴型(TTS lip-sync)',
        min: 0, max: 1, defaultValue: 0,
      });
    } catch { /* 已存在或不支援就算了 */ }
    await this._refreshHotkeys();
  }

  /** 公開:重新讀取目前模型的表情快捷鍵(UI「重新讀取」用) */
  async refreshHotkeys() { if (this.authed) await this._refreshHotkeys(); }

  async _refreshHotkeys() {
    try {
      const r = await this._send('HotkeysInCurrentModelRequest', {});
      this._hotkeys.clear();
      const names = [];
      for (const h of (r.availableHotkeys || [])) {
        if (h.name) { this._hotkeys.set(String(h.name).toLowerCase(), h.hotkeyID); names.push(h.name); }
      }
      this.emit('log', { level: 'info', msg: `vts:載入 ${names.length} 個表情快捷鍵` });
      this.emit('hotkeys', names); // 給 UI 做下拉選單
    } catch (e) { this.emit('log', { level: 'warn', msg: `vts:讀快捷鍵失敗 ${e.message}` }); }
  }

  /** 觸發表情 —— 傳 VTS hotkey 名稱(大小寫不拘);找不到就略過 */
  async triggerExpression(hotkeyName) {
    if (!this.authed || !hotkeyName) return;
    let id = this._hotkeys.get(String(hotkeyName).toLowerCase());
    if (!id) { await this._refreshHotkeys(); id = this._hotkeys.get(String(hotkeyName).toLowerCase()); }
    if (!id) { this.emit('log', { level: 'warn', msg: `vts:找不到表情快捷鍵「${hotkeyName}」` }); return; }
    try { await this._send('HotkeyTriggerRequest', { hotkeyID: id }, false); }
    catch (e) { this.emit('log', { level: 'warn', msg: `vts:觸發表情失敗 ${e.message}` }); }
  }

  /** 注入嘴型(lip-sync)。value 0..1。高頻呼叫,不等回應、相同值不重送。 */
  setMouth(value) {
    if (!this.authed || !this.ws || this.ws.readyState !== 1) return;
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    if (Math.abs(v - this._lastMouth) < 0.02) return; // 微小變化省流量
    this._lastMouth = v;
    this._send('InjectParameterDataRequest', {
      faceFound: false, mode: 'set',
      parameterValues: MOUTH_PARAMS.map((id) => ({ id, value: v, weight: 1 })),
    }, false).catch(() => {});
  }
}

module.exports = { VtsClient };
