# CharaCast Desktop

把 [CharaCast](https://characast.co) 連到你本機的 OBS Studio / VTube Studio / 麥克風 / TTS 的橋接程式。雲端 bot 沒辦法直接碰你電腦上的軟體,由這支桌面程式代勞。

## 下載安裝

到 [Releases](https://github.com/2yurain/characast-desktop/releases/latest) 下載最新版安裝檔，裝好後會自動更新。

> 未簽章,Windows SmartScreen 跳警告時點「更多資訊 → 仍要執行」。

## 第一次設定

1. 上 [characast.co/app.html](https://characast.co/app.html) 登入
2. 找「🖥️ Desktop Client」面板 → 點「產生配對碼」(6 位大字)
3. 回桌面程式輸入配對碼

### OBS

OBS → 工具 → WebSocket Server Settings → 勾 Enable WebSocket Server，把密碼填進桌面程式。預設 port 4455。

## License

UNLICENSED — 內部產品,不對外散布原始碼。
