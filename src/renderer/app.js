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

// 點「→ 怎麼設定 OBS?」直接展開設定區塊 + 捲過去
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'obs-hint-link') {
    e.preventDefault();
    const det = document.getElementById('obs-settings');
    if (det) {
      det.open = true;
      det.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
});

window.characast.onStatus((s) => refreshStatusCards(s));

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

// init
(async () => {
  await applyView();
  const recent = await window.characast.getRecentLogs();
  for (const e of recent) appendLog(e);
})();
