# CharaCast Desktop

> Bridge between [CharaCast cloud](https://characast.co) and local OBS Studio.
> 解決雲端 bot 無法直連主播本地 OBS / TTS / VTube Studio / 麥克風的問題。

Electron app,跑在主播電腦上,雙向連兩條 WebSocket:
- ↑ **CharaCast Cloud**(`wss://characast.co/api/v1/desktop/ws`)
- ↓ **本機 OBS WebSocket**(`ws://localhost:4455`)

## 路線

```
Phase 1 (server side, in characast repo)          ✅ done
  └─ /api/v1/desktop/ws WebSocket endpoint + pair code

Phase 2 (Electron 框架)                            ✅ done
  ├─ 連 OBS WebSocket + CharaCast cloud /desktop/ws
  ├─ 配對(後台 6 位碼 → desktop → 換 token,token OS 加密存)
  └─ 自動重連 + log + 雙向 relay

Phase 3 (本機 ↔ cloud 互動)                         ✅ done
  ├─ 麥靜音事件 → cloud bot 觸發 AFK 撐場
  ├─ Scene / stream 狀態 → 通知 cloud
  └─ Cloud 控制本機 OBS(閉麥主播 power / 存重播剪輯)

Phase 4 (媒體)                                     ✅ done
  ├─ TTS 播放(Web Speech + Azure mp3,驅動 VTS 嘴型)
  ├─ VTube Studio(情緒 → 表情 hotkey + 嘴型)
  ├─ 🎤 歌聲共鳴:抓麥偵測 F0 音高 → cloud → OBS overlay
  └─ Auto-update(electron-updater,GitHub Releases)
```

## Run dev

```bash
cd characast-desktop
npm install
npm start
```

第一次開啟:輸入配對碼。

### 拿配對碼步驟

1. 上 https://characast.co/app.html 登入
2. 找「🖥️ Desktop Client(OBS / 麥靜音 / TTS)」面板
3. 點「產生配對碼」→ 6 位大字會出現(K2P7AB 之類)
4. 回 desktop 視窗輸入

> 註:cloud 位址白名單只放行 `characast.co`。舊版裝置存著 `characast-core.onrender.com`
> 會在開機時自動遷移成 `characast.co`(見 `settings.migrateCloudUrls`)。

### OBS 設定

需要 OBS Studio 已安裝且開啟 WebSocket:
- OBS → 工具 → WebSocket Server Settings → Enable WebSocket Server
- 預設 port 4455
- 可設密碼(desktop 填入)

## Build 打包

```bash
npm run build:win      # Windows .exe (NSIS installer)
npm run build:mac      # macOS .dmg
npm run build:linux    # Linux AppImage
```

輸出在 `dist/`。

## 訊息協議(跟 cloud 之間)

### Client → Server
- `{ type: 'hello', desktopToken }`(連上必送,認證)
- `{ type: 'pong' }` 心跳回應
- `{ type: 'mic.state', inputName, muted, durationSeconds }` 麥靜音變動
- `{ type: 'obs.scene_changed', scene }` 場景切換
- `{ type: 'obs.stream_state', active, state }` 開/停 stream
- `{ type: 'resonance', energy, freq }` 歌聲共鳴 音高 F0(高頻 ~12/s,雲端轉發給 OBS overlay)

### Server → Client
- `{ type: 'auth.ok' | 'auth.fail' }` 認證結果
- `{ type: 'ping' }` 心跳
- `{ type: 'tts.say', text }` / `{ type: 'tts.audio', audioBase64, mime }` 播 TTS
- `{ type: 'obs.set_scene', scene }` 切場景
- `{ type: 'mic.mute', seconds, inputName? }` 閉麥主播 power
- `{ type: 'clip.replay', category, requester }` 存重播剪輯

## 結構

```
characast-desktop/
├─ src/
│  ├─ main.js                # Electron main process
│  ├─ preload.js             # IPC bridge to renderer
│  ├─ lib/
│  │  ├─ settings.js         # electron-store 設定(token/OBS/VTS,機密 OS 加密)
│  │  ├─ cloudClient.js      # CharaCast cloud WebSocket(認證 + 重連)
│  │  ├─ obsClient.js        # OBS WebSocket(訂閱事件 + 控制 + 重連)
│  │  ├─ vtsClient.js        # VTube Studio(表情 hotkey + 嘴型)
│  │  └─ relay.js            # OBS event ↔ Cloud message 雙向轉發
│  └─ renderer/
│     ├─ index.html          # Pair / Status / OBS / VTuber / 歌聲共鳴 / Log
│     ├─ app.js              # IPC + TTS 播放 + 歌聲共鳴抓麥(F0)
│     └─ styles.css
├─ assets/                   # icon(待補)
├─ package.json              # Electron + electron-builder + obs-websocket-js + ws
└─ README.md
```

## License

UNLICENSED — 內部產品,不對外散布原始碼。
