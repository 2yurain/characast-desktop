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
  // 🎤 歌聲共鳴:還原開關 + 裝置,若上次是開啟就自動接續
  const r = s.resonance || {};
  if ($('reso-enabled')) {
    $('reso-enabled').checked = Boolean(r.enabled);
    await resoRefreshDevices(r.deviceId || '');
    if (r.enabled) resoStart();
  }

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
const EMO_SLOTS = ['happy', 'sad', 'surprised', 'teasing', 'neutral'];
const EMO_HINTS = {
  happy: /happy|smile|joy|笑|開心|喜|嗨|love/i,
  sad: /sad|cry|tear|哭|難過|傷|淚/i,
  surprised: /surpris|shock|wow|驚|嚇|!/i,
  teasing: /teas|smug|wink|哼|傲|壞|調皮|嘿/i,
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
$('tts-enable')?.addEventListener('click', () => {
  unlockTts('按鈕');
  refreshVoices();
  const names = _availableVoices.slice(0, 4).map((v) => `${v.name}(${v.lang})`).join(', ');
  ttsLog('info', `可用 voices=${_availableVoices.length}${names ? ' — ' + names + '…' : '(空!沒有語音引擎)'}`);
});
$('tts-test')?.addEventListener('click', () => {
  speak({ text: '凌小夏語音測試,主人聽得到嗎?', rate: 1.0, pitch: 1.0 });
});

// ============== 🎤 歌聲共鳴(抓麥 → 推 OBS overlay)==============
// OBS 拿不到麥 → 由這裡(renderer 有完整 getUserMedia)抓麥、算出 energy + 頻譜質心,
// 用 IPC 高頻送給 main → cloud → overlay。聲音本機分析,只送數值,不送音檔。
let _resoStream = null, _resoCtx = null, _resoRAF = 0, _resoTimer = null;
let _resoEnergy = 0, _resoCentroid = 200;

function setResoHint(msg) { const h = $('reso-hint'); if (h) h.textContent = msg; }

async function resoRefreshDevices(selectedId) {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter((d) => d.kind === 'audioinput');
    const sel = $('reso-device'); if (!sel) return;
    const cur = selectedId != null ? selectedId : sel.value;
    sel.innerHTML = '<option value="">預設麥克風</option>'
      + mics.map((m, i) => `<option value="${escAttr(m.deviceId)}">${escTxt(m.label || ('麥克風 ' + (i + 1)))}</option>`).join('');
    sel.value = cur || '';
  } catch { /* enumerate 失敗就只留「預設」 */ }
}

async function resoStart() {
  if (_resoStream) return;                       // 已在跑
  const deviceId = $('reso-device')?.value || '';
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
  await resoRefreshDevices();                     // 拿到權限後 label 才有值,補一次清單

  _resoCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_resoCtx.state === 'suspended') _resoCtx.resume().catch(() => {});
  const sr = _resoCtx.sampleRate;
  const srcNode = _resoCtx.createMediaStreamSource(_resoStream);
  const an = _resoCtx.createAnalyser();
  an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
  srcNode.connect(an);
  const td = new Uint8Array(an.fftSize);
  const fd = new Uint8Array(an.frequencyBinCount);
  const binHz = sr / an.fftSize;

  const tick = () => {
    an.getByteTimeDomainData(td);
    let sum = 0; for (let i = 0; i < td.length; i++) { const x = (td[i] - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / td.length);
    _resoEnergy += (Math.min(100, rms * 320) - _resoEnergy) * 0.3;
    an.getByteFrequencyData(fd);
    let mag = 0, wsum = 0;
    for (let i = 1; i < fd.length; i++) { const m = fd[i]; mag += m; wsum += (i * binHz) * m; }
    if (rms > 0.012 && mag > 0) { _resoCentroid += ((wsum / mag) - _resoCentroid) * 0.15; }
    else {
      _resoEnergy += (0 - _resoEnergy) * 0.1;
      _resoCentroid += (0 - _resoCentroid) * 0.05;   // 靜音時 Hz 慢慢滑回 0,不要卡在最後數值
    }
    _resoRAF = requestAnimationFrame(tick);
  };
  _resoRAF = requestAnimationFrame(tick);

  // 約 12/s 把當前值送出 + 更新本機儀表(分析在 rAF 跑,送出用慢一點的計時器省頻寬)
  _resoTimer = setInterval(() => {
    const m = $('reso-meter'); if (m) m.style.width = Math.min(100, _resoEnergy) + '%';
    try { window.characast.resonanceData?.({ energy: _resoEnergy, centroid: _resoCentroid }); } catch {}
  }, 80);
  setResoHint('✓ 歌聲共鳴開啟中 — 唱歌看 OBS 的共鳴 overlay');
}

function resoStop() {
  if (_resoRAF) { cancelAnimationFrame(_resoRAF); _resoRAF = 0; }
  if (_resoTimer) { clearInterval(_resoTimer); _resoTimer = null; }
  if (_resoCtx) { try { _resoCtx.close(); } catch {} _resoCtx = null; }
  if (_resoStream) { try { _resoStream.getTracks().forEach((t) => t.stop()); } catch {} _resoStream = null; }
  const m = $('reso-meter'); if (m) m.style.width = '0%';
  _resoEnergy = 0;
  try { window.characast.resonanceData?.({ energy: 0, centroid: _resoCentroid }); } catch {}  // 推一發歸零讓 overlay 淡出
  setResoHint('已停止。需 cloud 已連線,開啟後唱歌 OBS 共鳴 overlay 就會動。');
}

async function persistReso() {
  await window.characast.setSettings({ resonance: {
    enabled: Boolean($('reso-enabled')?.checked),
    deviceId: $('reso-device')?.value || '',
  } });
}

$('reso-enabled')?.addEventListener('change', async (e) => {
  await persistReso();
  if (e.target.checked) resoStart(); else resoStop();
});
$('reso-device')?.addEventListener('change', async () => {
  await persistReso();
  if ($('reso-enabled')?.checked) { resoStop(); resoStart(); }   // 換裝置重啟
});
// AudioContext 可能因自動播放政策卡在 suspended,任一次點擊就嘗試恢復
document.addEventListener('click', () => { if (_resoCtx && _resoCtx.state === 'suspended') _resoCtx.resume().catch(() => {}); });

// init
(async () => {
  await applyView();
  const recent = await window.characast.getRecentLogs();
  for (const e of recent) appendLog(e);
})();
