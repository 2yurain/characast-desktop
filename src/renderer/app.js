// =====================================================
// app.js — Renderer 邏輯(透過 window.characast IPC bridge)
// =====================================================

const $ = (id) => document.getElementById(id);

// ============== View 切換 ==============
async function applyView() {
  const status = await window.characast.getStatus();
  const hasToken = status.hasToken;
  $('view-pair').style.display = hasToken ? 'none' : '';
  $('view-status').style.display = hasToken ? '' : 'none';
  if (hasToken) {
    await refreshStatusCards(status);
    await fillSettingsForm();
  }
}

// ============== Pair view ==============
$('pair-btn').addEventListener('click', async () => {
  const code = $('pair-input').value.trim().toUpperCase();
  const msg = $('pair-msg'); msg.style.display = 'none';
  if (code.length !== 6) {
    msg.className = 'msg err'; msg.textContent = '配對碼是 6 位'; msg.style.display = '';
    return;
  }
  $('pair-btn').disabled = true; $('pair-btn').textContent = '配對中…';
  const r = await window.characast.exchangePairCode(code);
  $('pair-btn').disabled = false; $('pair-btn').textContent = '配對';
  if (r.ok) {
    msg.className = 'msg ok'; msg.textContent = `✓ 配對成功(${r.email || ''}),已自動連線`; msg.style.display = '';
    setTimeout(() => applyView(), 1000);
  } else {
    msg.className = 'msg err'; msg.textContent = '失敗:' + r.error; msg.style.display = '';
  }
});

$('pair-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('pair-btn').click();
});

// ============== Status view ==============
function fmtTime(iso) {
  if (!iso) return '從未連線';
  const d = new Date(iso);
  return d.toLocaleString();
}

function setPill(el, state, label) {
  el.className = 'card-pill ' + state;
  el.textContent = label;
}

async function refreshStatusCards(s) {
  if (!s) s = await window.characast.getStatus();
  // Cloud
  if (s.cloud.authed) setPill($('cloud-pill'), 'connected', '🟢 已連線 + 認證');
  else if (s.cloud.readyState === 1) setPill($('cloud-pill'), 'connecting', '🟡 認證中');
  else if (s.cloud.readyState === 0) setPill($('cloud-pill'), 'connecting', '🟡 連線中');
  else setPill($('cloud-pill'), 'error', `🔴 斷線(重試 ${s.cloud.reconnectAttempt})`);
  $('cloud-meta').textContent = s.cloud.connectedAt ? `已連 ${fmtTime(s.cloud.connectedAt)}` : '';

  // OBS
  const card = $('obs-card');
  if (s.obs.connected) {
    setPill($('obs-pill'), 'connected', '🟢 已連線');
    card.classList.remove('error-state');
    $('obs-hint-link').style.display = 'none';
  } else {
    setPill($('obs-pill'), 'error', `🔴 斷線(重試 ${s.obs.reconnectAttempt})`);
    card.classList.add('error-state');
    $('obs-hint-link').style.display = '';
  }
  $('obs-meta').textContent = s.obs.config ? `${s.obs.config.host}:${s.obs.config.port}` : '';
}

// 點「→ 怎麼設定 OBS?」切到 OBS tab + 捲到 howto
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'obs-hint-link') {
    e.preventDefault();
    switchTab('obs');
    setTimeout(() => {
      const h = document.querySelector('.howto');
      h?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }
});

// Tab 切換
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.tab === name));
}
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

window.characast.onStatus((s) => {
  refreshStatusCards(s);
  // 同步更新帳號 tab 的狀態
  const accEl = $('account-status');
  if (accEl) {
    if (s.cloud.authed) accEl.textContent = '✓ 已連線 + 認證';
    else if (s.hasToken) accEl.textContent = '已配對(連線中…)';
    else accEl.textContent = '未配對';
  }
});

$('cloud-reconnect').addEventListener('click', () => window.characast.reconnectCloud());
$('obs-reconnect').addEventListener('click', () => window.characast.reconnectObs());

// ============== Settings ==============
async function fillSettingsForm() {
  const s = await window.characast.getSettings();
  $('obs-host').value = s.obs?.host || 'localhost';
  $('obs-port').value = s.obs?.port || 4455;
  $('obs-password').value = s.obs?.password || '';
  $('cloud-url').value = s.cloudUrl || '';
  $('cloud-https-url').value = s.cloudHttpsUrl || '';
  // 帳號 tab:顯示「已配對」狀態
  const status = await window.characast.getStatus();
  const accEl = $('account-status');
  if (accEl) {
    if (status.cloud.authed) accEl.textContent = '✓ 已連線 + 認證';
    else if (status.hasToken) accEl.textContent = '已配對(連線中…)';
    else accEl.textContent = '未配對';
  }
}

$('obs-save').addEventListener('click', async () => {
  await window.characast.setSettings({
    obs: {
      host: $('obs-host').value.trim() || 'localhost',
      port: Number($('obs-port').value) || 4455,
      password: $('obs-password').value,
    },
  });
  window.characast.reconnectObs();
});

$('cloud-save').addEventListener('click', async () => {
  await window.characast.setSettings({
    cloudUrl: $('cloud-url').value.trim(),
    cloudHttpsUrl: $('cloud-https-url').value.trim(),
  });
  window.characast.reconnectCloud();
});

$('revoke-btn').addEventListener('click', async () => {
  if (!confirm('撤銷本機配對?之後要重新輸入配對碼。')) return;
  await window.characast.revokePair();
  applyView();
});

// ============== Logs ==============
function appendLog(entry) {
  const list = $('log-list');
  const div = document.createElement('div');
  div.className = `log-entry ${entry.level}`;
  const ts = new Date(entry.ts).toLocaleTimeString();
  div.innerHTML = `<span class="ts">${ts}</span><span class="lvl">[${entry.level}]</span> ${escapeHtml(entry.msg)}`;
  list.appendChild(div);
  // cap to 200
  while (list.children.length > 200) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}
function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

window.characast.onLog(appendLog);

// ============== TTS 播音(Web Speech API)==============
// renderer 直接寫進 log 面板(跟 main 來的 log 共用 appendLog),測試時看得到狀態
function ttsLog(level, msg) {
  appendLog({ ts: Date.now(), level, msg: `[tts] ${msg}` });
}

let _availableVoices = [];
function refreshVoices() {
  _availableVoices = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
}
if (window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
} else {
  ttsLog('err', '此環境不支援 speechSynthesis');
}

// Chromium 自動播放政策:speak() 在使用者手勢前會被擋(onerror=not-allowed),且靜默。
// 任何一次使用者互動就 prime 一發靜音 utterance 解鎖,之後 cloud 推來的才播得出。
let _ttsUnlocked = false;
function unlockTts(reason) {
  if (_ttsUnlocked || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    _ttsUnlocked = true;
    ttsLog('info', `語音已解鎖(${reason})`);
    const st = $('tts-status'); if (st) st.textContent = '✓ 語音已啟用';
  } catch (e) {
    ttsLog('err', `解鎖失敗:${e.message}`);
  }
}
// fallback:第一次任何點擊 / 按鍵都嘗試解鎖
document.addEventListener('click', () => unlockTts('click'));
document.addEventListener('keydown', () => unlockTts('keydown'));

// 防止 utterance 在開播前被 GC(Chromium 已知 bug → 會完全沒聲音)
const _keepAlive = new Set();

function pickVoice(voice) {
  if (voice) {
    return _availableVoices.find((vv) => vv.name === voice)
        || _availableVoices.find((vv) => vv.name.toLowerCase().includes(String(voice).toLowerCase()))
        || null;
  }
  return _availableVoices.find((vv) => /zh[-_](TW|Hant)/i.test(vv.lang))
      || _availableVoices.find((vv) => /^zh/i.test(vv.lang))
      || null;
}

function speak({ text, voice, rate, pitch }) {
  if (!window.speechSynthesis) { ttsLog('err', '不支援 speechSynthesis'); return; }
  if (!text) return;
  if (!_availableVoices.length) refreshVoices();

  try { window.speechSynthesis.cancel(); } catch {}
  try { window.speechSynthesis.resume(); } catch {}  // Chromium 有時卡在 paused

  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = Number(rate) || 1.0;
  u.pitch = Number(pitch) || 1.0;
  u.volume = 1.0;
  const v = pickVoice(voice);
  if (v) { u.voice = v; u.lang = v.lang; }
  else u.lang = 'zh-TW';  // 沒匹配到 voice 也給 lang,讓引擎自己挑中文

  u.onstart = () => ttsLog('info', `開始播:voice="${u.voice?.name || u.lang}" "${String(text).slice(0, 30)}"`);
  u.onend = () => { _keepAlive.delete(u); };
  u.onerror = (e) => {
    _keepAlive.delete(u);
    const err = (e && e.error) || 'unknown';
    const hint = err === 'not-allowed' ? '(瀏覽器政策:先點一下視窗任意處或「🔊 啟用語音」鈕)' : '';
    ttsLog('err', `播放失敗:${err}${hint}`);
  };

  _keepAlive.add(u);
  if (!_availableVoices.length) ttsLog('warn', 'voices 清單為空 — 系統可能沒裝語音引擎(getVoices()=0)');
  window.speechSynthesis.speak(u);
}

window.characast.onTts((msg) => {
  ttsLog('info', `收到 tts.say "${String(msg.text || '').slice(0, 30)}"`);
  speak({ text: msg.text, voice: msg.voice, rate: msg.rate, pitch: msg.pitch });
});

// 「🔊 啟用語音」+「測試播放」按鈕
$('tts-enable')?.addEventListener('click', () => {
  unlockTts('按鈕');
  refreshVoices();
  const names = _availableVoices.slice(0, 4).map((v) => `${v.name}(${v.lang})`).join(', ');
  ttsLog('info', `可用 voices=${_availableVoices.length}${names ? ' — ' + names + '…' : '(空!沒有語音引擎)'}`);
});
$('tts-test')?.addEventListener('click', () => {
  speak({ text: '凌小夏語音測試,主人聽得到嗎?', rate: 1.0, pitch: 1.0 });
});

// init
(async () => {
  await applyView();
  const recent = await window.characast.getRecentLogs();
  for (const e of recent) appendLog(e);
})();
