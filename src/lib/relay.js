// =====================================================
// relay.js — OBS ↔ Cloud 訊息雙向轉發
// =====================================================
// 設計:obsClient 跟 cloudClient 都是 EventEmitter,relay 把它們串起來。
//   OBS event 'mic.state' / 'obs.scene_changed' → 轉送 cloud
//   Cloud message 'tts.say' / 'obs.set_scene'   → 執行 OBS 動作 / 等之後 TTS
// =====================================================

class Relay {
  constructor({ obs, cloud, onLog }) {
    this.obs = obs;
    this.cloud = cloud;
    this.onLog = onLog || (() => {});
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
      } else if (msg.type === 'tts.say') {
        // TODO Phase 4:呼叫 TTS engine
        this.onLog({ level: 'info', msg: `relay ← cloud: tts.say "${(msg.text || '').slice(0, 60)}"(TTS 未實作)` });
      }
    });
  }
}

module.exports = { Relay };
