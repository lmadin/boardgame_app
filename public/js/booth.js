const $ = (sel) => document.querySelector(sel);

let BOOTH_ID = sessionStorage.getItem('boothId');
let BOOTH_PIN = sessionStorage.getItem('boothPin');
let mode = '1v3';
let selected = new Map(); // playerId -> {name, chips, result}
let allPlayers = [];
let settings = {};
let currentBooth = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (BOOTH_PIN) headers['x-booth-pin'] = BOOTH_PIN;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
  return data;
}

function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showLogin() { $('#loginScreen').style.display = 'block'; $('#boothScreen').style.display = 'none'; }
function showBooth() { $('#loginScreen').style.display = 'none'; $('#boothScreen').style.display = 'block'; }

async function boot() {
  const state = await api('/api/state');
  settings = state.settings;
  if (BOOTH_ID && BOOTH_PIN) {
    try {
      await loadBooth();
      showBooth();
    } catch (e) {
      sessionStorage.clear();
      showLogin();
    }
  } else {
    showLogin();
  }
  connectSocket();
  refreshPlayers();
}

async function refreshPlayers() {
  const data = await api('/api/players');
  allPlayers = data.players;
}

async function loadBooth() {
  const data = await api(`/api/booth/${BOOTH_ID}`);
  currentBooth = data.booth;
  renderBoothHeader();
  renderRecent(data.recent);
}

function renderBoothHeader() {
  const b = currentBooth;
  $('#boothName').textContent = b.name;
  $('#boothTypeBadge').textContent = b.type === 'board' ? '보드게임' : '미니게임';
  $('#multiplierBadge').textContent = `기본 x${b.baseMultiplier}`;
  $('#streakBadge').textContent = `운영진 연승 ${b.winStreak}`;
  $('#ruleNote').textContent = b.ruleNote || '';
  $('#bountyBanner').innerHTML = b.bountyActive
    ? `<div class="bounty-banner">🔥 현상금 부스 발동중! 지금 이기는 참가자는 배당에 +${settings.bountyMultiplierBonus}배(또는 보너스칩)를 서버가 자동으로 더 얹어줘요 — 아래 배당칸엔 원래 배당만 입력하세요.</div>` : '';
}

function renderRecent(recent) {
  const el = $('#recentList');
  if (!recent || !recent.length) { el.innerHTML = '아직 기록이 없어요.'; return; }
  el.innerHTML = recent.map(r => {
    const win = r.result === 'win';
    const label = r.result === 'win' ? '승' : r.result === 'fold' ? '다이' : '패';
    return `<div class="list-row">
      <span>${escapeHtml(r.player_name)} ${r.bounty_applied ? '🔥' : ''}</span>
      <span class="badge ${win ? 'good' : 'critical'}">${label} ${r.payout >= 0 ? '+' : ''}${fmt(r.payout)}</span>
    </div>`;
  }).join('');
}

function connectSocket() {
  const socket = io();
  socket.on('state:update', (state) => {
    settings = state.settings;
    allPlayers = state.leaderboard;
    if (BOOTH_ID) {
      const b = state.booths.find(x => x.id === BOOTH_ID);
      if (b) { currentBooth = b; renderBoothHeader(); }
    }
  });
}

// ---- login ----
$('#loginBtn').addEventListener('click', async () => {
  const pin = $('#pinInput').value.trim();
  $('#loginError').innerHTML = '';
  if (!pin) return;
  $('#loginBtn').disabled = true;
  try {
    const data = await api('/api/booth/login', { method: 'POST', body: { pin } });
    BOOTH_ID = data.booth.id;
    BOOTH_PIN = data.booth.pin;
    sessionStorage.setItem('boothId', BOOTH_ID);
    sessionStorage.setItem('boothPin', BOOTH_PIN);
    await loadBooth();
    showBooth();
  } catch (e) {
    $('#loginError').innerHTML = `<div class="error-box">${e.message}</div>`;
  } finally {
    $('#loginBtn').disabled = false;
  }
});
$('#pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });

$('#logoutBtn').addEventListener('click', () => {
  sessionStorage.clear();
  BOOTH_ID = null; BOOTH_PIN = null;
  selected.clear();
  showLogin();
});

// ---- mode ----
document.querySelectorAll('.nav-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
    $('#maxPick').textContent = mode === '1v1' ? '1' : '3';
    if (mode === '1v1' && selected.size > 1) {
      const first = [...selected.entries()][0];
      selected = new Map([first]);
    }
    renderSelected();
  });
});

// ---- search ----
$('#searchInput').addEventListener('input', () => {
  const q = $('#searchInput').value.trim().toLowerCase();
  const results = $('#searchResults');
  if (!q) { results.innerHTML = ''; return; }
  const matches = allPlayers.filter(p => p.name.toLowerCase().includes(q) && !selected.has(p.id)).slice(0, 8);
  if (!matches.length) { results.innerHTML = '<div class="muted" style="padding:8px;">일치하는 참가자가 없어요.</div>'; return; }
  results.innerHTML = matches.map(p =>
    `<div class="player-pick" data-id="${p.id}"><span class="name">${escapeHtml(p.name)}</span><span class="chips">${fmt(p.chips)}칩</span></div>`
  ).join('');
  results.querySelectorAll('.player-pick').forEach(el => {
    el.addEventListener('click', () => {
      const max = mode === '1v1' ? 1 : 3;
      if (selected.size >= max) { alert(`최대 ${max}명까지 선택할 수 있어요.`); return; }
      const p = allPlayers.find(x => x.id === el.dataset.id);
      selected.set(p.id, { name: p.name, chips: p.chips, result: null, multiplier: currentBooth ? currentBooth.baseMultiplier : 2 });
      $('#searchInput').value = '';
      results.innerHTML = '';
      renderSelected();
    });
  });
});

function renderSelected() {
  const wrap = $('#selectedWrap');
  if (selected.size === 0) { wrap.style.display = 'none'; validateForm(); return; }
  wrap.style.display = 'block';
  const list = $('#selectedList');
  list.innerHTML = [...selected.entries()].map(([id, p]) => `
    <div class="player-pick selected" style="cursor:default; flex-direction:column; align-items:stretch; gap:8px;">
      <div class="row" style="align-items:center;">
        <div>
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="chips">잔여 ${fmt(p.chips)}칩</div>
        </div>
        <div class="row" style="flex:none; gap:6px;">
          <button class="btn small ${p.result === 'win' ? 'win' : 'ghost'}" data-act="win" data-id="${id}">승</button>
          <button class="btn small ${p.result === 'fold' ? 'lose' : 'ghost'}" data-act="fold" data-id="${id}">다이</button>
          <button class="btn small ${p.result === 'lose' ? 'lose' : 'ghost'}" data-act="lose" data-id="${id}">패</button>
          <button class="btn small ghost" data-act="remove" data-id="${id}">✕</button>
        </div>
      </div>
      ${p.result === 'win' ? `
        <div class="row" style="align-items:center; gap:8px;">
          <label style="margin:0; flex:none; white-space:nowrap;">이 판 배당(x)</label>
          <input type="number" step="0.1" min="0.1" max="10" value="${p.multiplier}" data-mult-id="${id}" style="padding:8px 10px;">
        </div>
      ` : ''}
    </div>
  `).join('');
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const p = selected.get(id);
      if (btn.dataset.act === 'remove') selected.delete(id);
      else p.result = btn.dataset.act;
      renderSelected();
    });
  });
  list.querySelectorAll('[data-mult-id]').forEach(input => {
    input.addEventListener('input', () => {
      const p = selected.get(input.dataset.multId);
      p.multiplier = Number(input.value);
      validateForm();
    });
  });
  validateForm();
}

$('#stakeInput').addEventListener('input', validateForm);

function validateForm() {
  const stake = Number($('#stakeInput').value);
  const hint = $('#stakeHint');
  const minBet = settings.minBet || 5;
  let ok = selected.size > 0 && Number.isFinite(stake) && stake >= minBet;
  let msgs = [`최소 배팅 ${minBet}칩`];
  for (const [, p] of selected) {
    if (stake > p.chips) { ok = false; msgs.push(`${p.name}님 잔여칩(${p.chips}) 초과`); }
    if (!p.result) ok = false;
    if (p.result === 'win' && (!Number.isFinite(p.multiplier) || p.multiplier <= 0)) {
      ok = false; msgs.push(`${p.name}님 배당을 입력해주세요`);
    }
  }
  if ([...selected.values()].some(p => !p.result)) msgs.push('모든 참가자의 승/다이/패를 선택해주세요');
  hint.textContent = msgs.join(' · ');
  $('#submitBtn').disabled = !ok;
  return ok;
}

$('#submitBtn').addEventListener('click', async () => {
  $('#resultError').innerHTML = '';
  if (!validateForm()) return;
  const stake = Number($('#stakeInput').value);
  const entries = [...selected.entries()].map(([id, p]) => ({
    playerId: id, stake, result: p.result,
    multiplier: p.result === 'win' ? p.multiplier : undefined,
  }));
  $('#submitBtn').disabled = true;
  try {
    const data = await api(`/api/booth/${BOOTH_ID}/bet`, { method: 'POST', body: { mode, entries } });
    currentBooth = data.booth;
    renderBoothHeader();
    selected.clear();
    $('#stakeInput').value = '';
    renderSelected();
    await loadBooth();
    await refreshPlayers();
  } catch (e) {
    $('#resultError').innerHTML = `<div class="error-box">${e.message}</div>`;
  } finally {
    $('#submitBtn').disabled = selected.size === 0;
  }
});

boot();
