// =====================================================
// app.js — Renderer 邏輯(透過 window.characast IPC bridge)
// =====================================================

const $ = (id) => document.getElementById(id);

// 標題列顯示真實版本(不再寫死)
window.characast.getVersion?.().then((v) => {
  const el = $('app-version'); if (el && v) el.textContent = 'v' + v;
}).catch(() => {});

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
  if (s.cloud.authed) setPill($('cloud-pill'), 'connected', '🟢 已連線');
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

  // VTube Studio
  if (s.vts) {
    if (s.vts.authed) setPill($('vts-pill'), 'connected', '🟢 已授權');
    else if (s.vts.connected) setPill($('vts-pill'), 'connecting', '🟡 授權中');
    else setPill($('vts-pill'), 'error', '⚪ 未連線');
    const meta = $('vts-meta'); if (meta) meta.textContent = s.vts.authed ? '表情 + 嘴型已連動' : '在 VTuber 分頁啟用';
  }
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
$('vts-reconnect')?.addEventListener('click', () => window.characast.reconnectVts());

// ============== Settings ==============
async function fillSettingsForm() {
  const s = await window.characast.getSettings();
  $('obs-host').value = s.obs?.host || 'localhost';
  $('obs-port').value = s.obs?.port || 4455;
  $('obs-password').value = s.obs?.password || '';
  $('cloud-url').value = s.cloudUrl || '';
  $('cloud-https-url').value = s.cloudHttpsUrl || '';
  // VTS
  const v = s.vts || {};
  if ($('vts-enabled')) {
    $('vts-enabled').checked = Boolean(v.enabled);
    $('vts-host').value = v.host || 'localhost';
    $('vts-port').value = v.port || 8001;
    // 下拉先放「已存的值」(避免 VTS 還沒連上時被洗掉);連上後 onVtsHotkeys 會補完整清單
    const em = v.emotions || {};
    for (const slot of EMO_SLOTS) {
      const sel = $('vts-emo-' + slot); if (!sel) continue;
      const val = em[slot] || '';
      sel.innerHTML = '<option value="">（不觸發）</option>' + (val ? `<option value="${escAttr(val)}" selected>${escTxt(val)}</option>` : '');
      sel.value = val;
    }
  }
  // 🎤 共用麥克風 + 歌聲共鳴:還原裝置(新 mic 鍵,退回舊 resonance.deviceId)+ 開關
  const r = s.resonance || {};
  const savedDevice = (s.mic && s.mic.deviceId) || r.deviceId || '';
  await micRefreshDevices(savedDevice);
  if ($('reso-enabled')) {
    $('reso-enabled').checked = Boolean(r.enabled);
    if (r.enabled) resoStart();
  }
  paintQuick('qt-reso', '🎵 歌聲共鳴', Boolean(r.enabled));
  // 🧠 讓 AI 聽你說話:還原桌面端開關(無設定 → 預設開)
  _sttLocalOn = s.stt ? Boolean(s.stt.enabled) : true;
  if ($('stt-enabled')) $('stt-enabled').checked = _sttLocalOn;
  paintQuick('qt-stt', '🧠 聽你說話', _sttLocalOn);
  // 🖼️ 讓 AI 看畫面:還原桌面端開關(無設定 → 預設開)+ 載入 Layer 2 校準檔
  _visLocalOn = s.vision ? Boolean(s.vision.enabled) : true;
  if ($('vision-enabled')) $('vision-enabled').checked = _visLocalOn;
  paintQuick('qt-vision', '🖼️ 看畫面', _visLocalOn);
  _visProfiles = (s.visionProfiles && typeof s.visionProfiles === 'object') ? s.visionProfiles : {};
  _visHud = (s.visionHud && typeof s.visionHud === 'object') ? s.visionHud : {};
  // 🎙️ 教練字幕:還原(無設定 → 預設關,因為會顯示在直播畫面上)
  _coachOverlayOn = s.coachOverlay ? Boolean(s.coachOverlay.enabled) : false;
  paintQuick('qt-coach', '🎙️ 教練字幕', _coachOverlayOn);
  // 🎚️ 教練錄音的人聲 / 伴奏增益:還原(每人音訊來源不同,寫死比例不通用 → 各自調)
  if (s.coachLevels) {
    if (Number.isFinite(s.coachLevels.mic)) _micGain = s.coachLevels.mic;
    if (Number.isFinite(s.coachLevels.sys)) _sysGain = s.coachLevels.sys;
  }
  _applyCoachLevelUI();
  // 🔊 AI 語音(設定分頁開關):還原(預設關;開著的話進來點任何地方就解鎖)
  _ttsEnabled = Boolean(s.voice && s.voice.enabled);
  if ($('tts-toggle')) $('tts-toggle').checked = _ttsEnabled;
  const _ttsSt = $('tts-status'); if (_ttsSt) _ttsSt.textContent = _ttsEnabled ? '已開(點任何地方即生效)' : '🔇 已關';
  updateCalUI();

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

$('obs-setup-scenes')?.addEventListener('click', async () => {
  const btn = $('obs-setup-scenes');
  const out = $('scene-result');
  const scenes = [];
  if ($('scene-game').checked) scenes.push('game');
  if ($('scene-chat').checked) scenes.push('chat');
  if ($('scene-sing').checked) scenes.push('sing');
  if ($('scene-rebellion')?.checked) scenes.push('rebellion');
  if (!scenes.length) { out.textContent = '⚠ 至少勾一個場景'; return; }
  btn.disabled = true; out.textContent = '建立中…';
  try {
    const res = await window.characast.setupObsScenes({ scenes });
    if (!res || res.ok === false) {
      out.textContent = '✗ ' + (res?.reason || '失敗');
    } else {
      const made = res.report.filter((r) => r.status === 'created').map((r) => r.scene);
      const skipped = res.report.filter((r) => r.status === 'skipped_exists').map((r) => r.scene);
      let m = made.length ? `✓ 已建:${made.join('、')}` : '';
      if (skipped.length) m += `${m ? ' / ' : ''}已存在跳過:${skipped.join('、')}`;
      out.textContent = m || '✓ 完成';
    }
  } catch (e) {
    out.textContent = '✗ ' + (e.message || e);
  } finally {
    btn.disabled = false;
  }
});

$('cloud-save').addEventListener('click', async () => {
  await window.characast.setSettings({
    cloudUrl: $('cloud-url').value.trim(),
    cloudHttpsUrl: $('cloud-https-url').value.trim(),
  });
  window.characast.reconnectCloud();
});

$('vts-save')?.addEventListener('click', async () => {
  // 保留現有 token(只有「重新授權」會清)
  const cur = (await window.characast.getSettings()).vts || {};
  await window.characast.setSettings({
    vts: {
      enabled: $('vts-enabled').checked,
      host: $('vts-host').value.trim() || 'localhost',
      port: Number($('vts-port').value) || 8001,
      token: cur.token || '',
      emotions: {
        happy: $('vts-emo-happy').value.trim(),
        sad: $('vts-emo-sad').value.trim(),
        surprised: $('vts-emo-surprised').value.trim(),
        teasing: $('vts-emo-teasing').value.trim(),
        rebel: $('vts-emo-rebel').value.trim(),
        neutral: $('vts-emo-neutral').value.trim(),
      },
    },
  });
  window.characast.reconnectVts();
});

$('vts-reauth')?.addEventListener('click', async () => {
  await window.characast.reauthVts();
});
document.querySelectorAll('[data-test-emo]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const r = await window.characast.testVtsExpression(btn.dataset.testEmo);
    if (!r?.ok) alert(`「${btn.textContent.trim()}」還沒填 VTS 表情快捷鍵名稱(或 neutral 也沒填)`);
  });
});
$('vts-test-mouth')?.addEventListener('click', () => window.characast.testVtsMouth());

// ===== VTS 情緒下拉:從模型表情快捷鍵自動配對 =====
const EMO_SLOTS = ['happy', 'sad', 'surprised', 'teasing', 'rebel', 'neutral'];
const EMO_HINTS = {
  happy: /happy|smile|joy|笑|開心|喜|嗨|love/i,
  sad: /sad|cry|tear|哭|難過|傷|淚/i,
  surprised: /surpris|shock|wow|驚|嚇|!/i,
  teasing: /teas|smug|wink|哼|傲|壞|調皮|嘿/i,
  rebel: /angry|mad|rage|fierce|disdain|evil|rebel|兇|怒|火|不屑|叛|嗆|生氣/i,
  neutral: /neutral|default|idle|normal|平常|普通|預設|待機/i,
};
const escTxt = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const escAttr = (s) => escTxt(s).replace(/"/g, '&quot;');

async function populateVtsHotkeys(names) {
  const list = Array.isArray(names) ? names : [];
  const saved = ((await window.characast.getSettings()).vts || {}).emotions || {};
  const set = new Set(list);
  for (const slot of EMO_SLOTS) {
    const sel = $('vts-emo-' + slot); if (!sel) continue;
    let pick = saved[slot] || '';
    if (!pick) { const m = list.find((n) => EMO_HINTS[slot].test(n)); if (m) pick = m; } // 自動猜
    const opts = ['<option value="">（不觸發）</option>'];
    if (pick && !set.has(pick)) opts.push(`<option value="${escAttr(pick)}">${escTxt(pick)}(模型目前沒此快捷鍵)</option>`);
    for (const n of list) opts.push(`<option value="${escAttr(n)}">${escTxt(n)}</option>`);
    sel.innerHTML = opts.join('');
    sel.value = pick;
  }
  const hint = $('vts-hotkey-hint');
  if (hint) hint.textContent = list.length
    ? `讀到 ${list.length} 個表情,已自動配對(可調),記得按「儲存 + 連線」。`
    : '沒讀到快捷鍵 — 先在 VTS 幫表情建快捷鍵,再點「重新讀取表情」。';
}
window.characast.onVtsHotkeys((names) => populateVtsHotkeys(names));
$('vts-refresh-hotkeys')?.addEventListener('click', () => window.characast.refreshVtsHotkeys());

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
  const ts = new Date(entry.ts || Date.now()).toLocaleTimeString();
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
let _ttsEnabled = false;   // 「讓 AI 出聲」總開關(設定分頁,持久化);關 → speak() 直接跳過
function unlockTts(reason) {
  if (_ttsUnlocked || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    _ttsUnlocked = true;
    ttsLog('info', `語音已解鎖(${reason})`);
    const st = $('tts-status'); if (st && _ttsEnabled) st.textContent = '✓ 已啟用';
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

// ===== VTS lip-sync:把 TTS 播放振幅送給 main → 注入 VTS 嘴型 =====
const _amp = (v) => { try { window.characast.ttsAmplitude?.(v); } catch {} };

// Azure <audio>:Web Audio AnalyserNode 取真實振幅
let _audioCtx = null;
function lipSyncFromAudio(a) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    const src = _audioCtx.createMediaElementSource(a);
    const an = _audioCtx.createAnalyser(); an.fftSize = 256;
    src.connect(an); an.connect(_audioCtx.destination);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
      _amp(Math.min(1, Math.sqrt(sum / buf.length) * 3)); // RMS 放大
      if (!a.paused && !a.ended) raf = requestAnimationFrame(tick); else _amp(0);
    };
    a.addEventListener('play', () => { raf = requestAnimationFrame(tick); });
    a.addEventListener('ended', () => { cancelAnimationFrame(raf); _amp(0); });
    a.addEventListener('pause', () => { cancelAnimationFrame(raf); _amp(0); });
  } catch { /* lip-sync 失敗不影響播放 */ }
}

// Web Speech:拿不到音訊串流 → 講話期間用合成抖動驅動嘴型
let _webMouthTimer = null;
function startWebMouth() {
  stopWebMouth();
  _webMouthTimer = setInterval(() => _amp(0.25 + Math.random() * 0.55), 110);
}
function stopWebMouth() {
  if (_webMouthTimer) { clearInterval(_webMouthTimer); _webMouthTimer = null; }
  _amp(0);
}

function speak({ text, voice, rate, pitch }) {
  if (!_ttsEnabled) return;   // 「讓 AI 出聲」關著 → 不播
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

  u.onstart = () => { startWebMouth(); ttsLog('info', `開始播:voice="${u.voice?.name || u.lang}" "${String(text).slice(0, 30)}"`); };
  u.onend = () => { _keepAlive.delete(u); stopWebMouth(); };
  u.onerror = (e) => {
    _keepAlive.delete(u); stopWebMouth();
    const err = (e && e.error) || 'unknown';
    const hint = err === 'not-allowed' ? '(瀏覽器政策:先點一下視窗任意處或「🔊 啟用語音」鈕)' : '';
    ttsLog('err', `播放失敗:${err}${hint}`);
  };

  _keepAlive.add(u);
  if (!_availableVoices.length) ttsLog('warn', 'voices 清單為空 — 系統可能沒裝語音引擎(getVoices()=0)');
  window.speechSynthesis.speak(u);
}

// Azure 雲端合成的 mp3:用 <audio> 播(繞掉 Web Speech 引擎/voices 問題)
let _ttsAudio = null;
function playAudio({ audioBase64, mime }) {
  if (!audioBase64) { ttsLog('err', 'tts.audio 沒有音檔資料'); return; }
  try {
    if (_ttsAudio) { try { _ttsAudio.pause(); } catch {} _ttsAudio = null; }
    const a = new Audio(`data:${mime || 'audio/mpeg'};base64,${audioBase64}`);
    _ttsAudio = a;
    lipSyncFromAudio(a); // VTS 嘴型(真實振幅)
    a.onplay = () => ttsLog('info', 'Azure 音檔開始播');
    a.onended = () => { if (_ttsAudio === a) _ttsAudio = null; };
    a.onerror = () => ttsLog('err', `音檔播放失敗(code=${a.error?.code ?? '?'})`);
    a.play().catch((e) => ttsLog('err', `play() 失敗:${e.message}(可能是自動播放政策 → 先點一下「🔊 啟用語音」)`));
  } catch (e) {
    ttsLog('err', `playAudio 例外:${e.message}`);
  }
}

window.characast.onTts((msg) => {
  if (msg.type === 'tts.audio') {
    ttsLog('info', '收到 tts.audio(Azure mp3)');
    playAudio(msg);
  } else {
    ttsLog('info', `收到 tts.say "${String(msg.text || '').slice(0, 30)}"`);
    speak({ text: msg.text, voice: msg.voice, rate: msg.rate, pitch: msg.pitch });
  }
});

// 「🔊 啟用語音」+「測試播放」按鈕
$('tts-toggle')?.addEventListener('change', (e) => {
  _ttsEnabled = !!e.target.checked;
  window.characast.setSettings({ voice: { enabled: _ttsEnabled } });
  const st = $('tts-status');
  if (_ttsEnabled) {
    unlockTts('開關');
    refreshVoices();
    if (st) st.textContent = _ttsUnlocked ? '✓ 已啟用' : '已開(點任何地方即生效)';
  } else {
    try { window.speechSynthesis.cancel(); } catch {}
    if (st) st.textContent = '🔇 已關';
  }
});
$('tts-test')?.addEventListener('click', () => {
  if (!_ttsEnabled) { const st = $('tts-status'); if (st) st.textContent = '先把上面開關打開'; return; }
  speak({ text: '凌小夏語音測試,主人聽得到嗎?', rate: 1.0, pitch: 1.0 });
});

// ============== 🎤 歌聲共鳴(抓麥 → 推 OBS overlay)==============
// OBS 拿不到麥 → 由這裡(renderer 有完整 getUserMedia)抓麥、偵測真實音高(F0,自相關)+ 響度,
// 用 IPC 送 { energy, freq } 給 main → cloud → overlay。聲音本機分析,只送數值,不送音檔。
let _resoStream = null, _resoCtx = null, _resoTimer = null;
let _resoEnergy = 0, _resoFreq = 0, _resoCentroid = 0;   // centroid = 共鳴明亮度(胸→頭)

// 歌唱音準累計(成長報告 B 維度)— resonance 開啟期間累計,每窗 flush 給 cloud,flush 後歸零。
// 抗噪三招:① 人聲帶 70–600Hz ② 對近期中位數做八度折回(殺自相關常見的半/倍頻誤判)
//          ③ 半音直方圖取百分位(p10/中位/p90)取代原始 min/max/avg → 不被單一爛 frame 撐爆。
// ⚠ 每窗 flush 後歸零(per-window),不再跨整場累積 —— 否則每首歌都會吃到同一組極值,看起來一模一樣。
const F0_BAND_MIN = 70, F0_BAND_MAX = 600;    // 歌唱人聲帶(含男女 + 假音餘裕);帶外視為八度誤判 / 雜訊
let _pitchN = 0, _pitchVoiced = 0, _pitchStable = 0, _pitchPrevF0 = 0, _pitchFlushTimer = null;
let _pitchHist = new Map();      // 半音直方圖:midi note -> 次數
let _pitchRecent = [];           // 近 ~2s 的 f0,作八度折回的參考中位數
function pitchReset() { _pitchN = 0; _pitchVoiced = 0; _pitchStable = 0; _pitchPrevF0 = 0; _pitchHist = new Map(); _pitchRecent = []; }
function _median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function pitchAccumulate(f0raw) {
  _pitchN++;
  if (!(f0raw > 0)) { _pitchPrevF0 = 0; return; }
  let f0 = f0raw;
  // 八度折回:跟近期中位數差約一個八度 → 折回(autocorr 常把基頻抓成半頻 / 倍頻)
  if (_pitchRecent.length >= 5) {
    const med = _median(_pitchRecent);
    if (med > 0) { while (f0 / med > 1.6) f0 /= 2; while (med / f0 > 1.6) f0 *= 2; }
  }
  if (f0 < F0_BAND_MIN || f0 > F0_BAND_MAX) { _pitchPrevF0 = 0; return; }  // 帶外 → 斷穩定鏈、不計
  _pitchVoiced++;
  const midi = Math.round(69 + 12 * Math.log2(f0 / 440));
  _pitchHist.set(midi, (_pitchHist.get(midi) || 0) + 1);
  // 跟前一幀差 < 50 cents(半個半音內)算「穩」→ 粗略音準穩定度
  if (_pitchPrevF0 > 0 && Math.abs(1200 * Math.log2(f0 / _pitchPrevF0)) < 50) _pitchStable++;
  _pitchPrevF0 = f0;
  _pitchRecent.push(f0); if (_pitchRecent.length > 40) _pitchRecent.shift();   // 50ms × 40 ≈ 近 2s
}
function _histHz(p) {   // 直方圖第 p 百分位 → Hz
  const notes = [..._pitchHist.keys()].sort((a, b) => a - b);
  if (!notes.length) return 0;
  let cum = 0; const target = _pitchVoiced * p;
  for (const n of notes) { cum += _pitchHist.get(n); if (cum >= target) return 440 * Math.pow(2, (n - 69) / 12); }
  return 440 * Math.pow(2, (notes[notes.length - 1] - 69) / 12);
}
function pitchFlush() {
  if (_pitchVoiced >= 20 && _pitchHist.size) {   // 樣本太少不送(避免雜訊)
    try {
      window.characast.sendPitchStats?.({
        samples: _pitchVoiced,
        f0Avg: Math.round(_histHz(0.50)),   // 中位數(抗離群),非算術平均
        f0Min: Math.round(_histHz(0.10)),   // 音域下緣 = p10(不取絕對最低,避免雜訊撐爆)
        f0Max: Math.round(_histHz(0.90)),   // 音域上緣 = p90
        voicedRatio: +(_pitchVoiced / Math.max(1, _pitchN)).toFixed(3),
        stableRatio: +(_pitchStable / Math.max(1, _pitchVoiced)).toFixed(3),
      });
    } catch {}
  }
  pitchReset();   // 每窗送完歸零 → 下一窗只代表那段,讓 cloud 正確歸給「當下那首歌」
}

const RESO_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function freqToNoteName(f) {
  if (!f || f < 20) return '';
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  return RESO_NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// 自相關音高偵測(回傳 Hz,-1 = 無音高)— cwilso 風格 + 邊緣修剪 + 拋物線內插
function resoDetectPitch(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0; for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1; const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
  const b = buf.subarray(r1, r2), n = b.length;
  if (n < 64) return -1;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n - i; j++) s += b[j] * b[j + i]; c[i] = s; }
  let d = 0; while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < n; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
  if (maxpos <= 0) return -1;
  // 信心度:peak 相對零延遲能量(c[0])太低 → 視為無清晰音高(氣音 / 雜訊),不誤當有音
  // 清晰人聲通常 >0.6;雜訊 <0.3。門檻保守取 0.4(太高會把真唱歌也丟掉、樣本不足)。
  if (!(c[0] > 0) || maxval / c[0] < 0.4) return -1;
  let T0 = maxpos;
  const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  if (a) T0 = T0 - bb / (2 * a);
  const f = sampleRate / T0;
  return (f >= 60 && f <= 1200) ? f : -1;
}

function setResoHint(msg) { const h = $('reso-hint'); if (h) h.textContent = msg; }

// 共用麥克風清單(共鳴 + STT 共用 #mic-device)
async function micRefreshDevices(selectedId) {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter((d) => d.kind === 'audioinput');
    const sel = $('mic-device'); if (!sel) return;
    const cur = selectedId != null ? selectedId : sel.value;
    sel.innerHTML = '<option value="">預設麥克風</option>'
      + mics.map((m, i) => `<option value="${escAttr(m.deviceId)}">${escTxt(m.label || ('麥克風 ' + (i + 1)))}</option>`).join('');
    sel.value = cur || '';
  } catch { /* enumerate 失敗就只留「預設」 */ }
}

async function resoStart() {
  if (_resoStream) return;                       // 已在跑
  const deviceId = $('mic-device')?.value || '';
  try {
    _resoStream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    if ($('reso-enabled')) $('reso-enabled').checked = false;
    setResoHint('⚠ 拿不到麥克風:' + (e.message || e));
    _resoStream = null;
    return;
  }
  await micRefreshDevices();                      // 拿到權限後 label 才有值,補一次清單

  _resoCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_resoCtx.state === 'suspended') _resoCtx.resume().catch(() => {});
  const sr = _resoCtx.sampleRate;
  const srcNode = _resoCtx.createMediaStreamSource(_resoStream);
  const an = _resoCtx.createAnalyser();
  an.fftSize = 2048;                       // 2048 取樣 → 可偵測到 ~43Hz 以上(歌唱足夠)
  srcNode.connect(an);
  const buf = new Float32Array(an.fftSize);
  const fd = new Uint8Array(an.frequencyBinCount);
  const binHz = sr / an.fftSize;

  // 音高偵測(自相關)是 O(n²),放在 ~20/s 的計時器跑(不用每幀);送密一點 overlay 才滑順
  _resoTimer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    _resoEnergy += (Math.min(100, rms * 320) - _resoEnergy) * 0.5;
    const f = resoDetectPitch(buf, sr);
    _resoFreq = f > 0 ? f : 0;
    pitchAccumulate(_resoFreq);   // 累計本場音準(成長報告 B 維度)
    // 共鳴明亮度 = 頻譜質心(只在有聲音時更新,靜音時保留上次值不亂跳)
    an.getByteFrequencyData(fd);
    let mag = 0, wsum = 0;
    for (let i = 1; i < fd.length; i++) { const mg = fd[i]; mag += mg; wsum += (i * binHz) * mg; }
    if (rms > 0.012 && mag > 0) _resoCentroid += ((wsum / mag) - _resoCentroid) * 0.3;
    const m = $('reso-meter'); if (m) m.style.width = Math.min(100, _resoEnergy) + '%';
    const note = _resoFreq ? `♪ ${freqToNoteName(_resoFreq)}(${Math.round(_resoFreq)}Hz)` : '靜音中';
    setResoHint(`✓ 歌聲共鳴開啟中 — ${note}`);
    try { window.characast.resonanceData?.({ energy: _resoEnergy, freq: _resoFreq, centroid: Math.round(_resoCentroid) }); } catch {}
  }, 50);
  // 開始累計音準,每 60s flush 一次本場累計給 cloud(寫進當前 session)
  pitchReset();
  _pitchFlushTimer = setInterval(pitchFlush, 60_000);
  setResoHint('✓ 歌聲共鳴開啟中 — 唱歌看 OBS overlay');
}

function resoStop() {
  if (_pitchFlushTimer) { clearInterval(_pitchFlushTimer); _pitchFlushTimer = null; }
  pitchFlush();   // 收尾再送一次本場累計
  if (_resoTimer) { clearInterval(_resoTimer); _resoTimer = null; }
  if (_resoCtx) { try { _resoCtx.close(); } catch {} _resoCtx = null; }
  if (_resoStream) { try { _resoStream.getTracks().forEach((t) => t.stop()); } catch {} _resoStream = null; }
  const m = $('reso-meter'); if (m) m.style.width = '0%';
  _resoEnergy = 0; _resoFreq = 0;
  try { window.characast.resonanceData?.({ energy: 0, freq: 0, centroid: _resoCentroid }); } catch {}  // 推一發歸零讓 overlay 淡出
  setResoHint('已停止。需 cloud 已連線,開啟後唱歌 OBS overlay 就會動。');
}

// =====================================================
// 🎙️ AI 歌聲教練:錄一段清唱 → 降頻成 16k mono WAV → 上傳(只在主播按下時)
// =====================================================
const SINGCOACH_TARGET_SR = 16000, SINGCOACH_MAX_SECONDS = 300, SINGCOACH_MIN_SECONDS = 4;
let _singRec = null;   // 錄音中狀態 { ctx, stream, src, proc, chunks, srcRate, t0, tick };null = 沒在錄
let _heldWav = null;   // 錄完暫存在本地的 WAV(ArrayBuffer);沒按送出/重錄前一直留著(失敗可重送、不用重錄)
let _heldUrl = null;   // 上面那段的 blob URL(給 <audio> 回放)
let _coachOverlayOn = false;   // 「教練字幕」:開 → 教練回饋推到共鳴 overlay 顯示
let _micGain = 2.0, _sysGain = 0.5;   // 教練錄音的人聲 / 伴奏增益(滑桿可調、存設定;每人音訊來源不同)

// 直播字幕只給觀眾一瞥(完整回饋留面板給主播看):去 markdown、取前 1~2 句、上限 ~90 字
function _shortForOverlay(t) {
  let s = String(t || '').replace(/[#*>`_~]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= 90) return s;
  const cut = s.slice(0, 90);
  const p = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('!'), cut.lastIndexOf('?'), cut.lastIndexOf(','));
  return (p > 30 ? cut.slice(0, p + 1) : cut.trim()) + '…';
}

// Float32 chunks(任意 sr)→ 16-bit PCM mono WAV ArrayBuffer。
// targetSr 省略 / >= srcRate → 不降頻(保真,給回放用);給 16000 → 降頻(送 AI 用,夠判音準又小)
function _encodeWav(chunks, srcRate, targetSr) {
  let total = 0; for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let o = 0; for (const c of chunks) { merged.set(c, o); o += c.length; }
  let out, sr;
  if (targetSr && targetSr < srcRate) {
    sr = targetSr;
    const ratio = srcRate / targetSr;            // 降頻(平均法,抗 aliasing)
    const outLen = Math.floor(merged.length / ratio);
    out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio), end = Math.min(merged.length, Math.floor((i + 1) * ratio));
      let s = 0, n = 0; for (let j = start; j < end; j++) { s += merged[j]; n++; }
      const v = n ? s / n : 0;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
  } else {
    sr = srcRate;                                 // 原始取樣率,不降頻(回放才不會悶)
    out = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(merged[i] * 32767)));
  }
  // WAV header(16-bit PCM mono)
  const buf = new ArrayBuffer(44 + out.length * 2), dv = new DataView(buf);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + out.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) dv.setInt16(44 + i * 2, out[i], true);
  return buf;
}

function setSingCoachHint(msg) { const h = $('singcoach-hint'); if (h) { h.textContent = msg; h.style.display = msg ? '' : 'none'; } }
// 唱歌分頁的錄音鈕 + 控制中心的「唱歌教練」兩顆同步(文字 / 禁用)
function _setSingBtns(txt, disabled) {
  for (const id of ['singcoach-btn', 'qt-coachrec']) {
    const b = $(id); if (!b) continue;
    if (txt != null) b.textContent = txt;
    if (disabled != null) b.disabled = disabled;
  }
}

const _mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// 清掉暫存的錄音(換新錄音 / 重錄時),順手釋放 blob URL
function _clearHeldWav() {
  _heldWav = null;
  if (_heldUrl) { try { URL.revokeObjectURL(_heldUrl); } catch {} _heldUrl = null; }
  const pb = $('coach-playback'); if (pb) pb.style.display = 'none';
  const au = $('coach-audio'); if (au) { try { au.pause(); } catch {} au.removeAttribute('src'); }
}

// 按鈕:沒在錄 → 開始;錄音中 → 停止(停止只暫存,不自動送)
function singCoachToggle() {
  if (_singRec) _singCoachStop();
  else _singCoachStart();
}

async function _singCoachStart() {
  const result = $('singcoach-result');
  if (result) result.style.display = 'none';
  _clearHeldWav();   // 開新錄音 → 丟掉上一段暫存
  let stream, ctx;
  try {
    const deviceId = $('mic-device')?.value || '';
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;   // 靜音接 destination,讓 onaudioprocess 觸發又不回授
    const chunks = [];
    proc.onaudioprocess = (ev) => { chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
    // 人聲(mic)—— 增益吃滑桿值(錄音中拉也即時生效,見 _singRec.micGainNode)
    const micGainNode = ctx.createGain(); micGainNode.gain.value = _micGain;
    ctx.createMediaStreamSource(stream).connect(micGainNode).connect(proc);
    // 可選:混入系統音(伴奏)當音準參考 —— 勾「一起收伴奏」才抓;比例由使用者滑桿決定
    let sysStream = null, sysGainNode = null;
    if ($('coach-mix')?.checked) {
      try {
        sysStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        sysStream.getVideoTracks().forEach((t) => t.stop());   // 只要音訊,畫面立刻丟掉
        if (sysStream.getAudioTracks().length) {
          sysGainNode = ctx.createGain(); sysGainNode.gain.value = _sysGain;
          ctx.createMediaStreamSource(sysStream).connect(sysGainNode).connect(proc);
        } else { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
      } catch (e) { setSingCoachHint('(抓不到系統音,改只錄人聲)'); sysStream = null; }
    }
    proc.connect(mute); mute.connect(ctx.destination);
    _singRec = { ctx, stream, sysStream, proc, chunks, srcRate: ctx.sampleRate, t0: Date.now(), tick: null, micGainNode, sysGainNode };
    _setSingBtns('⏹ 停止', false);
    _singRec.tick = setInterval(() => {
      const s = Math.floor((Date.now() - _singRec.t0) / 1000);
      setSingCoachHint(`🔴 錄音中… ${_mmss(s)} —— 唱到想停就按「停止」(上限 ${_mmss(SINGCOACH_MAX_SECONDS)})`);
      if (s >= SINGCOACH_MAX_SECONDS) _singCoachStop();   // 到上限自動停
    }, 500);
  } catch (e) {
    setSingCoachHint('✗ 錄音失敗:' + (e.message || e));
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (ctx) await ctx.close(); } catch {}
    _singRec = null;
  }
}

// 停止 = 收尾錄音 → 編碼成 WAV → 暫存在本地等使用者回放 / 按送出(不自動上傳)
async function _singCoachStop() {
  const rec = _singRec; if (!rec) return;
  _singRec = null;
  if (rec.tick) clearInterval(rec.tick);
  try { rec.proc.disconnect(); } catch {}
  try { rec.stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (rec.sysStream) rec.sysStream.getTracks().forEach((t) => t.stop()); } catch {}
  try { await rec.ctx.close(); } catch {}
  const secs = Math.round((Date.now() - rec.t0) / 1000);
  if (secs < SINGCOACH_MIN_SECONDS) {
    setSingCoachHint(`✗ 太短了(只 ${secs}s),多唱幾句再停`);
    _setSingBtns('🎙️ 開始錄音', false);
    return;
  }
  // 編碼 + 暫存:送 AI 用 16k(夠判音準、payload 小);回放用原始取樣率(音樂才不會悶)
  _heldWav = _encodeWav(rec.chunks, rec.srcRate, SINGCOACH_TARGET_SR);
  const playWav = _encodeWav(rec.chunks, rec.srcRate);   // 不降頻
  if (_heldUrl) { try { URL.revokeObjectURL(_heldUrl); } catch {} }
  _heldUrl = URL.createObjectURL(new Blob([playWav], { type: 'audio/wav' }));
  const au = $('coach-audio'); if (au) au.src = _heldUrl;
  const pb = $('coach-playback'); if (pb) pb.style.display = '';
  const sendBtn = $('coach-send'); if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 送給 AI 聽'; }
  setSingCoachHint(`✓ 錄好了(${_mmss(secs)})—— 可以先▶播放聽聽,按「送給 AI 聽」要回饋`);
  _setSingBtns('🎙️ 重新錄音', false);
}

// 把暫存的 WAV 送上雲(可重複按:503 / 失敗都不用重錄)
async function _singCoachSend() {
  if (!_heldWav) { setSingCoachHint('還沒有錄音,先按「開始錄音」'); return; }
  const result = $('singcoach-result'), sendBtn = $('coach-send');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ 送出中…'; }
  setSingCoachHint('⏳ 上傳給 AI 聽…(約 10~20 秒)');
  try {
    const r = await window.characast.coachSingAudio(_heldWav, ($('coach-song')?.value || '').trim(), ($('coach-question')?.value || '').trim());
    const REASON = { no_gemini: '雲端還沒設定 Gemini 金鑰', plan: '歌聲教練是 Pro 以上方案', no_audio: '沒錄到聲音', gemini_empty: 'AI 沒給出回饋,再按一次送出', aux_budget: '今日 AI 歌聲分析額度用完了,明天再來' };
    if (r?.ok && r.text) {
      setSingCoachHint(r.song ? `✓ 已聽你唱《${r.song}》` : '✓ 回饋來了');
      if (result) { result.textContent = '🎙️ ' + r.text; result.style.display = ''; }
      if (_coachOverlayOn) window.characast.coachToOverlay?.(_shortForOverlay(r.text));   // 開「教練字幕」→ 只推精簡一瞥(完整留面板)
      // 成功也保留錄音與回放,主播可以邊聽錄音邊看建議;要重來就按「重錄」
    } else {
      setSingCoachHint('✗ ' + (REASON[r?.reason] || r?.error || '產不出回饋')+ '(錄音還在,可再按送出)');
    }
  } catch (e) {
    setSingCoachHint('✗ 上傳失敗:' + (e.message || e) + '(錄音還在,可再按送出)');
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 送給 AI 聽'; }
  }
}

async function persistReso() {
  await window.characast.setSettings({ resonance: { enabled: Boolean($('reso-enabled')?.checked) } });
}
async function persistMic() {
  await window.characast.setSettings({ mic: { deviceId: $('mic-device')?.value || '' } });
}

// ⚡ 快速開關(控制中心):跟分頁裡的勾選同一個狀態,兩邊互相同步
function paintQuick(btnId, label, on) {
  const b = $(btnId); if (!b) return;
  b.innerHTML = `${label}　<b style="color:${on ? '#28dc96' : '#999'}">${on ? '開' : '關'}</b>`;
  b.style.cssText = 'padding:9px 14px;border-radius:12px;font-size:13px;cursor:pointer;'
    + 'border:1px solid ' + (on ? 'rgba(40,220,150,.6)' : 'var(--line,#333)') + ';'
    + 'background:' + (on ? 'rgba(40,220,150,.12)' : 'transparent') + ';color:var(--text,#eee)';
}
// 歌聲共鳴:開關單一入口(分頁勾選 + 快速開關都走這)
function setResoEnabled(on) {
  if ($('reso-enabled')) $('reso-enabled').checked = on;
  paintQuick('qt-reso', '🎵 歌聲共鳴', on);
  persistReso();
  if (on) resoStart(); else resoStop();
}

$('reso-enabled')?.addEventListener('change', (e) => setResoEnabled(e.target.checked));
$('qt-reso')?.addEventListener('click', () => setResoEnabled(!$('reso-enabled')?.checked));
$('singcoach-btn')?.addEventListener('click', singCoachToggle);
$('coach-send')?.addEventListener('click', _singCoachSend);
$('coach-rerecord')?.addEventListener('click', () => { if (!_singRec) _singCoachStart(); });

// 🎚️ 人聲 / 伴奏增益滑桿:把目前值寫進滑桿 + 數字標籤(載入設定 / 初始時)
function _applyCoachLevelUI() {
  const mic = $('coach-mic-gain'), sys = $('coach-sys-gain');
  if (mic) { mic.value = _micGain; const l = $('coach-mic-val'); if (l) l.textContent = _micGain.toFixed(1) + '×'; }
  if (sys) { sys.value = _sysGain; const l = $('coach-sys-val'); if (l) l.textContent = _sysGain.toFixed(1) + '×'; }
}
// 滑桿拖動:更新值 + 標籤 + 錄音中即時套用;放開才存設定(避免拖動狂寫)
function _bindCoachLevel(sliderId, valId, which) {
  const sl = $(sliderId); if (!sl) return;
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    if (!Number.isFinite(v)) return;
    if (which === 'mic') { _micGain = v; if (_singRec?.micGainNode) _singRec.micGainNode.gain.value = v; }
    else { _sysGain = v; if (_singRec?.sysGainNode) _singRec.sysGainNode.gain.value = v; }
    const l = $(valId); if (l) l.textContent = v.toFixed(1) + '×';
  });
  sl.addEventListener('change', () => {   // 放開 → 存(write-through,下次開記得)
    window.characast.setSettings({ coachLevels: { mic: _micGain, sys: _sysGain } });
  });
}
_bindCoachLevel('coach-mic-gain', 'coach-mic-val', 'mic');
_bindCoachLevel('coach-sys-gain', 'coach-sys-val', 'sys');
// 🎙️ 教練字幕快速開關:開 → 教練回饋推到共鳴 overlay
function setCoachOverlayOn(on) {
  _coachOverlayOn = Boolean(on);
  paintQuick('qt-coach', '🎙️ 教練字幕', _coachOverlayOn);
  window.characast.setSettings({ coachOverlay: { enabled: _coachOverlayOn } });
}
$('qt-coach')?.addEventListener('click', () => setCoachOverlayOn(!_coachOverlayOn));
// 控制中心快速「唱歌教練」(跟唱歌分頁的錄音鈕共用流程,兩顆標籤同步)
$('qt-coachrec')?.addEventListener('click', singCoachToggle);

// 🎵 點唱歌單(桌面端控制 desktopToken;在「唱歌」分頁刷新)
let _sqEnabled = true;
function renderSq(s) {
  const st = $('sq-status'), list = $('sq-list'), tg = $('sq-toggle');
  if (!st) return;
  if (!s || s.error) {
    st.textContent = (s && /Pro/.test(s.error || '')) ? '點唱需 Pro 以上方案' : ('讀取失敗:' + ((s && s.error) || '未連線'));
    if (list) list.innerHTML = '';
    return;
  }
  _sqEnabled = s.enabled !== false;
  const now = s.nowSinging ? `🎤 唱:${s.nowSinging.song}(${s.nowSinging.requester || ''})` : '目前沒在唱';
  st.textContent = `${_sqEnabled ? '🟢 開放中' : '🔴 已關'} · ${now} · 待唱 ${s.count || 0} 首`;
  if (tg) tg.textContent = _sqEnabled ? '🔴 關閉點唱' : '🟢 開放點唱';
  if (list) {
    list.innerHTML = (s.queue || []).slice(0, 10).map((e) =>
      `${e.pos}. ${escTxt(e.song)} <span style="color:var(--muted,#888)">· ${escTxt(e.requester || '')}</span>`).join('<br>') || '<span class="hint">目前沒有待唱</span>';
  }
}
async function loadSq() { try { renderSq(await window.characast.songQueueGet()); } catch (e) { renderSq({ error: e.message }); } }
async function sqAction(action) { try { renderSq(await window.characast.songQueueAction(action)); } catch (e) { renderSq({ error: e.message }); } }
$('sq-refresh')?.addEventListener('click', loadSq);
$('sq-toggle')?.addEventListener('click', () => sqAction(_sqEnabled ? 'disable' : 'enable'));
$('sq-next')?.addEventListener('click', () => sqAction('next'));
$('sq-skip')?.addEventListener('click', () => sqAction('skip'));
$('sq-clear')?.addEventListener('click', () => { if (confirm('清空整個待唱歌單?')) sqAction('clearAll'); });
document.querySelector('.tab-btn[data-tab="sing"]')?.addEventListener('click', loadSq);
// 在「唱歌」分頁時每 5s 自動刷新(其他分頁不打 cloud)
setInterval(() => { const p = document.querySelector('.tab-pane[data-tab="sing"]'); if (p && p.classList.contains('active')) loadSq(); }, 5000);
// 換共用麥克風 → 存起來,並重啟正在跑的服務(共鳴 + STT)讓它們改吃新麥
$('mic-device')?.addEventListener('change', async () => {
  await persistMic();
  if ($('reso-enabled')?.checked) { resoStop(); resoStart(); }
  if (_sttTier) { const t = _sttTier; stopStt(); startStt(t); }
});
// AudioContext 可能因自動播放政策卡在 suspended,任一次點擊就嘗試恢復
document.addEventListener('click', () => { if (_resoCtx && _resoCtx.state === 'suspended') _resoCtx.resume().catch(() => {}); });

// ============== 🧠 AI 聽得到你(本地 whisper STT,WebGPU)==============
// 後台開「聽得到主播」後,這台用 GPU 本地辨識麥克風,每 ~15s 轉一段 → 只送短文字當脈絡上雲。
// 重活全在桌面端(邊緣),雲端不爆;聲音本機處理,不傳音檔、不存逐字稿。
// transformers.js 從 jsdelivr 載、模型從 HuggingFace 下載(首次)→ CSP 已放行這兩個來源。
// 整體往上一級提升準度:低=base、中=small、高=large-v3-turbo(近 large 準度、turbo 速度;RTX 等級才建議)
const STT_MODELS = { low: 'Xenova/whisper-base', medium: 'Xenova/whisper-small', high: 'onnx-community/whisper-large-v3-turbo' };

// whisper 中文偏簡體 → 轉繁(zh-TW 產品 + 工具關鍵字是繁體,字對上判斷才準)。懶載 opencc,失敗就維持原樣。
let _s2tConv = null, _s2tTried = false;
async function ensureS2T() {
  if (_s2tConv || _s2tTried) return _s2tConv;
  _s2tTried = true;
  try {
    const OpenCC = await import('https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/+esm');
    _s2tConv = OpenCC.Converter({ from: 'cn', to: 'tw' });
    appendLog({ level: 'info', msg: 'STT:簡轉繁(opencc)就緒' });
  } catch (e) { appendLog({ level: 'warn', msg: 'STT:簡轉繁載入失敗,維持原樣(' + e.message + ')' }); _s2tConv = null; }
  return _s2tConv;
}
const STT_MIN_SAMPLES = 6_400;     // < 0.4s 的零碎聲不轉
// VAD(語音活動偵測):偵測到說話才累積,靜下來一段才送辨識 → 省 GPU、句子不被硬切
const VAD_ON_RMS = 0.015;          // 音量超過這個 = 開始說話
const VAD_OFF_RMS = 0.008;         // 低於這個算靜音(留遲滯,避免抖動)
const VAD_HANG_MS = 700;           // 連續靜音這麼久 = 一句講完 → 送辨識
const VAD_MAX_MS = 20_000;         // 一句最長 20s(連續講太久也先送一段)
const VAD_PREROLL = 3;             // 開口前保留幾個音框(~0.8s)避免吃掉第一個字

let _sttTier = null;               // 目前載入的模型等級(null = 未啟用)
let _sttTranscriber = null;
let _sttStream = null, _sttCtx = null, _sttProc = null, _sttSilent = null;
let _sttChunks = [], _sttBusy = false, _sttStarting = false;
let _sttSpeaking = false, _sttSilentMs = 0, _sttPre = [];   // VAD 狀態
let _sttLocalOn = true;   // 桌面端開關(跟後台 AI 感知 AND);預設開,沿用既有行為

function setSttHint(msg) { const h = $('stt-hint'); if (h) h.textContent = msg; }

async function startStt(tier) {
  if (_sttStarting || _sttTier) return;
  _sttStarting = true;
  const model = STT_MODELS[tier] || STT_MODELS.medium;
  try {
    setSttHint('載入語音模型中…(首次會下載,請稍候)');
    appendLog({ level: 'info', msg: `STT:載入函式庫 + 模型(${tier}/${model})…` });
    // /+esm = jsdelivr 打包好的瀏覽器版 ESM(沒這個尾段會拿到無法載入的原始碼)
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
    env.allowLocalModels = false;                 // 只從 HF 抓,不找本機路徑
    // 先試 WebGPU(吃 GPU),失敗(無 WebGPU)再退回 wasm(CPU)
    try {
      // fp32:5080 記憶體夠,fp32 數值最穩(fp16 在部分 GPU 會算出 NaN → 卡住/亂碼)
      _sttTranscriber = await pipeline('automatic-speech-recognition', model, { device: 'webgpu', dtype: 'fp32' });
    } catch (e) {
      appendLog({ level: 'warn', msg: `STT:WebGPU 不可用,改用 CPU(${e.message})` });
      _sttTranscriber = await pipeline('automatic-speech-recognition', model, { device: 'wasm' });
    }

    // 抓麥(跟歌聲共鳴各開各的;裝置用共用的 #mic-device)
    const deviceId = $('mic-device')?.value || '';
    _sttStream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

    appendLog({ level: 'info', msg: 'STT:模型就緒 ✓,開麥中…' });
    // whisper 要 16kHz 單聲道 → 直接開 16k 的 AudioContext,瀏覽器幫忙重取樣
    _sttCtx = new AudioContext({ sampleRate: 16_000 });
    if (_sttCtx.state === 'suspended') await _sttCtx.resume().catch(() => {});
    appendLog({ level: 'info', msg: `STT:AudioContext sr=${_sttCtx.sampleRate} state=${_sttCtx.state}` });
    const src = _sttCtx.createMediaStreamSource(_sttStream);
    _sttProc = _sttCtx.createScriptProcessor(4096, 1, 1);
    _sttSilent = _sttCtx.createGain(); _sttSilent.gain.value = 0;   // 靜音匯流排,避免麥回授到喇叭
    src.connect(_sttProc); _sttProc.connect(_sttSilent); _sttSilent.connect(_sttCtx.destination);
    const sr = _sttCtx.sampleRate;
    _sttProc.onaudioprocess = (e) => {
      if (!_sttTier) return;
      const frame = new Float32Array(e.inputBuffer.getChannelData(0));   // 複製一份(原 buffer 會被重用)
      const frameMs = (frame.length / sr) * 1000;
      let sq = 0; for (let i = 0; i < frame.length; i++) sq += frame[i] * frame[i];
      const rms = Math.sqrt(sq / frame.length);

      if (!_sttSpeaking) {
        // 還沒開口:滾動保留少量 pre-roll;音量一過門檻就進入「說話中」
        _sttPre.push(frame); if (_sttPre.length > VAD_PREROLL) _sttPre.shift();
        if (rms > VAD_ON_RMS) {
          _sttSpeaking = true; _sttSilentMs = 0;
          _sttChunks = _sttPre.slice(); _sttPre = [];      // 把開口前那幾框接上,第一個字不被吃掉
          setSttHint('🎙️ 聽你說話中…');
        }
        return;
      }
      // 說話中:持續累積;靜音累計到 HANG 或講太久 → 收尾送辨識
      _sttChunks.push(frame);
      _sttSilentMs = rms < VAD_OFF_RMS ? _sttSilentMs + frameMs : 0;
      const durMs = _sttChunks.reduce((n, a) => n + a.length, 0) / sr * 1000;
      if (_sttSilentMs >= VAD_HANG_MS || durMs >= VAD_MAX_MS) {
        _sttSpeaking = false; _sttSilentMs = 0;
        flushStt();                                         // 非同步辨識這一句
      }
    };

    _sttTier = tier;
    _sttStarting = false;
    setSttHint('✓ AI 聽得到你了 — 偵測到說話才辨識(本地 GPU)');
    appendLog({ level: 'info', msg: `STT:已啟用(${tier} / ${model},語音偵測模式)` });
  } catch (e) {
    _sttStarting = false;
    stopStt();
    setSttHint('⚠ 語音辨識啟動失敗:' + (e.message || e));
    appendLog({ level: 'err', msg: `STT:啟動失敗 ${e.message || e}` });
  }
}

async function flushStt() {
  if (_sttBusy || !_sttTranscriber || !_sttChunks.length) return;
  _sttBusy = true;
  try {
    const total = _sttChunks.reduce((n, a) => n + a.length, 0);
    const audio = new Float32Array(total);
    let off = 0; for (const a of _sttChunks) { audio.set(a, off); off += a.length; }
    _sttChunks = [];
    if (total < STT_MIN_SAMPLES) return;                        // 太短的零碎聲不轉(VAD 已先擋掉靜音)
    const res = await _sttTranscriber(audio, { language: 'zh', task: 'transcribe' });
    const raw = String(res?.text || '').trim();
    // ① 去掉 whisper 的非語音註記:(咳)(笑)（音樂）[掌聲]【字幕】… 括號內容
    let text = raw.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
                  .replace(/[\s,，、。.!?！?~…]+$/u, '').trim();
    // ①.5 簡轉繁(在幻覺過濾前轉 → HALLUC 繁體規則才對得上)
    const conv = await ensureS2T();
    if (conv && text) { try { text = conv(text); } catch { /* 轉換失敗維持原樣 */ } }
    // ② 幻覺/雜訊過濾:剩太短、沒有任何中英數(純標點)、或 whisper 固定幻覺句 → 丟
    const HALLUC = /^(字幕|請不吝|謝謝(大家)?(觀看|收看)|不吝點贊|請訂閱|下次再見|MING|by )/;
    const hasWord = /[一-鿿a-zA-Z0-9]/.test(text);
    if (text.length > 1 && hasWord && !HALLUC.test(text)) {
      window.characast.sendStreamerSpeech(text);
      appendLog({ level: 'info', msg: `STT 🎙️ 辨識:「${text}」→ 已上雲` });
      setSttHint(`✓ 聽到了:「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」`);
    } else if (raw) {
      appendLog({ level: 'info', msg: `STT:略過非語音/雜訊「${raw.slice(0, 16)}」` });
    }
  } catch (e) {
    appendLog({ level: 'warn', msg: `STT:辨識失敗(略過此段)${e.message || e}` });
  } finally { _sttBusy = false; }
}

function stopStt() {
  _sttTier = null;
  try { _sttProc?.disconnect(); } catch {}
  try { _sttSilent?.disconnect(); } catch {}
  try { _sttStream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { _sttCtx?.close(); } catch {}
  _sttProc = _sttSilent = _sttStream = _sttCtx = null;
  _sttChunks = []; _sttBusy = false;
  _sttSpeaking = false; _sttSilentMs = 0; _sttPre = [];
}

// 跟雲端同步 AI 感知設定:開了就上工、關了就停、換等級就重載模型
let _lastSyncSig = '';
async function syncPerception() {
  let cfg;
  try { cfg = await window.characast.getPerceptionConfig(); } catch { cfg = null; }
  if (!cfg) return;                                     // 雲端還沒連上 → 下次再試
  const tier = cfg.perfTier || 'medium';

  // 診斷:雲端回的設定變了就記一行 → 看後台改的有沒有真的傳到這台、是哪個帳號
  const sig = `${cfg.perfTier}|${cfg.sttEnabled}|${cfg.visionEnabled}|${cfg.game || ''}`;
  if (sig !== _lastSyncSig) {
    _lastSyncSig = sig;
    appendLog({ level: 'info', msg: `感知設定(雲端回):等級=${cfg.perfTier} 聽=${cfg.sttEnabled} 看=${cfg.visionEnabled} 遊戲=${cfg.game || '(無)'}` });
  }

  // 當前遊戲名(刀2)→ Vision 校準用;變了就更新校準 UI
  const g = cfg.game || '';
  if (g !== _currentGame) { _currentGame = g; updateCalUI(); }

  // --- STT(耳朵):桌面開關 AND 後台 AI 感知 ---
  if (_sttLocalOn && cfg.sttEnabled) {
    if (!_sttTier) startStt(tier);
    else if (_sttTier !== tier) { stopStt(); startStt(tier); }   // 後台改效能等級 → 重載
  } else {
    if (_sttTier || _sttStarting) stopStt();
    if (!_sttLocalOn) setSttHint('已關閉 — 打開上面的開關讓 AI 聽你說話');
    else if (!cfg.sttEnabled) setSttHint('桌面端已開,但後台「🧠 AI 感知」尚未開「聽得到主播」');
  }

  // --- Vision(眼睛):桌面開關 AND 後台 AI 感知 ---
  if (_visLocalOn && cfg.visionEnabled) {
    if (!_visTier) startVision(tier);
    else if (_visTier !== tier) { stopVision(); startVision(tier); }
  } else {
    if (_visTier || _visStarting) stopVision();
    if (!_visLocalOn) setVisHint('已關閉 — 打開上面的開關讓 AI 看畫面');
    else if (!cfg.visionEnabled) setVisHint('桌面端已開,但後台「🧠 AI 感知」尚未開「看得到畫面」');
  }
}

// 讓 AI 聽你說話:開關單一入口(分頁勾選 + 快速開關都走這)
function setSttLocalOn(on) {
  _sttLocalOn = on;
  if ($('stt-enabled')) $('stt-enabled').checked = on;
  paintQuick('qt-stt', '🧠 聽你說話', on);
  window.characast.setSettings({ stt: { enabled: on } });
  if (!on && (_sttTier || _sttStarting)) { stopStt(); setSttHint('已關閉 — 打開開關讓 AI 聽你說話'); }
  else syncPerception();
}
$('stt-enabled')?.addEventListener('change', (e) => setSttLocalOn(e.target.checked));
$('qt-stt')?.addEventListener('click', () => setSttLocalOn(!_sttLocalOn));

// ============== 🖼️ 讓 AI 看畫面(Layer 0 差異閘 + Layer 1 本地 CLIP 場景分類)==============
// Layer 0:截 OBS 目前場景縮圖 → 16x16 灰階 average-hash,沒變就跳過(免費、不跑模型)。
// Layer 1:畫面變了才跑 CLIP 零樣本分類(WebGPU 本地)→ 得場景 → 只送短描述上雲。
// 重活全在桌面端;雲端只收「場景:團戰中」這種短文字。未來校準/蒸餾會更省(見藍圖)。
// 零樣本 CLIP 只擅長「粗場景類型」(遊戲/真人/唱歌/桌面),分不出遊戲內細時刻(團戰/結算)——
// 那留給未來「每款遊戲校準」(Layer 2)。遊戲是哪款已由刀2(streamContext.game)補,這裡只認類型。
const VISION_LABELS = [
  { en: 'a screenshot of a video game being played', zh: '玩遊戲中' },
  { en: 'a webcam of a person talking to the camera, just chatting', zh: '聊天/講話' },
  { en: 'a karaoke or music video screen with song lyrics', zh: '唱歌/音樂' },
  { en: 'a be right back, pause, intermission or starting soon screen', zh: '待機(BRB)' },
  { en: 'a computer desktop, web browser or a video player', zh: '桌面/看影片' },
  { en: 'a game loading or matchmaking waiting screen', zh: '載入/等待' },
];
const VISION_TICK_MS = { low: 30_000, medium: 12_000, high: 6_000 };  // 多久檢查一次畫面
const VISION_DIFF = 8;          // average-hash 漢明距離 > 此值 = 畫面變了(才跑 CLIP)
const VISION_MIN_SCORE = 0.30;  // CLIP 信心低於此 → 不送(粗類型通常 60%+,門檻拉高擋亂猜)
const VISION_GAME_LABEL = '玩遊戲中';  // 粗類型是這個 + 有校準檔 → 才細分(Layer 2)
// Layer 2 校準門檻拉高:few-shot CLIP 抓「長相穩定的大事件畫面」可以,抓「行為」(團戰/走位)
// 因環境變數太多會亂猜 → 門檻高一點,不夠像就乖乖回「玩遊戲中」,寧可少報不要報錯。
const VIS_MATCH_MIN = 0.86;

let _visTier = null, _visClassifier = null, _visStarting = false;
let _visTimer = null, _visBusy = false, _visLastHash = null, _visLastLabel = '', _visCanvas = null;
let _visLocalOn = true;
// Layer 2(每款遊戲校準,少樣本 CLIP 原型,本地存)
let _visEmbedder = null, _visEmbedderLoading = null, _visProfiles = {}, _currentGame = '';
// 框選區偵測:每款遊戲一組 zones,兩種偵測法。
//   rate(戰鬥框 / 戰況框):只盯那塊的變化頻率(短時間爆量 = 激戰),不看內容 → 對地圖免疫
//   ocr (人頭比數 / KDA框):讀那塊的數字 → 送「人頭 5:3」這種短文字(重活在桌面端)
const KF_TICK_MS = 2500;        // rate 框掃描頻率
const KF_DIFF = 6;              // 區域 aHash 漢明距離 > 此 = 有事件(那塊變了)
const KF_WINDOW_MS = 14_000;    // 事件統計窗
const KF_HOT = 3;               // 窗內事件數 >= 此 = 激戰(rate)
const OCR_TICK_MS = 3000;       // ocr 框掃描頻率
const OCR_VOTE_WINDOW = 5;      // 看最近幾次讀數
const OCR_VOTE_MIN = 3;         // 同值出現 N 次才送(多數決;不信 tesseract 信心,它對小字常回 0)
const VISION_COMBAT_LABEL = '團戰/戰鬥中';
let _visHud = {}, _kfTimer = null, _kfBusy = false;
let _ocrTimer = null, _ocrBusy = false, _ocrWorker = null, _ocrLoading = null, _ocrLastText = {}, _ocrHist = {};
// 每個 rate zone 各自的變化事件環:{ [zoneId]: { last:hashStr, events:[ts…] } }
let _zoneState = {};
// 框選 UI 暫存:正在拖的框 + 剛拖好待命名的 rect
let _kfDrag = null, _pendingRect = null;

function setVisHint(msg) { const h = $('vision-hint'); if (h) h.textContent = msg; }

async function startVision(tier) {
  if (_visStarting || _visTier) return;
  _visStarting = true;
  try {
    setVisHint('載入畫面模型中…(首次會下載)');
    appendLog({ level: 'info', msg: `Vision:載入 CLIP(${tier})…` });
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
    env.allowLocalModels = false;
    try {
      _visClassifier = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { device: 'webgpu', dtype: 'fp32' });
    } catch (e) {
      appendLog({ level: 'warn', msg: `Vision:WebGPU 不可用,改用 CPU(${e.message})` });
      _visClassifier = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { device: 'wasm' });
    }
    _visTier = tier; _visStarting = false; _visLastHash = null; _visLastLabel = '';
    _visTimer = setInterval(visTick, VISION_TICK_MS[tier] || VISION_TICK_MS.medium);
    _zoneState = {};
    _kfTimer = setInterval(rateTick, KF_TICK_MS);   // rate 框偵測(有框才會動)
    _ocrLastText = {}; _ocrHist = {};
    _ocrTimer = setInterval(ocrTick, OCR_TICK_MS);  // ocr 框讀數字(有框才會動)
    setVisHint('✓ AI 看得到畫面了 — 畫面有變才判斷(本地 GPU)');
    appendLog({ level: 'info', msg: `Vision:已啟用(${tier})` });
  } catch (e) {
    _visStarting = false; stopVision();
    setVisHint('⚠ 看畫面啟動失敗:' + (e.message || e));
    appendLog({ level: 'err', msg: `Vision:啟動失敗 ${e.message || e}` });
  }
}

function _loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
// 把畫面縮到 16x16 灰階 → average-hash(256-bit 字串),拿來比「畫面有沒有變」
async function visHash(dataUrl) {
  const img = await _loadImage(dataUrl);
  const c = _visCanvas || (_visCanvas = document.createElement('canvas'));
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const g = new Float32Array(256); let sum = 0;
  for (let i = 0; i < 256; i++) { const v = d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114; g[i] = v; sum += v; }
  const avg = sum / 256;
  let bits = ''; for (let i = 0; i < 256; i++) bits += g[i] >= avg ? '1' : '0';
  return bits;
}
function _hamming(a, b) { if (!a || !b || a.length !== b.length) return 999; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }

async function visTick() {
  if (_visBusy || !_visClassifier) return;
  _visBusy = true;
  try {
    const shot = await window.characast.getObsScreenshot({ width: 640, quality: 50 });
    if (!shot) { setVisHint('等 OBS 連線 / 有場景才看得到畫面'); return; }
    const h = await visHash(shot);
    if (_visLastHash && _hamming(h, _visLastHash) <= VISION_DIFF) return;   // Layer 0:畫面沒變 → 跳過
    _visLastHash = h;
    const out = await _visClassifier(shot, VISION_LABELS.map((l) => l.en));  // Layer 1:CLIP 零樣本(粗類型)
    const top = Array.isArray(out) ? out[0] : null;
    if (!top || top.score < VISION_MIN_SCORE) return;
    let zh = (VISION_LABELS.find((l) => l.en === top.label) || {}).zh || top.label;
    const g2 = effectiveGame();
    // 框選區偵測優先(最準、對地圖免疫):遊戲中 + 有 rate 框短時間爆量 → 激戰
    const hot = hotZoneLabels();
    if (zh === VISION_GAME_LABEL && hot.length) {
      zh = hot[0] === '戰鬥' && hot.length === 1 ? VISION_COMBAT_LABEL : (hot.join('/') + '中');
    } else if (zh === VISION_GAME_LABEL && g2 && _visProfiles[g2]) {
      // Layer 2:校準原型細分(大事件畫面,如勝利/結算)
      try {
        const m = matchScene(await embedImage(shot), g2);
        if (m) zh = m.label;
      } catch { /* 細分失敗就維持粗類型 */ }
    }
    if (zh !== _visLastLabel) {                              // 場景真的變了才送(省)
      _visLastLabel = zh;
      window.characast.sendStreamerVision('場景:' + zh);
      appendLog({ level: 'info', msg: `Vision 🖼️ 場景:「${zh}」(${(top.score * 100) | 0}%)→ 已上雲` });
      setVisHint(`✓ 看到:${zh}`);
    }
  } catch (e) {
    appendLog({ level: 'warn', msg: `Vision:判斷失敗(略過)${e.message || e}` });
  } finally { _visBusy = false; }
}

function stopVision() {
  _visTier = null;
  if (_visTimer) { clearInterval(_visTimer); _visTimer = null; }
  if (_kfTimer) { clearInterval(_kfTimer); _kfTimer = null; }
  if (_ocrTimer) { clearInterval(_ocrTimer); _ocrTimer = null; }
  _visClassifier = null; _visBusy = false; _visLastHash = null; _visLastLabel = '';
  _zoneState = {}; _ocrLastText = {}; _ocrHist = {};
}

// 讓 AI 看畫面:開關單一入口(分頁勾選 + 快速開關都走這)
function setVisLocalOn(on) {
  _visLocalOn = on;
  if ($('vision-enabled')) $('vision-enabled').checked = on;
  paintQuick('qt-vision', '🖼️ 看畫面', on);
  window.characast.setSettings({ vision: { enabled: on } });
  if (!on && (_visTier || _visStarting)) { stopVision(); setVisHint('已關閉 — 打開開關讓 AI 看畫面'); }
  else syncPerception();
}
$('vision-enabled')?.addEventListener('change', (e) => setVisLocalOn(e.target.checked));
$('qt-vision')?.addEventListener('click', () => setVisLocalOn(!_visLocalOn));

// ===== Layer 2:每款遊戲校準(少樣本 CLIP 原型,本地存)=====
// 共用同一顆 CLIP(檔案已快取),用 image-feature-extraction 拿影像向量;懶載。
async function getVisEmbedder() {
  if (_visEmbedder) return _visEmbedder;
  if (_visEmbedderLoading) return _visEmbedderLoading;
  _visEmbedderLoading = (async () => {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
    env.allowLocalModels = false;
    try { _visEmbedder = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { device: 'webgpu', dtype: 'fp32' }); }
    catch { _visEmbedder = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { device: 'wasm' }); }
    return _visEmbedder;
  })();
  return _visEmbedderLoading;
}
function _l2norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); }
function _cosine(a, b) { if (!a || !b || a.length !== b.length) return -1; let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }
async function embedImage(dataUrl) {
  const emb = await getVisEmbedder();
  const out = await emb(dataUrl);
  return _l2norm(Array.from(out.data || []));   // 存正規化向量 → cosine = 點積
}
function matchScene(vec, game) {
  const prof = _visProfiles[game]; if (!prof) return null;
  let best = null, bestSim = -1;
  for (const [label, samples] of Object.entries(prof)) {
    for (const s of samples) { const sim = _cosine(vec, s); if (sim > bestSim) { bestSim = sim; best = label; } }
  }
  return (best && bestSim >= VIS_MATCH_MIN) ? { label: best, sim: bestSim } : null;
}

function setCalHint(msg) { const h = $('cal-hint'); if (h) h.textContent = msg; }
// 有效遊戲名:直播中用偵測到的,否則用手動輸入的(離線校準用)
function effectiveGame() { return (_currentGame || ($('cal-game-input')?.value || '').trim()).trim(); }
// 場景全自訂:打名字 → 建空場景 → 用清單的「＋擷取」存大事件畫面(多角度更準)。
// 不放死預設;行為級(團戰/走位)few-shot 抓不準,那種改用「框選區」。
function calAddScene() {
  const game = effectiveGame();
  if (!game) { setCalHint('先填遊戲名稱'); return; }
  const name = ($('cal-new-name')?.value || '').trim().slice(0, 24);
  if (!name) { setCalHint('先打一個場景名(例:五殺畫面)'); return; }
  if (!_visProfiles[game]) _visProfiles[game] = {};
  if (_visProfiles[game][name]) { setCalHint(`「${name}」已經有了`); return; }
  if (Object.keys(_visProfiles[game]).length >= 24) { setCalHint('場景數已達上限(24)'); return; }
  _visProfiles[game][name] = [];   // 先建空場景(本地;擷取第一張才會存檔)
  if ($('cal-new-name')) $('cal-new-name').value = '';
  renderCalList();
  setCalHint(`✓ 已新增「${name}」— 按它那列的「＋擷取」存大事件畫面`);
}
function updateCalUI() {
  // 直播中偵測到遊戲 → 自動帶入輸入框(使用者還沒手動打才帶,免得蓋掉他打的)
  const inp = $('cal-game-input');
  if (inp && _currentGame && !inp.value.trim()) inp.value = _currentGame;
  const hint = $('cal-game-hint');
  if (hint) hint.textContent = _currentGame
    ? `直播中偵測到:${_currentGame}(已帶入)`
    : '離線中 — 自己填遊戲名即可;直播時要跟 Twitch 分類一致才會自動套用';
  renderCalList();
  renderZoneList();   // 框選區清單跟著遊戲換
}
function renderCalList() {
  const box = $('cal-list'); if (!box) return;
  box.innerHTML = '';
  const game = effectiveGame();
  if (!game) { box.innerHTML = '<div class="hint">先填上面的遊戲名,才能新增場景</div>'; return; }
  const prof = _visProfiles[game] || {};
  const labels = Object.keys(prof);
  if (!labels.length) { box.innerHTML = '<div class="hint">還沒有場景 — 上面打名字按「＋ 新增場景」</div>'; return; }
  for (const label of labels) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px';
    const span = document.createElement('span'); span.style.flex = '1';
    span.textContent = `${label} ×${prof[label].length}`;
    const cap = document.createElement('button'); cap.className = 'ghost'; cap.type = 'button'; cap.textContent = '＋擷取'; cap.style.padding = '2px 8px';
    cap.addEventListener('click', () => calCapture(label));
    const del = document.createElement('button'); del.className = 'ghost'; del.type = 'button'; del.textContent = '移除'; del.style.padding = '2px 8px';
    del.addEventListener('click', async () => {
      delete _visProfiles[game][label];
      if (!Object.keys(_visProfiles[game]).length) delete _visProfiles[game];
      await window.characast.setSettings({ visionProfiles: _visProfiles });
      renderCalList();
    });
    row.appendChild(span); row.appendChild(cap); row.appendChild(del); box.appendChild(row);
  }
}
async function calCapture(label) {
  const game = effectiveGame();
  if (!game) { setCalHint('先填遊戲名稱(離線可手動輸入)'); return; }
  if (!label) { setCalHint('先新增一個場景'); return; }
  setCalHint('擷取中…(首次要載入向量模型)');
  try {
    const shot = await window.characast.getObsScreenshot({ width: 640, quality: 60 });
    if (!shot) { setCalHint('截不到畫面 — 確認 OBS 已連線'); return; }
    if (!_visProfiles[game]) _visProfiles[game] = {};
    if (!_visProfiles[game][label]) _visProfiles[game][label] = [];
    if (_visProfiles[game][label].length >= 8) { setCalHint(`「${label}」已達 8 張上限(夠用了)`); return; }
    _visProfiles[game][label].push(await embedImage(shot));
    await window.characast.setSettings({ visionProfiles: _visProfiles });
    renderCalList();
    setCalHint(`✓ 已存「${label}」第 ${_visProfiles[game][label].length} 張 — 可再按「＋擷取」存同一種,多角度更準`);
  } catch (e) { setCalHint('擷取失敗:' + (e.message || e)); }
}
$('cal-add')?.addEventListener('click', calAddScene);
$('cal-new-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') calAddScene(); });
$('cal-game-input')?.addEventListener('input', () => { renderCalList(); renderZoneList(); });   // 換遊戲名 → 校準列表 + 框選清單跟著換

// ===== ⚔️ 戰鬥偵測:盯 kill feed 區域的變化頻率（短時間爆量 = 團戰）=====
async function regionHash(dataUrl, r) {
  const img = await _loadImage(dataUrl);
  const sw = r.w * img.width, sh = r.h * img.height;
  if (sw < 4 || sh < 4) return null;
  const c = _visCanvas || (_visCanvas = document.createElement('canvas'));
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 16, 16);
  ctx.drawImage(img, r.x * img.width, r.y * img.height, sw, sh, 0, 0, 16, 16);   // 只畫 kill feed 那塊
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const g = new Float32Array(256); let sum = 0;
  for (let i = 0; i < 256; i++) { const v = d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114; g[i] = v; sum += v; }
  const avg = sum / 256;
  let bits = ''; for (let i = 0; i < 256; i++) bits += g[i] >= avg ? '1' : '0';
  return bits;
}
function gameZones() { return _visHud[effectiveGame()]?.zones || []; }

// ---- rate 框:盯各框變化頻率 ----
async function rateTick() {
  if (_kfBusy) return;
  const zones = gameZones().filter((z) => z.mode === 'rate');
  if (!zones.length) return;
  _kfBusy = true;
  try {
    const shot = await window.characast.getObsScreenshot({ width: 960, quality: 50 });
    if (!shot) return;
    const now = Date.now();
    for (const z of zones) {
      const h = await regionHash(shot, z.rect);
      if (!h) continue;
      const st = _zoneState[z.id] || (_zoneState[z.id] = { last: null, events: [] });
      if (st.last && _hamming(h, st.last) > KF_DIFF) st.events.push(now);   // 那塊變了 = 一個事件
      st.last = h;
    }
  } catch { /* 略過此次 */ } finally { _kfBusy = false; }
}
// 目前「爆動中」的 rate 框標籤(去重)
function hotZoneLabels() {
  const now = Date.now();
  const out = [];
  for (const z of gameZones()) {
    if (z.mode !== 'rate') continue;
    const st = _zoneState[z.id];
    if (!st) continue;
    st.events = st.events.filter((t) => t >= now - KF_WINDOW_MS);
    if (st.events.length >= KF_HOT && !out.includes(z.label)) out.push(z.label);
  }
  return out;
}

// ---- ocr 框:讀數字(人頭比數 / KDA),tesseract.js 懶載,只送短文字 ----
let _ocrCanvas = null;
async function ensureOcr() {
  if (_ocrWorker) return _ocrWorker;
  if (_ocrLoading) return _ocrLoading;
  _ocrLoading = (async () => {
    appendLog({ level: 'info', msg: 'Vision OCR:載入 tesseract…(首次會下載語言檔)' });
    const T = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/+esm');
    const createWorker = T.createWorker || (T.default && T.default.createWorker);
    if (!createWorker) throw new Error('tesseract.js 沒有 createWorker(CDN 載入格式不符)');
    const worker = await createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: '0123456789/:', tessedit_pageseg_mode: '8' });  // 8=單字,對短數字(單/兩位)比 7=單行 準
    _ocrWorker = worker;
    appendLog({ level: 'info', msg: 'Vision OCR:tesseract 已就緒' });
    return worker;
  })().catch((e) => { _ocrLoading = null; throw e; });
  return _ocrLoading;
}
// Otsu:從灰階直方圖找最佳二值門檻(自適應,解決亮背景)
function otsuThreshold(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; thr = i; }
  }
  return thr;
}
async function cropForOcr(dataUrl, r) {
  const img = await _loadImage(dataUrl);
  const sx = r.x * img.width, sy = r.y * img.height, sw = r.w * img.width, sh = r.h * img.height;
  if (sw < 6 || sh < 6) return null;
  const scale = Math.min(6, Math.max(2, 80 / sh));   // 小字放大到 ~80px 高(至少 2x)
  const W = Math.round(sw * scale), H = Math.round(sh * scale);
  const c = _ocrCanvas || (_ocrCanvas = document.createElement('canvas'));
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H), px = d.data;
  const hist = new Uint32Array(256), gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) { const v = (px[i]*0.299 + px[i+1]*0.587 + px[i+2]*0.114) | 0; gray[j] = v; hist[v]++; }
  const thr = otsuThreshold(hist, W * H);
  let above = 0; for (let j = 0; j < gray.length; j++) if (gray[j] > thr) above++;
  const textIsBright = above <= gray.length / 2;   // 亮的是少數 → 亮的才是文字(HUD 多為白字)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const isText = textIsBright ? gray[j] > thr : gray[j] <= thr;
    const b = isText ? 0 : 255;   // 一律輸出黑字白底(tesseract 偏好)
    px[i] = px[i+1] = px[i+2] = b;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}
// 只取數字段,每段最多 3 位,正規化:1 段=數字、2 段=我:敵、3 段=K/D/A
function parseOcr(raw) {
  const groups = (String(raw).match(/\d+/g) || []).map((s) => s.slice(0, 3));
  if (!groups.length) return null;
  if (groups.length === 1) return groups[0];
  if (groups.length === 2) return groups.join(':');
  return groups.slice(0, 3).join('/');
}
async function ocrTick() {
  if (_ocrBusy) return;
  const zones = gameZones().filter((z) => z.mode === 'ocr');
  if (!zones.length) return;
  _ocrBusy = true;
  try {
    const worker = await ensureOcr();
    const shot = await window.characast.getObsScreenshot({ width: 1920, quality: 80 });  // 小字要高解析度
    if (!shot) { appendLog({ level: 'warn', msg: 'Vision OCR:截不到畫面(OBS 沒連?)' }); return; }
    for (const z of zones) {
      const crop = await cropForOcr(shot, z.rect);
      if (!crop) { appendLog({ level: 'warn', msg: `Vision 🔢 ${z.label}:框太小,放大一點` }); continue; }
      let raw = '';
      try { const res = await worker.recognize(crop); raw = (res?.data?.text || '').replace(/\s+/g, ' ').trim(); }
      catch (e) { appendLog({ level: 'warn', msg: `Vision 🔢 ${z.label}:辨識失敗 ${e.message || e}` }); continue; }
      const val = parseOcr(raw);
      // 多數決:看最近 OCR_VOTE_WINDOW 次,出現最多的非空值;達票才送(不信 tesseract 信心)
      const hist = _ocrHist[z.id] || (_ocrHist[z.id] = []);
      hist.push(val || null); if (hist.length > OCR_VOTE_WINDOW) hist.shift();
      const counts = {}; let best = null, bestN = 0;
      for (const v of hist) { if (!v) continue; counts[v] = (counts[v] || 0) + 1; if (counts[v] > bestN) { bestN = counts[v]; best = v; } }
      if (!best || bestN < OCR_VOTE_MIN) continue;     // 票數不夠 → 不送(零星誤判湊不到票,自然被擋)
      if (_ocrLastText[z.id] === best) continue;       // 跟上次一樣 → 不重送
      _ocrLastText[z.id] = best;
      window.characast.sendStreamerVision(z.label + ':' + best);
      appendLog({ level: 'info', msg: `Vision 🔢 ${z.label}:「${best}」→ 已上雲 ✓` });
    }
  } catch (e) {
    appendLog({ level: 'warn', msg: `Vision OCR:略過(${e.message || e})` });
  } finally { _ocrBusy = false; }
}

// ----- 框選 UI:多個框,每框選一種偵測法,在畫面上拖框 → 命名 + 選法 → 存 -----
function setKfHint(m) { const h = $('kf-hint'); if (h) h.textContent = m; }
function renderZoneList() {
  const box = $('zone-list'); if (!box) return;
  box.innerHTML = '';
  const zones = gameZones();
  for (const z of zones) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 10px';
    const tag = z.mode === 'ocr' ? '🔢 讀數字' : '📈 變化率';
    const meta = document.createElement('span');
    meta.style.flex = '1';
    meta.textContent = `${z.label} · ${tag} · ${Math.round(z.rect.w*100)}×${Math.round(z.rect.h*100)}%`;
    const del = document.createElement('button');
    del.className = 'ghost'; del.type = 'button'; del.textContent = '🗑'; del.style.padding = '2px 8px';
    del.addEventListener('click', async () => {
      const g = effectiveGame(); if (!g || !_visHud[g]) return;
      _visHud[g].zones = (_visHud[g].zones || []).filter((x) => x.id !== z.id);
      if (!_visHud[g].zones.length) delete _visHud[g];
      delete _zoneState[z.id]; delete _ocrLastText[z.id];
      await window.characast.setSettings({ visionHud: _visHud });
      renderZoneList();
    });
    row.appendChild(meta); row.appendChild(del);
    box.appendChild(row);
  }
}
$('kf-pick-btn')?.addEventListener('click', async () => {
  const game = effectiveGame();
  if (!game) { setKfHint('先在上面填遊戲名'); return; }
  setKfHint('擷取畫面中…');
  const shot = await window.characast.getObsScreenshot({ width: 960, quality: 60 });
  if (!shot) { setKfHint('截不到畫面 — 確認 OBS 已連線'); return; }
  const img = $('kf-img'); if (img) img.src = shot;
  const pick = $('kf-pick'); if (pick) pick.style.display = 'block';
  const kbox = $('kf-box'); if (kbox) kbox.style.display = 'none';
  const form = $('zone-form'); if (form) form.style.display = 'none';
  _pendingRect = null;
  setKfHint('在畫面上拖一個框,框住要盯的區塊');
});
$('kf-pick')?.addEventListener('mousedown', (e) => {
  const r = $('kf-pick').getBoundingClientRect();
  _kfDrag = { x0: e.clientX - r.left, y0: e.clientY - r.top, r };
});
window.addEventListener('mousemove', (e) => {
  if (!_kfDrag) return;
  const { x0, y0, r } = _kfDrag;
  const x1 = Math.max(0, Math.min(r.width, e.clientX - r.left));
  const y1 = Math.max(0, Math.min(r.height, e.clientY - r.top));
  const box = $('kf-box'); if (!box) return;
  box.style.left = Math.min(x0, x1) + 'px'; box.style.top = Math.min(y0, y1) + 'px';
  box.style.width = Math.abs(x1 - x0) + 'px'; box.style.height = Math.abs(y1 - y0) + 'px';
  box.style.display = 'block';
});
window.addEventListener('mouseup', (e) => {
  if (!_kfDrag) return;
  const { x0, y0, r } = _kfDrag; _kfDrag = null;
  const x1 = Math.max(0, Math.min(r.width, e.clientX - r.left));
  const y1 = Math.max(0, Math.min(r.height, e.clientY - r.top));
  const left = Math.min(x0, x1), top = Math.min(y0, y1);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (w < 8 || h < 8) { setKfHint('框太小了,重拖一次'); return; }
  _pendingRect = { x: left / r.width, y: top / r.height, w: w / r.width, h: h / r.height };
  const form = $('zone-form'); if (form) form.style.display = 'flex';
  setKfHint('幫這個框取名 + 選偵測法 → 存框');
});
$('zone-save')?.addEventListener('click', async () => {
  if (!_pendingRect) { setKfHint('先在畫面上拖一個框'); return; }
  const game = effectiveGame();
  if (!game) { setKfHint('先填遊戲名'); return; }
  if (!_visHud[game]) _visHud[game] = {};
  if (!Array.isArray(_visHud[game].zones)) _visHud[game].zones = [];
  if (_visHud[game].zones.length >= 12) { setKfHint('一款遊戲最多 12 個框'); return; }
  const label = ($('zone-name')?.value || '').trim().slice(0, 16) || '區域';
  const mode = $('zone-mode')?.value === 'ocr' ? 'ocr' : 'rate';
  const id = 'z' + Date.now().toString(36);
  _visHud[game].zones.push({ id, label, mode, rect: _pendingRect });
  await window.characast.setSettings({ visionHud: _visHud });
  _pendingRect = null;
  if ($('zone-name')) $('zone-name').value = '';
  const form = $('zone-form'); if (form) form.style.display = 'none';
  const pick = $('kf-pick'); if (pick) pick.style.display = 'none';
  renderZoneList();
  setKfHint(`✓ 已存「${label}」(${mode === 'ocr' ? '讀數字' : '變化率'})`);
});

// 雲端認證成功的瞬間同步一次;之後每 60s 再對一次(後台改設定能跟上)
let _sttLastAuthed = false;
window.characast.onStatus((s) => {
  const authed = Boolean(s?.cloud?.authed);
  if (authed && !_sttLastAuthed) setTimeout(syncPerception, 1500);
  _sttLastAuthed = authed;
});
setInterval(syncPerception, 60_000);

// init
(async () => {
  await applyView();
  const recent = await window.characast.getRecentLogs();
  for (const e of recent) appendLog(e);
  setTimeout(syncPerception, 4000);   // 開機若已配對,稍後主動對一次設定
})();
