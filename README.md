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

## 唱歌整合 · 0.1.75

「唱歌」分頁整合點唱清單、正在唱、共鳴及既有歌唱陪練。

1. 完成配對並連接 OBS；共鳴、點唱與歌名畫面需 Pro 以上方案。
2. 若要同步播放器，在「正在唱」勾選偵測（Windows PotPlayer／VLC）。只讀視窗標題，不傳伴奏或聲音；預設關閉，建議檔名為 `歌名 - 原唱.mp3`。
3. 雲端後台 → OBS 畫面 →「正在唱」複製網址，新增 OBS 瀏覽器來源（1920 × 1080）。新建立的「唱歌」場景會自帶歌名，既有同名場景不自動更動。
4. 後台手動指定優先於播放器，再來是點唱清單。按「回到自動」取消手動覆蓋；關掉偵測會清除播放器歌名，最後一台桌面斷線也會回到點唱清單。

暫停播放不會清除歌名；視窗標題無法確認是否正在發聲。多個播放器同時開啟時按程序名稱與 ID 選第一個，建議只開一個或在後台手動指定。中文標題使用 UTF-8 讀取。

共鳴僅傳音高／能量／明亮度數值；歌唱陪練仍是使用者按下送出才上傳錄音的獨立功能。

## License

UNLICENSED — 內部產品,不對外散布原始碼。
