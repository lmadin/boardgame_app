const $ = (sel) => document.querySelector(sel);

let ADMIN_PIN = sessionStorage.getItem('adminPin');
let boothsCache = [];
let playersCache = [];
let ballsCache = [];
let marketWinnerId = null;
let adjPlayerId = null;
let jokerPlayerId = null;

function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ADMIN_PIN) headers['x-admin-pin'] = ADMIN_PIN;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
  return data;
}

function showLogin() { $('#loginScreen').style.display = 'block'; $('#adminScreen').style.display = 'none'; }
function showAdmin() { $('#loginScreen').style.display = 'none'; $('#adminScreen').style.display = 'block'; }

async function boot() {
  if (ADMIN_PIN) {
    try {
      await loadAll();
      showAdmin();
      connectSocket();
      return;
    } catch (e) {
      sessionStorage.removeItem('adminPin');
      ADMIN_PIN = null;
    }
  }
  showLogin();
}

$('#loginBtn').addEventListener('click', async () => {
  const pin = $('#pinInput').value.trim();
  $('#loginError').innerHTML = '';
  if (!pin) return;
  ADMIN_PIN = pin;
  try {
    await api('/api/admin/booths');
    sessionStorage.setItem('adminPin', pin);
    await loadAll();
    showAdmin();
    connectSocket();
  } catch (e) {
    ADMIN_PIN = null;
    $('#loginError').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});
$('#pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });
$('#logoutBtn').addEventListener('click', () => { sessionStorage.removeItem('adminPin'); ADMIN_PIN = null; showLogin(); });

document.querySelectorAll('.nav-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['booths', 'market', 'pinball', 'joker', 'players', 'settings'].forEach(t => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? 'block' : 'none';
    });
  });
});

async function loadAll() {
  await Promise.all([loadBooths(), loadPlayers(), loadMarket(), loadPinball(), loadSettings()]);
}

// ---------------- JOKER EVENT ----------------
$('#jokerSearch').addEventListener('input', () => searchPlayerInto('jokerSearch', 'jokerResults', async (p) => {
  jokerPlayerId = p.id;
  $('#jokerResults').innerHTML = '';
  $('#jokerSearch').value = '';
  await refreshJokerSelection();
}));

async function refreshJokerSelection() {
  if (!jokerPlayerId) return;
  const data = await api(`/api/players/${jokerPlayerId}`);
  const p = data.player;
  const maxChips = Number($('#jokerMaxChipsLabel').textContent) || 10;
  const eligible = p.chips <= maxChips;
  $('#jokerSelectedInfo').innerHTML = `선택됨: <b>${escapeHtml(p.name)}</b> (잔여 ${fmt(p.chips)}칩) ${eligible ? '' : ' — <span style="color:var(--critical);">⚠️ 칩이 기준보다 많아 원래는 참가 대상이 아니에요</span>'}`;
  const jokerBonuses = (data.eventBonuses || []).filter(b => b.category === 'joker');
  $('#jokerHistory').innerHTML = jokerBonuses.length
    ? `<div class="hint mt8">⚠️ 이미 조커 이벤트 참여함: ${jokerBonuses.map(b => `${escapeHtml(b.label)} (+${fmt(b.amount)})`).join(', ')}</div>`
    : '<div class="hint mt8">아직 조커 이벤트 참여 기록 없음</div>';
  $('#jokerBottleBtn').disabled = false;
  $('#jokerArmBtn').disabled = false;
}

async function grantJokerBonus(label, amount) {
  $('#jokerMsg').innerHTML = '';
  if (!jokerPlayerId) return;
  try {
    await api('/api/admin/joker-bonus', { method: 'POST', body: { playerId: jokerPlayerId, label, amount } });
    $('#jokerMsg').innerHTML = '<div class="success-box">지급되었습니다.</div>';
    await refreshJokerSelection();
    await loadPlayers();
  } catch (e) {
    $('#jokerMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}
$('#jokerBottleBtn').addEventListener('click', () => grantJokerBonus('물병세우기 성공', Number($('#jokerBottleLabel').textContent) || 10));
$('#jokerArmBtn').addEventListener('click', () => grantJokerBonus('팔씨름 승리', Number($('#jokerArmLabel').textContent) || 15));

function connectSocket() {
  const socket = io();
  socket.on('state:update', (state) => {
    playersCache = state.leaderboard;
    renderPlayerTable();
  });
}

// ---------------- BOOTHS ----------------
async function loadBooths() {
  const data = await api('/api/admin/booths');
  boothsCache = data.booths;
  renderBooths();
}

function renderBooths() {
  const el = $('#boothTable');
  el.innerHTML = boothsCache.map(b => `
    <div class="card" style="margin-bottom:10px; padding:14px;">
      <div class="row" style="align-items:center; margin-bottom:8px;">
        <input type="text" value="${escapeHtml(b.name)}" data-field="name" data-id="${b.id}" style="font-weight:700;">
        <span class="badge gold" style="flex:none;">PIN ${b.pin}</span>
      </div>
      <div class="row" style="align-items:center;">
        <select data-field="type" data-id="${b.id}">
          <option value="board" ${b.type === 'board' ? 'selected' : ''}>보드게임</option>
          <option value="mini" ${b.type === 'mini' ? 'selected' : ''}>미니게임</option>
        </select>
        <div style="flex:none; width:110px;">
          <input type="number" step="0.1" value="${b.base_multiplier}" data-field="baseMultiplier" data-id="${b.id}" placeholder="기본배당">
        </div>
      </div>
      <label style="margin-top:8px;">룰 메모</label>
      <input type="text" value="${escapeHtml(b.rule_note || '')}" data-field="ruleNote" data-id="${b.id}">
      <div class="hint mt8">연승 ${b.win_streak}회 ${b.bounty_active ? '· 🔥 현상금 발동중' : ''}</div>
      <div class="row mt16" style="margin-top:12px;">
        <button class="btn ghost small" data-act="save" data-id="${b.id}">저장</button>
        <button class="btn ghost small" data-act="pin" data-id="${b.id}">PIN 재발급</button>
        <button class="btn ghost small" data-act="streak" data-id="${b.id}">연승 초기화</button>
        <button class="btn lose small" data-act="delete" data-id="${b.id}">삭제</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => handleBoothAction(btn.dataset.act, btn.dataset.id));
  });
}

async function handleBoothAction(act, id) {
  const card = [...document.querySelectorAll('#boothTable [data-id]')];
  const get = (field) => card.find(el => el.dataset.id === id && el.dataset.field === field);
  try {
    if (act === 'save') {
      const name = get('name').value.trim();
      const type = get('type').value;
      const baseMultiplier = Number(get('baseMultiplier').value);
      const ruleNote = get('ruleNote').value;
      await api(`/api/admin/booths/${id}`, { method: 'PUT', body: { name, type, baseMultiplier, ruleNote } });
    } else if (act === 'pin') {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      await api(`/api/admin/booths/${id}`, { method: 'PUT', body: { pin } });
    } else if (act === 'streak') {
      await api(`/api/admin/booths/${id}`, { method: 'PUT', body: { resetStreak: true } });
    } else if (act === 'delete') {
      if (!confirm('이 부스를 삭제할까요?')) return;
      await api(`/api/admin/booths/${id}`, { method: 'DELETE' });
    }
    await loadBooths();
    $('#boothMsg').innerHTML = `<div class="success-box">처리되었습니다.</div>`;
  } catch (e) {
    $('#boothMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

$('#addBoothBtn').addEventListener('click', async () => {
  const name = $('#newBoothName').value.trim();
  const type = $('#newBoothType').value;
  const baseMultiplier = Number($('#newBoothMultiplier').value) || 2;
  const ruleNote = $('#newBoothRule').value.trim();
  $('#boothMsg').innerHTML = '';
  if (!name) { $('#boothMsg').innerHTML = '<div class="error-box">부스 이름을 입력해주세요.</div>'; return; }
  try {
    await api('/api/admin/booths', { method: 'POST', body: { name, type, baseMultiplier, ruleNote } });
    $('#newBoothName').value = '';
    $('#newBoothRule').value = '';
    await loadBooths();
    $('#boothMsg').innerHTML = '<div class="success-box">부스가 추가되었습니다.</div>';
  } catch (e) {
    $('#boothMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

// ---------------- MARKET ----------------
async function loadPlayers() {
  const data = await api('/api/players');
  playersCache = data.players;
  renderPlayerTable();
}

function renderPlayerTable() {
  const el = $('#playerTable');
  if (!el) return;
  if (!playersCache.length) { el.innerHTML = '<div class="muted">아직 참가자가 없어요.</div>'; return; }
  el.innerHTML = `<table><thead><tr><th>순위</th><th>이름</th><th>잔여칩</th><th>승</th><th>패</th></tr></thead><tbody>
    ${playersCache.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${fmt(p.chips)}</td><td>${p.wins}</td><td>${p.losses}</td></tr>`).join('')}
  </tbody></table>`;
}

$('#winnerSearch').addEventListener('input', () => searchPlayerInto('winnerSearch', 'winnerResults', (p) => {
  marketWinnerId = p.id;
  $('#selectedWinner').textContent = `선택됨: ${p.name} (잔여 ${fmt(p.chips)}칩)`;
  $('#winnerResults').innerHTML = '';
  $('#winnerSearch').value = '';
  updateMarketBtn();
}));

function searchPlayerInto(inputId, resultsId, onPick) {
  const q = $('#' + inputId).value.trim().toLowerCase();
  const results = $('#' + resultsId);
  if (!q) { results.innerHTML = ''; return; }
  const matches = playersCache.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
  results.innerHTML = matches.map(p => `<div class="player-pick" data-id="${p.id}"><span class="name">${escapeHtml(p.name)}</span><span class="chips">${fmt(p.chips)}칩</span></div>`).join('');
  results.querySelectorAll('.player-pick').forEach(el => {
    el.addEventListener('click', () => onPick(playersCache.find(p => p.id === el.dataset.id)));
  });
}

function updateMarketBtn() {
  const price = Number($('#itemPrice').value);
  $('#marketBtn').disabled = !(marketWinnerId && $('#itemName').value.trim() && price > 0);
}
$('#itemName').addEventListener('input', updateMarketBtn);
$('#itemPrice').addEventListener('input', updateMarketBtn);

$('#marketBtn').addEventListener('click', async () => {
  $('#marketMsg').innerHTML = '';
  try {
    await api('/api/market/sale', { method: 'POST', body: {
      itemName: $('#itemName').value.trim(),
      price: Number($('#itemPrice').value),
      winnerId: marketWinnerId,
    }});
    $('#itemName').value = ''; $('#itemPrice').value = '';
    marketWinnerId = null; $('#selectedWinner').textContent = '';
    $('#marketMsg').innerHTML = '<div class="success-box">낙찰이 등록되었습니다.</div>';
    updateMarketBtn();
    await loadMarket();
    await loadPlayers();
  } catch (e) {
    $('#marketMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

async function loadMarket() {
  const data = await api('/api/market/sales');
  const el = $('#marketHistory');
  if (!data.sales.length) { el.innerHTML = '아직 경매 기록이 없어요.'; return; }
  el.innerHTML = data.sales.map(s => `<div class="list-row"><span>${escapeHtml(s.item_name)} → ${escapeHtml(s.winner_name)}</span><span class="badge gold">-${fmt(s.price)}</span></div>`).join('');
}

// ---------------- PINBALL ----------------
async function loadPinball() {
  const data = await api('/api/pinball/balls');
  ballsCache = data.balls;
  const unsettled = ballsCache.filter(b => !b.settled);
  $('#pinballUnsettled').innerHTML = unsettled.length
    ? `<table><thead><tr><th>소유자</th><th>종류</th></tr></thead><tbody>${unsettled.map(b => `<tr><td>${escapeHtml(b.player_name)}</td><td>${b.is_free ? '무료공' : '유료공'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">진행중인 공이 없어요. (모두 정산됨 / 아직 구매 없음)</div>';

  const opts = ['<option value="">선택 안함</option>'].concat(
    unsettled.map(b => `<option value="${b.id}">${escapeHtml(b.player_name)} (${b.is_free ? '무료' : '유료'})</option>`)
  ).join('');
  $('#rank1').innerHTML = opts;
  $('#rank2').innerHTML = opts;
  $('#rank3').innerHTML = opts;
}

$('#settleBtn').addEventListener('click', async () => {
  $('#pinballMsg').innerHTML = '';
  const rank1 = $('#rank1').value, rank2 = $('#rank2').value, rank3 = $('#rank3').value;
  if (!rank1 && !rank2 && !rank3) { $('#pinballMsg').innerHTML = '<div class="error-box">최소 1개 순위를 선택해주세요.</div>'; return; }
  if (!confirm('정산을 실행하면 선택되지 않은 모든 공은 소멸 처리됩니다. 계속할까요?')) return;
  try {
    await api('/api/pinball/settle', { method: 'POST', body: { rank1, rank2, rank3 } });
    $('#pinballMsg').innerHTML = '<div class="success-box">정산이 완료되었습니다.</div>';
    await loadPinball();
    await loadPlayers();
  } catch (e) {
    $('#pinballMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

$('#newRoundBtn').addEventListener('click', async () => {
  await api('/api/pinball/reset-round', { method: 'POST' });
  await loadPinball();
});

// ---------------- PLAYERS / ADJUST ----------------
$('#adjSearch').addEventListener('input', () => searchPlayerInto('adjSearch', 'adjResults', (p) => {
  adjPlayerId = p.id;
  $('#adjSelected').textContent = `선택됨: ${p.name} (잔여 ${fmt(p.chips)}칩)`;
  $('#adjResults').innerHTML = '';
  $('#adjSearch').value = '';
  updateAdjBtn();
}));
$('#adjDelta').addEventListener('input', updateAdjBtn);
function updateAdjBtn() {
  $('#adjBtn').disabled = !(adjPlayerId && Number($('#adjDelta').value));
}

$('#adjBtn').addEventListener('click', async () => {
  $('#adjMsg').innerHTML = '';
  try {
    await api('/api/admin/adjust', { method: 'POST', body: {
      playerId: adjPlayerId, delta: Number($('#adjDelta').value), reason: $('#adjReason').value.trim(),
    }});
    $('#adjMsg').innerHTML = '<div class="success-box">적용되었습니다.</div>';
    adjPlayerId = null; $('#adjSelected').textContent = ''; $('#adjDelta').value = ''; $('#adjReason').value = '';
    updateAdjBtn();
    await loadPlayers();
  } catch (e) {
    $('#adjMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

// ---------------- SETTINGS ----------------
async function loadSettings() {
  const data = await api('/api/admin/settings');
  const s = data.settings;
  $('#s_eventName').value = s.eventName;
  $('#s_startingChips').value = s.startingChips;
  $('#s_minBet').value = s.minBet;
  $('#s_defaultBoothMultiplier').value = s.defaultBoothMultiplier;
  $('#s_bountyThreshold').value = s.bountyThreshold;
  $('#s_bountyMode').value = s.bountyMode;
  $('#s_bountyMultiplierBonus').value = s.bountyMultiplierBonus;
  $('#s_bountyFlatBonus').value = s.bountyFlatBonus;
  $('#s_ballCost').value = s.ballCost;
  $('#s_freeBallsPerPlayer').value = s.freeBallsPerPlayer;
  $('#s_p1').value = Math.round((s.pinballPayouts[1] || 0) * 100);
  $('#s_p2').value = Math.round((s.pinballPayouts[2] || 0) * 100);
  $('#s_p3').value = Math.round((s.pinballPayouts[3] || 0) * 100);
  $('#s_jokerEligibleMaxChips').value = s.jokerEligibleMaxChips;
  $('#s_jokerBottleBonus').value = s.jokerBottleBonus;
  $('#s_jokerArmWrestleBonus').value = s.jokerArmWrestleBonus;
  $('#jokerMaxChipsLabel').textContent = s.jokerEligibleMaxChips;
  $('#jokerBottleLabel').textContent = s.jokerBottleBonus;
  $('#jokerArmLabel').textContent = s.jokerArmWrestleBonus;
}

$('#saveSettingsBtn').addEventListener('click', async () => {
  $('#settingsMsg').innerHTML = '';
  const body = {
    eventName: $('#s_eventName').value.trim(),
    startingChips: Number($('#s_startingChips').value),
    minBet: Number($('#s_minBet').value),
    defaultBoothMultiplier: Number($('#s_defaultBoothMultiplier').value),
    bountyThreshold: Number($('#s_bountyThreshold').value),
    bountyMode: $('#s_bountyMode').value,
    bountyMultiplierBonus: Number($('#s_bountyMultiplierBonus').value),
    bountyFlatBonus: Number($('#s_bountyFlatBonus').value),
    ballCost: Number($('#s_ballCost').value),
    freeBallsPerPlayer: Number($('#s_freeBallsPerPlayer').value),
    pinballPayouts: {
      1: Number($('#s_p1').value) / 100,
      2: Number($('#s_p2').value) / 100,
      3: Number($('#s_p3').value) / 100,
    },
    jokerEligibleMaxChips: Number($('#s_jokerEligibleMaxChips').value),
    jokerBottleBonus: Number($('#s_jokerBottleBonus').value),
    jokerArmWrestleBonus: Number($('#s_jokerArmWrestleBonus').value),
  };
  const newPin = $('#s_newAdminPin').value.trim();
  if (newPin) body.newAdminPin = newPin;
  try {
    await api('/api/admin/settings', { method: 'POST', body });
    if (newPin) { ADMIN_PIN = newPin; sessionStorage.setItem('adminPin', newPin); }
    $('#s_newAdminPin').value = '';
    $('#settingsMsg').innerHTML = '<div class="success-box">설정이 저장되었습니다.</div>';
  } catch (e) {
    $('#settingsMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

$('#resetBtn').addEventListener('click', async () => {
  $('#resetMsg').innerHTML = '';
  if (!confirm('정말로 전체 데이터를 초기화할까요? 이 작업은 되돌릴 수 없습니다.')) return;
  if (!confirm('한 번 더 확인합니다. 모든 참가자/배팅/경매/핀볼 기록이 삭제됩니다. 진행할까요?')) return;
  try {
    await api('/api/admin/reset', { method: 'POST', body: { resetBooths: $('#resetBoothsToo').checked } });
    $('#resetMsg').innerHTML = '<div class="success-box">초기화되었습니다.</div>';
    await loadAll();
  } catch (e) {
    $('#resetMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

boot();
