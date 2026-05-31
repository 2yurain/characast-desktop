# CharaCast Desktop

> Bridge between [CharaCast cloud](https://characast-core.onrender.com) and local OBS Studio.
> 解決雲端 bot 無法直連主播本地 OBS / TTS / VTube Studio 的問題。

Electron app,跑在主播電腦上,雙向連兩條 WebSocket:
- ↑ **CharaCast Cloud**(`wss://characast-core.onrender.com/api/v1/desktop/ws`)
- ↓ **本機 OBS WebSocket**(`ws://localhost:4455`)

## 路線

```
Phase 1 (server side, in characast-core repo)     ✅ done
  └─ /api/v1/desktop/ws WebSocket endpoint + pair code

Phase 2 (this repo, MVP)                          ✅ current
  ├─ Electron 框架
  ├─ 連 OBS WebSocket localhost:4455
  ├─ 連 CharaCast cloud /desktop/ws
  ├─ 配對(主播後台拿 6 位碼 → desktop 輸入 → 換 token)
  ├─ 自動重連 + log
  └─ 雙向 relay:OBS event ↔ cloud message

Phase 3 (next)
  ├─ 麥靜音事件 → cloud bot 觸發 AFK 撐場
  ├─ Scene change → 通知 cloud
  └─ Cloud bot 控制本機 OBS(切場景 / 切音源)

Phase 4
  ├─ TTS 引擎(Azure / OpenAI)
  ├─ VTube Studio 整合(表情 / 嘴形)
  └─ Auto-update
```

## Run dev

```bash
cd characast-desktop
npm install
npm start
```

第一次開啟:輸入配對碼。

### 拿配對碼步驟

1. 上 https://characast-core.onrender.com/app.html 登入
2. 找「🖥️ Desktop Client(OBS / 麥靜音 / TTS)」面板
3. 點「產生配對碼」→ 6 位大字會出現(K2P7AB 之類)
4. 回 desktop 視窗輸入

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

### Server → Client
- `{ type: 'auth.ok' | 'auth.fail' }` 認證結果
- `{ type: 'ping' }` 心跳
- `{ type: 'tts.say', text }` 要 client 播 TTS(Phase 4 實作)
- `{ type: 'obs.set_scene', scene }` 切場景

## 結構

```
characast-desktop/
├─ src/
│  ├─ main.js                # Electron main process
│  ├─ preload.js             # IPC bridge to renderer
│  ├─ lib/
│  │  ├─ settings.js         # electron-store 設定(token / OBS config)
│  │  ├─ cloudClient.js      # CharaCast cloud WebSocket(認證 + 重連)
│  │  ├─ obsClient.js        # OBS WebSocket(訂閱事件 + 重連)
│  │  └─ relay.js            # OBS event ↔ Cloud message 雙向轉發
│  └─ renderer/
│     ├─ index.html          # Pair view + Status view + Settings + Log
│     ├─ app.js              # 用 window.characast IPC 跟 main 通
│     └─ styles.css
├─ assets/                   # icon(待補)
├─ package.json              # Electron + electron-builder + obs-websocket-js + ws
└─ README.md
```

## License

UNLICENSED — 內部產品,不對外散布原始碼。
