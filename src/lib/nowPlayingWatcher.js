// =====================================================
// nowPlayingWatcher.js — 正在唱:偵測播放器視窗標題(= 伴奏檔名)
// =====================================================
// 主播用 PotPlayer / VLC 放伴奏時,視窗標題就是檔名(例:「沒那麼簡單 - 黃小琥.mp3 - PotPlayer」)。
// 這裡每隔幾秒讀一次標題,有變才 emit('change', raw);雲端 nowPlaying.parseMediaTitle 負責拆歌名 / 原唱。
// 只讀標題、不讀檔案內容、不碰播放器;僅 Windows(用內建 tasklist,不需額外套件)。
// 播放器關掉 / 沒在播 → 連續兩次抓不到才 emit('change', '')(避免換歌瞬間閃空)。
// =====================================================

const { execFile } = require('child_process');
const EventEmitter = require('events');

const PLAYERS = ['PotPlayerMini64.exe', 'PotPlayer64.exe', 'PotPlayerMini.exe', 'PotPlayer.exe', 'vlc.exe'];
// 播放器閒置時的標題(只有播放器名) → 視同沒在播
const IDLE_TITLES = /^(PotPlayer|VLC media player|N\/A|OleMainThreadWndName)$/i;

/** 解析 `tasklist /v /fo csv /nh` 的輸出 → 視窗標題陣列(最後一欄) */
function parseTasklistCsv(out) {
  const titles = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    if (!line.startsWith('"')) continue;            // 「資訊: 沒有執行中的工作」之類的訊息列
    const cols = line.slice(1, -1).split('","');
    const title = (cols[cols.length - 1] || '').trim();
    if (title && !IDLE_TITLES.test(title)) titles.push(title);
  }
  return titles;
}

class NowPlayingWatcher extends EventEmitter {
  constructor({ intervalMs = 2000, exec = execFile, platform = process.platform, players = PLAYERS } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.exec = exec;
    this.platform = platform;
    this.players = players;
    this.timer = null;
    this.current = '';      // 目前回報出去的標題('' = 沒在播)
    this.misses = 0;
    this.busy = false;
    this.generation = 0;
  }

  start() {
    if (this.timer || this.platform !== 'win32') return false;
    this.timer = setInterval(() => this._tick(), this.intervalMs);
    this.timer.unref?.();
    this._tick();
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.generation++;
    this.misses = 0;
    if (this.current) { this.current = ''; this.emit('change', ''); }
  }

  _readTitle() {
    return new Promise((resolve) => {
      // 明確使用 UTF-8，避免 tasklist 在繁中 Windows 的 OEM 編碼造成歌名亂碼。
      // 名單只接受執行檔名稱字元；一次讀所有播放器，避免每輪開五個程序。
      const names = this.players.map((p) => p.replace(/\.exe$/i, '')).filter((p) => /^[a-z0-9]+$/i.test(p));
      if (!names.length) return resolve([]);
      const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-Process -Name ${names.join(',')} -ErrorAction SilentlyContinue | Sort-Object ProcessName,Id | ForEach-Object { $_.MainWindowTitle } | Where-Object { $_ }) | ConvertTo-Json -Compress`;
      this.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 5000, encoding: 'utf8' },
        (err, stdout) => {
          if (err) return resolve([]);
          try {
            const value = JSON.parse(String(stdout).replace(/^\uFEFF/, ''));
            resolve((Array.isArray(value) ? value : [value]).filter((t) => typeof t === 'string' && t.trim() && !IDLE_TITLES.test(t.trim())));
          } catch { resolve([]); }
        });
    });
  }

  async _tick() {
    if (this.busy) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const titles = await this._readTitle();
      if (generation !== this.generation) return;
      const title = titles[0] || '';
      if (title) {
        this.misses = 0;
        if (title !== this.current) { this.current = title; this.emit('change', title); }
      } else if (this.current && ++this.misses >= 2) {
        this.current = ''; this.misses = 0; this.emit('change', '');
      }
    } catch (e) {
      this.emit('log', { level: 'warn', msg: `正在唱偵測失敗:${e.message}` });
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { NowPlayingWatcher, parseTasklistCsv, PLAYERS };
