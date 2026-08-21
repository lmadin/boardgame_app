const $ = (sel) => document.querySelector(sel);
let awardsMode = false;

function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path) {
  const res = await fetch(path);
  return res.json();
}

function slotHtml(p, rankClass, medal) {
  if (!p) return `<div class="slot ${rankClass}"><div class="medal">${medal}</div><div class="pname muted">-</div><div class="pchips">-</div></div>`;
  return `<div class="slot ${rankClass} pop"><div class="medal">${medal}</div><div class="pname">${escapeHtml(p.name)}</div><div class="pchips">${fmt(p.chips)}</div></div>`;
}

function render(state) {
  $('#eventName').textContent = `🎲 ${state.settings.eventName}`;
  const players = state.leaderboard;

  // bounty strip
  const active = state.booths.filter(b => b.bountyActive);
  $('#bountyStrip').innerHTML = active.map(b => `<div class="bounty-banner">🔥 ${escapeHtml(b.name)} 현상금 발동중!</div>`).join('');

  // top 3 podium
  $('#podium').innerHTML =
    slotHtml(players[1], 'p2', '🥈') +
    slotHtml(players[0], 'p1', '🥇') +
    slotHtml(players[2], 'p3', '🥉');

  // rest 4+
  const rest = players.slice(3, 21);
  $('#restList').innerHTML = rest.map((p, i) => `
    <div class="rank-row"><div class="rank-num">${i + 4}</div><div class="rank-name">${escapeHtml(p.name)}</div><div class="rank-chips">${fmt(p.chips)}</div></div>
  `).join('') || '<div class="muted">-</div>';

  // awards screen
  $('#awardsPodium').innerHTML =
    slotHtml(players[1], 'p2', '🥈') +
    slotHtml(players[0], 'p1', '🥇') +
    slotHtml(players[2], 'p3', '🥉');
  $('#awardsGroup35').innerHTML = players.slice(3, 5).map(p => `
    <div class="slot pop"><div class="medal">🎖️</div><div class="pname">${escapeHtml(p.name)}</div><div class="pchips">${fmt(p.chips)}</div></div>
  `).join('');
}

function connectSocket() {
  const socket = io();
  socket.on('state:update', render);
}

$('#modeBtn').addEventListener('click', () => {
  awardsMode = !awardsMode;
  $('#mainScreen').style.display = awardsMode ? 'none' : 'block';
  $('#awardsScreen').style.display = awardsMode ? 'block' : 'none';
  $('#modeBtn').textContent = awardsMode ? '📺 실시간 순위로' : '🏆 시상식 모드';
});

(async () => {
  const state = await api('/api/state');
  render(state);
  connectSocket();
})();
