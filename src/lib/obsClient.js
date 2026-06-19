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

  /** 設定某 input 的 mute 狀態 */
  async setInputMute(inputName, muted) {
    if (!this.connected || !this.obs) return false;
    try {
      await this.obs.call('SetInputMute', { inputName, inputMuted: !!muted });
      return true;
    } catch (e) {
      this.emit('log', { level: 'warn', msg: `obs:SetInputMute 失敗 ${e.message}` });
      return false;
    }
  }

  /** 找出麥克風 input 名:優先用主播切換過的,否則從 input 清單挑音訊擷取類 */
  async resolveMicInput() {
    if (this._lastMicInput) return this._lastMicInput;
    try {
      const r = await this.obs.call('GetInputList');
      const mic = (r.inputs || []).find((i) =>
        /input_capture$/.test(i.inputKind || '') || /mic|麥|aux|voice/i.test(i.inputName || ''));
      return mic ? mic.inputName : null;
    } catch { return null; }
  }

  /** 閉麥主播 N 秒(mute_streamer power):SetInputMute → N 秒後自動解除 */
  async muteMicFor(seconds, inputName) {
    if (!this.connected || !this.obs) return { ok: false, reason: 'obs 未連' };
    const name = inputName || await this.resolveMicInput();
    if (!name) return { ok: false, reason: '找不到麥克風 input' };
    const secs = Math.max(1, Math.min(30, Number(seconds) || 5));
    await this.setInputMute(name, true);
    this.emit('log', { level: 'info', msg: `obs:🔇 ${name} 閉麥 ${secs}s` });
    if (this._unmuteTimer) clearTimeout(this._unmuteTimer);
    this._unmuteTimer = setTimeout(() => {
      this.setInputMute(name, false).then(() =>
        this.emit('log', { level: 'info', msg: `obs:🔊 ${name} 解除閉麥` }));
    }, secs * 1000);
    return { ok: true, name, secs };
  }

  /** 取目前節目場景名(叛變等「臨時切走再切回」用) */
  async getCurrentScene() {
    if (!this.connected || !this.obs) return null;
    try {
      const r = await this.obs.call('GetCurrentProgramScene');
      return r?.currentProgramSceneName || r?.sceneName || null;
    } catch { return null; }
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

  /**
   * 截「目前節目場景」一張縮圖(= 觀眾看到的畫面),給 Vision 用。
   * 回 base64 data URL(image/jpeg)或 null。預設縮到 ~640px、低畫質(夠 CLIP 分類)。
   */
  async getScreenshot({ width = 640, quality = 50 } = {}) {
    if (!this.connected || !this.obs) return null;
    try {
      const cur = await this.obs.call('GetCurrentProgramScene');
      const sourceName = cur.currentProgramSceneName || cur.sceneName;
      if (!sourceName) return null;
      const r = await this.obs.call('GetSourceScreenshot', {
        sourceName,
        imageFormat: 'jpg',
        imageWidth: width,
        imageCompressionQuality: quality,
      });
      return r?.imageData || null;   // 已是 data:image/jpeg;base64,…
    } catch (e) {
      this.emit('log', { level: 'warn', msg: `obs:GetSourceScreenshot 失敗 ${e.message}` });
      return null;
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
      // 緩衝沒在跑 → 不要冷啟動後硬存(裡面是空的、必失敗)。先幫它起來,叫使用者等幾秒再喊。
      const st = await this.obs.call('GetReplayBufferStatus').catch(() => null);
      if (st && !st.outputActive) {
        await this.startReplayBuffer();
        this.emit('log', { level: 'warn', msg: 'obs:重播緩衝剛啟動,要先跑幾秒累積內容,等一下再喊一次「剪精華」' });
        return { ok: false, reason: 'replay_warming', msg: '重播緩衝剛開始跑,過幾秒再喊一次就剪得到' };
      }
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

  // ===== 一鍵設置場景(只加不減,冪等)=====

  async _sceneNames() {
    const r = await this.obs.call('GetSceneList');
    return (r.scenes || []).map((s) => s.sceneName);
  }

  async _inputNames() {
    const r = await this.obs.call('GetInputList');
    return (r.inputs || []).map((i) => i.inputName);
  }

  /** OBS 畫布大小(browser source 鋪滿用);拿不到回 1080p */
  async _canvasSize() {
    try { const r = await this.obs.call('GetVideoSettings'); return { w: r.baseWidth || 1920, h: r.baseHeight || 1080 }; }
    catch { return { w: 1920, h: 1080 }; }
  }

  /** 找一個這台 OBS 有的文字來源類別(跨平台命名不同);沒有就回 null → 不放佔位 */
  async _textKind() {
    try { const r = await this.obs.call('GetInputKindList'); return (r.inputKinds || []).find((k) => /^text_/.test(k)) || null; }
    catch { return null; }
  }

  /** 確保某 browser source 存在於某場景:不存在就建、已存在就把它也掛進這個場景(同一 source 可跨場景共用) */
  async _ensureBrowser(sceneName, inputName, url, w, h, existingInputs) {
    if (existingInputs.includes(inputName)) {
      try { await this.obs.call('CreateSceneItem', { sceneName, sourceName: inputName, sceneItemEnabled: true }); } catch { /* 已在此場景 */ }
      return;
    }
    await this.obs.call('CreateInput', {
      sceneName, inputName, inputKind: 'browser_source',
      inputSettings: { url, width: w, height: h },
      sceneItemEnabled: true,
    });
    existingInputs.push(inputName);
  }

  /**
   * 在場景放一個文字佔位(例:👉 遊戲畫面放這),提示主播自己補擷取/鏡頭。
   * ph = { label, xf, yf };xf/yf 是畫面比例位置,用 alignment=0(物件中心對準座標)→ 各自落定點、不疊在左上角。
   */
  async _ensureTextPlaceholder(sceneName, ph, textKind, w, h, existingInputs) {
    const inputName = `${sceneName}・${ph.label}`.slice(0, 60);
    if (existingInputs.includes(inputName)) return;
    const r = await this.obs.call('CreateInput', {
      sceneName, inputName, inputKind: textKind,
      inputSettings: { text: ph.label, font: { face: 'Microsoft JhengHei', size: 48 } },
      sceneItemEnabled: true,
    });
    existingInputs.push(inputName);
    try {
      await this.obs.call('SetSceneItemTransform', {
        sceneName, sceneItemId: r.sceneItemId,
        sceneItemTransform: { alignment: 0, positionX: Math.round((ph.xf ?? 0.5) * w), positionY: Math.round((ph.yf ?? 0.5) * h) },
      });
    } catch { /* 舊 OBS 不支援 transform 就算了,至少建出來了 */ }
  }

  /**
   * 一鍵建場景。scenes = [{ name, sources:[{key,inputName}], placeholders:[label] }],urls = {avatar,overlay,resonance,songqueue}。
   * 安全鐵則:**同名場景已存在 → 整個跳過,絕不動既有設定**;只建缺的。回每個場景的結果報告。
   */
  async setupScenes({ scenes, urls, addPlaceholders = true }) {
    if (!this.connected || !this.obs) return { ok: false, reason: 'OBS 未連線' };
    const { w, h } = await this._canvasSize();
    const textKind = addPlaceholders ? await this._textKind() : null;
    const existingScenes = await this._sceneNames();
    const existingInputs = await this._inputNames();
    const report = [];
    for (const scene of scenes) {
      if (existingScenes.includes(scene.name)) { report.push({ scene: scene.name, status: 'skipped_exists' }); continue; }
      try {
        await this.obs.call('CreateScene', { sceneName: scene.name });
        for (const src of scene.sources || []) {
          const url = urls[src.key];
          if (url) await this._ensureBrowser(scene.name, src.inputName, url, w, h, existingInputs).catch((e) => this.emit('log', { level: 'warn', msg: `obs:建來源 ${src.inputName} 失敗 ${e.message}` }));
        }
        if (textKind) for (const ph of (scene.placeholders || [])) {
          await this._ensureTextPlaceholder(scene.name, ph, textKind, w, h, existingInputs).catch(() => {});
        }
        report.push({ scene: scene.name, status: 'created' });
        this.emit('log', { level: 'info', msg: `obs:✓ 建好場景「${scene.name}」` });
      } catch (e) {
        report.push({ scene: scene.name, status: 'error', error: e.message });
        this.emit('log', { level: 'err', msg: `obs:建場景「${scene.name}」失敗 ${e.message}` });
      }
    }
    return { ok: true, report };
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
    // 一連上就把重播緩衝跑起來(不只開播才起)→ 隨時喊「剪精華」都有累積好的內容可剪。
    // (OBS 沒啟用重播緩衝的話會 warn,不影響其他功能。)
    this.startReplayBuffer().catch(() => {});

    // 訂閱事件
    obs.on('InputMuteStateChanged', (data) => {
      // data: { inputName, inputMuted }
      this._lastMicInput = data.inputName;  // 記住主播實際切換的麥 input,供 mute_streamer power 用
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
