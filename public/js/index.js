const $ = (sel) => document.querySelector(sel);

let PLAYER_ID = localStorage.getItem('playerId');
let ballCount = 1;
let latestState = null;
let currentTab = 'rank';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.');
  return data;
}

function fmt(n) { return Number(n).toLocaleString('ko-KR'); }

function showRegister() {
  $('#registerScreen').style.display = 'block';
  $('#dashScreen').style.display = 'none';
}
function showDash() {
  $('#registerScreen').style.display = 'none';
  $('#dashScreen').style.display = 'block';
}

async function boot() {
  const state = await api('/api/state');
  $('#eventNameLabel').textContent = state.settings.eventName;
  $('#dashEventName').textContent = state.settings.eventName;
  $('#ballCostLabel').textContent = state.settings.ballCost;
  $('#freeBallCount').textContent = state.settings.freeBallsPerPlayer;
  latestState = state;
  renderLeaderboard(state.leaderboard);
  renderBounty(state.booths);

  if (PLAYER_ID) {
    try {
      await refreshMe();
      showDash();
    } catch (e) {
      localStorage.removeItem('playerId');
      PLAYER_ID = null;
      showRegister();
    }
  } else {
    showRegister();
  }
  connectSocket();
}

async function refreshMe() {
  const data = await api(`/api/players/${PLAYER_ID}`);
  $('#myChips').textContent = fmt(data.player.chips);
  $('#myName').textContent = data.player.name;
  $('#rankBadge').textContent = `${data.rank} / ${data.total}위`;
  renderHistory(data.bets, data.eventBonuses);
  renderMyBalls(data.balls);
  return data;
}

function renderLeaderboard(players) {
  const el = $('#leaderboardList');
  if (!players.length) { el.innerHTML = '<div class="muted center">아직 참가자가 없어요.</div>'; return; }
  const medals = ['🥇', '🥈', '🥉'];
  el.innerHTML = players.slice(0, 30).map((p, i) => {
    const cls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const marker = i < 3 ? `<div class="rank-medal">${medals[i]}</div>` : `<div class="rank-num">${i + 1}</div>`;
    const me = p.id === PLAYER_ID ? ' style="outline:1px solid var(--gold);"' : '';
    return `<div class="rank-row ${cls}"${me}>${marker}<div class="rank-name">${escapeHtml(p.name)}</div><div class="rank-chips">${fmt(p.chips)}</div></div>`;
  }).join('');
}

function renderBounty(booths) {
  const active = booths.filter(b => b.bountyActive);
  const el = $('#bountyBanner');
  if (!active.length) { el.innerHTML = ''; return; }
  el.innerHTML = active.map(b => `<div class="bounty-banner">🔥 현상금 부스! <b>${escapeHtml(b.name)}</b> — 지금 이기면 추가 보너스!</div>`).join('');
}

function renderMyBalls(balls) {
  const el = $('#myBallsList');
  if (!balls.length) { el.innerHTML = '아직 보유한 공이 없어요.'; return; }
  el.innerHTML = balls.map(b => {
    let status = '대기중';
    let cls = '';
    if (b.settled) {
      if (b.rank) { status = `${b.rank}등 🏅 +${fmt(b.payout)}칩`; cls = 'good'; }
      else { status = '탈락'; cls = 'critical'; }
    }
    return `<div class="list-row"><span>${b.is_free ? '무료공' : `유료공 (${fmt(b.cost)}칩)`}</span><span class="badge ${cls}">${status}</span></div>`;
  }).join('');
}

function renderHistory(bets, eventBonuses) {
  const el = $('#historyList');
  const rows = [];
  bets.forEach(b => {
    const win = b.result === 'win';
    const label = b.result === 'win' ? '승' : b.result === 'fold' ? '다이' : '패';
    rows.push({ time: b.created_at, html: `<div class="list-row">
      <span>${escapeHtml(b.booth_name)} ${b.bounty_applied ? '🔥' : ''}</span>
      <span class="badge ${win ? 'good' : 'critical'}">${label} ${b.payout >= 0 ? '+' : ''}${fmt(b.payout)}</span>
    </div>` });
  });
  (eventBonuses || []).forEach(e => {
    rows.push({ time: e.created_at, html: `<div class="list-row">
      <span>🎉 ${escapeHtml(e.label)}</span>
      <span class="badge good">+${fmt(e.amount)}</span>
    </div>` });
  });
  if (!rows.length) { el.innerHTML = '아직 배팅 기록이 없어요.'; return; }
  rows.sort((a, b) => b.time - a.time);
  el.innerHTML = rows.map(r => r.html).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function connectSocket() {
  const socket = io();
  socket.on('state:update', (state) => {
    latestState = state;
    renderLeaderboard(state.leaderboard);
    renderBounty(state.booths);
    if (PLAYER_ID) refreshMe().catch(() => {});
  });
}

$('#registerBtn').addEventListener('click', async () => {
  const name = $('#nameInput').value.trim();
  $('#registerError').innerHTML = '';
  if (!name) { $('#registerError').innerHTML = '<div class="error-box">이름을 입력해주세요.</div>'; return; }
  $('#registerBtn').disabled = true;
  try {
    const data = await api('/api/players/register', { method: 'POST', body: { name } });
    PLAYER_ID = data.player.id;
    localStorage.setItem('playerId', PLAYER_ID);
    await refreshMe();
    showDash();
  } catch (e) {
    $('#registerError').innerHTML = `<div class="error-box">${e.message}</div>`;
  } finally {
    $('#registerBtn').disabled = false;
  }
});
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#registerBtn').click(); });

document.querySelectorAll('.nav-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    ['rank', 'pinball', 'history'].forEach(t => {
      document.getElementById(`tab-${t}`).style.display = t === currentTab ? 'block' : 'none';
    });
  });
});

$('#ballMinus').addEventListener('click', () => { ballCount = Math.max(1, ballCount - 1); $('#ballCountDisplay').textContent = `${ballCount}개`; });
$('#ballPlus').addEventListener('click', () => { ballCount = Math.min(50, ballCount + 1); $('#ballCountDisplay').textContent = `${ballCount}개`; });

$('#buyBallBtn').addEventListener('click', async () => {
  $('#pinballMsg').innerHTML = '';
  $('#buyBallBtn').disabled = true;
  try {
    const data = await api('/api/pinball/buy', { method: 'POST', body: { playerId: PLAYER_ID, count: ballCount } });
    $('#pinballMsg').innerHTML = `<div class="success-box">${fmt(data.spent)}칩으로 공 ${ballCount}개 구매 완료!</div>`;
    ballCount = 1;
    $('#ballCountDisplay').textContent = '1개';
    await refreshMe();
  } catch (e) {
    $('#pinballMsg').innerHTML = `<div class="error-box">${e.message}</div>`;
  } finally {
    $('#buyBallBtn').disabled = false;
  }
});

boot();
