// =====================================================
// relay.js — OBS ↔ Cloud 訊息雙向轉發
// =====================================================
// 設計:obsClient 跟 cloudClient 都是 EventEmitter,relay 把它們串起來。
//   OBS event 'mic.state' / 'obs.scene_changed' → 轉送 cloud
//   Cloud message 'tts.say' / 'obs.set_scene'   → 執行 OBS 動作 / 等之後 TTS
// =====================================================

class Relay {
  constructor({ obs, cloud, onLog, onTts }) {
    this.obs = obs;
    this.cloud = cloud;
    this.onLog = onLog || (() => {});
    this.onTts = onTts || (() => {});
    this._micMutedSince = null;
  }

  start() {
    // OBS → Cloud
    this.obs.on('event', (ev) => {
      if (!this.cloud.isConnected()) return;
      if (ev.type === 'mic.state') {
        // 只關注「麥克風」類 input,過濾掉桌面音訊等(粗判:有 mic/麥/voice 字眼 OR 第一個 input)
        // 簡化:全部 input 轉送,cloud 端再判斷
        const now = Date.now();
        let durationSeconds = 0;
        if (ev.muted) {
          this._micMutedSince = now;
        } else if (this._micMutedSince) {
          durationSeconds = Math.round((now - this._micMutedSince) / 1000);
          this._micMutedSince = null;
        }
        this.cloud.send({
          type: 'mic.state',
          inputName: ev.inputName,
          muted: ev.muted,
          durationSeconds,
        });
        this.onLog({ level: 'info', msg: `relay → cloud: mic.state ${ev.inputName} muted=${ev.muted}` });
      } else if (ev.type === 'obs.scene_changed') {
        this.cloud.send({ type: 'obs.scene_changed', scene: ev.scene });
        this.onLog({ level: 'info', msg: `relay → cloud: scene ${ev.scene}` });
      } else if (ev.type === 'obs.stream_state') {
        this.cloud.send({ type: 'obs.stream_state', active: ev.active, state: ev.state });
        this.onLog({ level: 'info', msg: `relay → cloud: stream ${ev.state}` });
      }
    });

    // Cloud → OBS
    this.cloud.on('message', async (msg) => {
      if (msg.type === 'obs.set_scene') {
        const ok = await this.obs.setScene(msg.scene);
        this.onLog({ level: 'info', msg: `relay ← cloud: set_scene ${msg.scene} ${ok ? 'OK' : 'FAIL'}` });
      } else if (msg.type === 'mic.mute') {
        // 觀眾用 power「閉麥主播」→ 本機 OBS 把麥靜音 N 秒後自動解除
        const r = await this.obs.muteMicFor(msg.seconds, msg.inputName);
        this.onLog({ level: r.ok ? 'info' : 'warn', msg: `relay ← cloud: mic.mute ${msg.seconds}s ${r.ok ? 'OK ' + r.name : 'FAIL ' + r.reason}` });
      } else if (msg.type === 'clip.replay') {
        // 雲端叫本機 OBS 存重播緩存(高畫質本地剪輯);category 會寫進檔名
        this.onLog({ level: 'info', msg: `relay ← cloud: clip.replay 【${msg.category || '精華'}】${msg.requester || ''}` });
        const r = await this.obs.saveReplay(msg.category, msg.requester);
        this.onLog({ level: r.ok ? 'info' : 'err', msg: `重播剪輯 ${r.ok ? '成功 → ' + (r.path || '') : '失敗:' + (r.reason || '')}` });
      } else if (msg.type === 'tts.say' || msg.type === 'tts.audio') {
        // tts.say  = Web Speech(client 端合成);tts.audio = Azure 雲端合成的 mp3
        const detail = msg.type === 'tts.audio'
          ? `${Math.round((msg.audioBase64 || '').length * 0.75 / 1024)}KB mp3`
          : `"${(msg.text || '').slice(0, 60)}"`;
        this.onLog({ level: 'info', msg: `relay ← cloud: ${msg.type} ${detail}` });
        this.onTts?.(msg);
      }
    });
  }
}

module.exports = { Relay };
