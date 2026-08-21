const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const { db, getSetting, setSetting, DEFAULTS } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const now = () => Date.now();
const round = (n) => Math.round(n);

function randPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.display_name, chips: p.chips,
    wins: p.wins, losses: p.losses,
  };
}

function publicBooth(b) {
  return {
    id: b.id, name: b.name, type: b.type,
    baseMultiplier: b.base_multiplier,
    ruleNote: b.rule_note,
    winStreak: b.win_streak,
    bountyActive: !!b.bounty_active,
  };
}

function getLeaderboard(limit = 500) {
  const rows = db.prepare('SELECT * FROM players ORDER BY chips DESC, wins DESC, created_at ASC LIMIT ?').all(limit);
  return rows.map(publicPlayer);
}

function getBooths() {
  return db.prepare('SELECT * FROM booths ORDER BY created_at ASC').all().map(publicBooth);
}

function broadcastState() {
  io.emit('state:update', {
    leaderboard: getLeaderboard(),
    booths: getBooths(),
    settings: publicSettings(),
  });
}

function publicSettings() {
  return {
    eventName: getSetting('eventName', DEFAULTS.eventName),
    minBet: getSetting('minBet', DEFAULTS.minBet),
    defaultBoothMultiplier: getSetting('defaultBoothMultiplier', DEFAULTS.defaultBoothMultiplier),
    bountyThreshold: getSetting('bountyThreshold', DEFAULTS.bountyThreshold),
    bountyMode: getSetting('bountyMode', DEFAULTS.bountyMode),
    bountyMultiplierBonus: getSetting('bountyMultiplierBonus', DEFAULTS.bountyMultiplierBonus),
    bountyFlatBonus: getSetting('bountyFlatBonus', DEFAULTS.bountyFlatBonus),
    ballCost: getSetting('ballCost', DEFAULTS.ballCost),
    freeBallsPerPlayer: getSetting('freeBallsPerPlayer', DEFAULTS.freeBallsPerPlayer),
    ballBaselineValue: getSetting('ballBaselineValue', DEFAULTS.ballBaselineValue),
    pinballPayouts: getSetting('pinballPayouts', DEFAULTS.pinballPayouts),
    startingChips: getSetting('startingChips', DEFAULTS.startingChips),
    jokerEligibleMaxChips: getSetting('jokerEligibleMaxChips', DEFAULTS.jokerEligibleMaxChips),
    jokerBottleBonus: getSetting('jokerBottleBonus', DEFAULTS.jokerBottleBonus),
    jokerArmWrestleBonus: getSetting('jokerArmWrestleBonus', DEFAULTS.jokerArmWrestleBonus),
  };
}

// seed the 9 confirmed games on first run (from the finalized 부스 설명 팻말 doc)
const BOOTH_SEED = [
  { name: 'A. 할리갈리', type: 'board', mc: '최시원', baseMultiplier: 1.5,
    rule: '[최시원] 엠준위보다 등수 앞설 때마다 +0.5배 (1등수차=1.5배, 2등수차=2배, 3등수차=2.5배 최대). 승리 시 배당을 직접 입력하세요. 최소 배팅 5칩.' },
  { name: 'B. 다빈치코드', type: 'board', mc: '박민강', baseMultiplier: 1.5,
    rule: '[박민강] 엠준위보다 등수 앞설 때마다 +0.5배 (1등수차=1.5배, 2등수차=2배, 3등수차=2.5배 최대). 승리 시 배당을 직접 입력하세요. 최소 배팅 5칩.' },
  { name: 'C. 세트', type: 'board', mc: '최가은', baseMultiplier: 1.5,
    rule: '[최가은] 엠준위보다 등수 앞설 때마다 +0.5배 (1등수차=1.5배, 2등수차=2배, 3등수차=2.5배 최대). 승리 시 배당을 직접 입력하세요. 최소 배팅 5칩.' },
  { name: 'D. 펭귄 얼음깨기', type: 'board', mc: '지민', baseMultiplier: 1.5,
    rule: '[지민] 엠준위 또는 다른 참가자가 펭귄을 떨어뜨리면 그 순간 생존해있는 나머지 참가자 전원 승리(1.5배). 참가자 1~2명. 최소 배팅 5칩.' },
  { name: 'E. 랜덤 술게임 데스매치', type: 'mini', mc: '임규민', baseMultiplier: 1.5,
    rule: '[임규민] 2분 타임어택, 걸린 횟수가 엠준위보다 적으면 승리(1.5배), 같거나 많으면 엠준위 승. 참가자 3명. 최소 배팅 5칩.' },
  { name: 'F. 알까기', type: 'mini', mc: '정다율', baseMultiplier: 2,
    rule: '[정다율] 엠준위 돌을 먼저 전부 떨어뜨리면 승리(2배). 1:1 전용. 최소 배팅 5칩.' },
  { name: 'G. 인디언 홀덤', type: 'mini', mc: '최은혁', baseMultiplier: 1.5,
    rule: '[최은혁] 숫자 높은 쪽 승리, 등수차만큼 +0.5배(최대 2.5배). 다이(폴드) 선택 시 베팅칩 절반만 소멸 — "다이" 버튼 사용. 참가자 1~3명. 최소 배팅 5칩.' },
  { name: 'H. 라이어 (1부)', type: 'mini', mc: '임영진', baseMultiplier: 1.5,
    rule: '[임영진] 그룹이 라이어 지목 성공 시 라이어 제외 전원 1.5배, 라이어가 이기면 라이어만 2배 (나머지는 패). 참가자별로 배당을 다르게 입력하세요. 참가자 3명. 1부에만 진행.' },
  { name: 'I. 끝말잇기 (2부)', type: 'mini', mc: '임영진', baseMultiplier: 1.5,
    rule: '[임영진] 엠준위보다 오래 살아남으면 승리(1.5배). 참가자간 순위는 따지지 않음. 참가자 3명. 2부에만 진행 — 1부에는 배팅받지 마세요.' },
];

// seed default booths on first run
function seedBooths() {
  const count = db.prepare('SELECT COUNT(*) c FROM booths').get().c;
  if (count > 0) return;
  const insert = db.prepare(`INSERT INTO booths (id,name,type,pin,base_multiplier,rule_note,win_streak,bounty_active,created_at)
    VALUES (?,?,?,?,?,?,0,0,?)`);
  const usedPins = new Set();
  const mkPin = () => { let p; do { p = randPin(); } while (usedPins.has(p)); usedPins.add(p); return p; };
  for (const b of BOOTH_SEED) {
    insert.run(nanoid(), b.name, b.type, mkPin(), b.baseMultiplier, b.rule, now());
  }
}
seedBooths();

function adminAuth(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body?.adminPin;
  const real = getSetting('adminPin', DEFAULTS.adminPin);
  if (pin !== real) return res.status(401).json({ error: '관리자 PIN이 올바르지 않습니다.' });
  next();
}

function boothAuth(req, res, next) {
  const boothId = req.params.id;
  const pin = req.headers['x-booth-pin'] || req.body?.pin;
  const booth = db.prepare('SELECT * FROM booths WHERE id = ?').get(boothId);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });
  if (booth.pin !== pin) return res.status(401).json({ error: '부스 PIN이 올바르지 않습니다.' });
  req.booth = booth;
  next();
}

// ---------- players ----------
app.post('/api/players/register', (req, res) => {
  let { name } = req.body;
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: '이름을 입력해주세요.' });
  if (name.length > 20) return res.status(400).json({ error: '이름이 너무 깁니다.' });

  const existing = db.prepare('SELECT * FROM players WHERE name = ?').all(name);
  let displayName = name;
  if (existing.length > 0) {
    displayName = `${name}(${existing.length + 1})`;
  }

  const id = nanoid();
  const startingChips = getSetting('startingChips', DEFAULTS.startingChips);
  db.prepare(`INSERT INTO players (id,name,display_name,chips,wins,losses,created_at)
    VALUES (?,?,?,?,0,0,?)`).run(id, name, displayName, startingChips, now());

  // grant free pinball ball(s)
  const freeBalls = getSetting('freeBallsPerPlayer', DEFAULTS.freeBallsPerPlayer);
  const insBall = db.prepare(`INSERT INTO pinball_balls (id,player_id,is_free,cost,settled,created_at) VALUES (?,?,1,0,0,?)`);
  for (let i = 0; i < freeBalls; i++) insBall.run(nanoid(), id, now());

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  broadcastState();
  res.json({ player: publicPlayer(player), duplicateWarning: existing.length > 0 });
});

app.get('/api/players/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '참가자를 찾을 수 없습니다.' });
  const leaderboard = getLeaderboard();
  const rank = leaderboard.findIndex(x => x.id === p.id) + 1;
  const bets = db.prepare(`SELECT b.*, bo.name as booth_name FROM bets b
    JOIN booths bo ON bo.id = b.booth_id WHERE b.player_id = ? ORDER BY b.created_at DESC LIMIT 50`).all(p.id);
  const balls = db.prepare('SELECT * FROM pinball_balls WHERE player_id = ? ORDER BY created_at DESC').all(p.id);
  const eventBonuses = db.prepare('SELECT * FROM event_bonuses WHERE player_id = ? ORDER BY created_at DESC').all(p.id);
  res.json({ player: publicPlayer(p), rank, total: leaderboard.length, bets, balls, eventBonuses });
});

app.get('/api/players', (req, res) => {
  res.json({ players: getLeaderboard() });
});

// ---------- booths ----------
app.get('/api/booths', (req, res) => {
  res.json({ booths: getBooths() });
});

app.post('/api/booth/login', (req, res) => {
  const { pin } = req.body;
  const booth = db.prepare('SELECT * FROM booths WHERE pin = ?').get(pin);
  if (!booth) return res.status(401).json({ error: 'PIN이 올바르지 않습니다.' });
  res.json({ booth: { ...publicBooth(booth), pin: booth.pin } });
});

app.get('/api/booth/:id', (req, res) => {
  const booth = db.prepare('SELECT * FROM booths WHERE id = ?').get(req.params.id);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });
  const recent = db.prepare(`SELECT b.*, p.display_name as player_name FROM bets b
    JOIN players p ON p.id = b.player_id WHERE b.booth_id = ? ORDER BY b.created_at DESC LIMIT 20`).all(booth.id);
  res.json({ booth: publicBooth(booth), recent });
});

// place one or more bet entries at a booth (supports 1v1 / 1v3 in one submit)
// entries: [{playerId, stake, result: 'win'|'lose'|'fold', multiplier?}]
// multiplier is only used/required for 'win' entries — MC can type the exact payout for
// that hand (등수차/다이/역할별 배당 등 게임마다 다른 룰을 서버가 강제하지 않고 MC 판단에 맡김).
// The server always adds the 현상금(bounty) bonus on top automatically, so the multiplier
// the MC enters should NOT already include the bounty bonus.
app.post('/api/booth/:id/bet', boothAuth, (req, res) => {
  const booth = req.booth;
  const { mode, entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: '배팅 정보가 없습니다.' });
  }
  if (mode === '1v1' && entries.length !== 1) {
    return res.status(400).json({ error: '1:1 모드는 참가자 1명만 선택해주세요.' });
  }
  if (mode === '1v3' && (entries.length < 1 || entries.length > 3)) {
    return res.status(400).json({ error: '1:3 모드는 참가자 최대 3명까지 선택해주세요.' });
  }

  const minBet = getSetting('minBet', DEFAULTS.minBet);
  const bountyThreshold = getSetting('bountyThreshold', DEFAULTS.bountyThreshold);
  const bountyMode = getSetting('bountyMode', DEFAULTS.bountyMode);
  const bountyMultiplierBonus = getSetting('bountyMultiplierBonus', DEFAULTS.bountyMultiplierBonus);
  const bountyFlatBonus = getSetting('bountyFlatBonus', DEFAULTS.bountyFlatBonus);

  // pre-validate all entries before mutating anything
  const players = {};
  for (const e of entries) {
    if (!e.playerId || !['win', 'lose', 'fold'].includes(e.result)) {
      return res.status(400).json({ error: '잘못된 배팅 정보입니다.' });
    }
    const stake = Number(e.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      return res.status(400).json({ error: '배팅칩은 0보다 커야 합니다.' });
    }
    if (stake < minBet) {
      return res.status(400).json({ error: `최소 배팅칩은 ${minBet}칩입니다.` });
    }
    if (e.result === 'win') {
      const m = Number(e.multiplier);
      if (!Number.isFinite(m) || m <= 0 || m > 10) {
        return res.status(400).json({ error: '배당 값이 올바르지 않습니다 (0보다 크고 10 이하).' });
      }
    }
    const p = db.prepare('SELECT * FROM players WHERE id = ?').get(e.playerId);
    if (!p) return res.status(404).json({ error: '참가자를 찾을 수 없습니다.' });
    if (stake > p.chips) {
      return res.status(400).json({ error: `${p.display_name}님의 잔여칩(${p.chips})을 초과하는 배팅입니다.` });
    }
    players[e.playerId] = p;
  }

  const results = [];
  const txn = db.transaction(() => {
    let streak = booth.win_streak;
    let bountyActive = booth.bounty_active;

    for (const e of entries) {
      const stake = round(Number(e.stake));
      const p = players[e.playerId];
      let bountyApplied = false;
      let effectiveMultiplier = 0;
      let payout; // net chip change

      if (e.result === 'win') {
        effectiveMultiplier = Number(e.multiplier);
        if (bountyActive) {
          bountyApplied = true;
          if (bountyMode === 'multiplier') effectiveMultiplier += bountyMultiplierBonus;
        }
        const grossReturn = round(stake * effectiveMultiplier);
        const flatBonus = (bountyApplied && bountyMode === 'flat') ? bountyFlatBonus : 0;
        payout = (grossReturn - stake) + flatBonus;
        streak = 0;
        bountyActive = false;
        db.prepare('UPDATE players SET chips = chips + ?, wins = wins + 1 WHERE id = ?').run(payout, p.id);
      } else if (e.result === 'fold') {
        payout = -round(stake / 2);
        streak += 1;
        if (streak >= bountyThreshold) bountyActive = true;
        db.prepare('UPDATE players SET chips = chips + ?, losses = losses + 1 WHERE id = ?').run(payout, p.id);
      } else {
        payout = -stake;
        streak += 1;
        if (streak >= bountyThreshold) bountyActive = true;
        db.prepare('UPDATE players SET chips = chips + ?, losses = losses + 1 WHERE id = ?').run(payout, p.id);
      }

      const betId = nanoid();
      db.prepare(`INSERT INTO bets (id,booth_id,player_id,mode,stake,result,multiplier,bounty_applied,payout,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        betId, booth.id, p.id, mode, stake, e.result, effectiveMultiplier, bountyApplied ? 1 : 0, payout, now()
      );
      results.push({ playerId: p.id, playerName: p.display_name, result: e.result, payout, bountyApplied });
    }

    db.prepare('UPDATE booths SET win_streak = ?, bounty_active = ? WHERE id = ?')
      .run(streak, bountyActive ? 1 : 0, booth.id);
  });

  try {
    txn();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '처리 중 오류가 발생했습니다.' });
  }

  broadcastState();
  const updatedBooth = db.prepare('SELECT * FROM booths WHERE id = ?').get(booth.id);
  res.json({ results, booth: publicBooth(updatedBooth) });
});

// ---------- market ----------
app.post('/api/market/sale', (req, res) => {
  const { itemName, price, winnerId } = req.body;
  const name = (itemName || '').trim();
  const p = Number(price);
  if (!name) return res.status(400).json({ error: '품목명을 입력해주세요.' });
  if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: '낙찰가가 올바르지 않습니다.' });
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(winnerId);
  if (!player) return res.status(404).json({ error: '낙찰자를 찾을 수 없습니다.' });
  if (p > player.chips) return res.status(400).json({ error: `잔여칩(${player.chips})을 초과하는 낙찰가입니다.` });

  db.prepare('UPDATE players SET chips = chips - ? WHERE id = ?').run(round(p), player.id);
  const id = nanoid();
  db.prepare(`INSERT INTO market_sales (id,item_name,price,winner_id,created_at) VALUES (?,?,?,?,?)`)
    .run(id, name, round(p), player.id, now());

  broadcastState();
  res.json({ ok: true });
});

app.get('/api/market/sales', (req, res) => {
  const rows = db.prepare(`SELECT m.*, p.display_name as winner_name FROM market_sales m
    JOIN players p ON p.id = m.winner_id ORDER BY m.created_at DESC LIMIT 100`).all();
  res.json({ sales: rows });
});

// ---------- pinball ----------
app.post('/api/pinball/buy', (req, res) => {
  const { playerId, count } = req.body;
  const c = Number(count);
  if (!Number.isInteger(c) || c <= 0) return res.status(400).json({ error: '구매 개수가 올바르지 않습니다.' });
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: '참가자를 찾을 수 없습니다.' });
  const ballCost = getSetting('ballCost', DEFAULTS.ballCost);
  const totalCost = ballCost * c;
  if (totalCost > player.chips) return res.status(400).json({ error: `잔여칩(${player.chips})이 부족합니다.` });

  const txn = db.transaction(() => {
    db.prepare('UPDATE players SET chips = chips - ? WHERE id = ?').run(totalCost, player.id);
    const ins = db.prepare(`INSERT INTO pinball_balls (id,player_id,is_free,cost,settled,created_at) VALUES (?,?,0,?,0,?)`);
    for (let i = 0; i < c; i++) ins.run(nanoid(), player.id, ballCost, now());
  });
  txn();
  broadcastState();
  res.json({ ok: true, spent: totalCost });
});

app.get('/api/pinball/balls', (req, res) => {
  const rows = db.prepare(`SELECT pb.*, p.display_name as player_name FROM pinball_balls pb
    JOIN players p ON p.id = pb.player_id ORDER BY pb.created_at ASC`).all();
  res.json({ balls: rows });
});

app.post('/api/pinball/settle', adminAuth, (req, res) => {
  const { rank1, rank2, rank3 } = req.body; // ball ids
  const ranked = [[1, rank1], [2, rank2], [3, rank3]].filter(([, id]) => id);
  if (ranked.length === 0) return res.status(400).json({ error: '순위를 최소 1개 이상 입력해주세요.' });
  const ids = new Set(ranked.map(([, id]) => id));
  if (ids.size !== ranked.length) return res.status(400).json({ error: '같은 공을 여러 순위에 넣을 수 없습니다.' });

  const payouts = getSetting('pinballPayouts', DEFAULTS.pinballPayouts);
  const baseline = getSetting('ballBaselineValue', DEFAULTS.ballBaselineValue);

  const txn = db.transaction(() => {
    const allUnsettled = db.prepare('SELECT * FROM pinball_balls WHERE settled = 0').all();
    for (const ball of allUnsettled) {
      const found = ranked.find(([, id]) => id === ball.id);
      if (found) {
        const [rank] = found;
        const base = ball.is_free ? baseline : ball.cost;
        const payout = round(base * (payouts[rank] || 0));
        db.prepare('UPDATE pinball_balls SET rank = ?, payout = ?, settled = 1 WHERE id = ?').run(rank, payout, ball.id);
        db.prepare('UPDATE players SET chips = chips + ? WHERE id = ?').run(payout, ball.player_id);
      } else {
        db.prepare('UPDATE pinball_balls SET rank = NULL, payout = 0, settled = 1 WHERE id = ?').run(ball.id);
      }
    }
  });
  txn();
  broadcastState();
  res.json({ ok: true });
});

app.post('/api/pinball/reset-round', adminAuth, (req, res) => {
  // clears settlement so a new pinball round can be run; does NOT refund/undo chip changes
  db.prepare('DELETE FROM pinball_balls WHERE settled = 1').run();
  broadcastState();
  res.json({ ok: true });
});

// ---------- admin ----------
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  const real = getSetting('adminPin', DEFAULTS.adminPin);
  if (pin !== real) return res.status(401).json({ error: 'PIN이 올바르지 않습니다.' });
  res.json({ ok: true });
});

app.get('/api/admin/booths', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM booths ORDER BY created_at ASC').all();
  res.json({ booths: rows });
});

app.post('/api/admin/booths', adminAuth, (req, res) => {
  const { name, type, baseMultiplier, ruleNote } = req.body;
  if (!name || !['board', 'mini'].includes(type)) return res.status(400).json({ error: '입력값이 올바르지 않습니다.' });
  const m = Number(baseMultiplier);
  const finalMultiplier = Number.isFinite(m) && m > 0 ? m : getSetting('defaultBoothMultiplier', DEFAULTS.defaultBoothMultiplier);
  const id = nanoid();
  const pin = randPin();
  db.prepare(`INSERT INTO booths (id,name,type,pin,base_multiplier,rule_note,win_streak,bounty_active,created_at)
    VALUES (?,?,?,?,?,?,0,0,?)`).run(id, name, type, pin, finalMultiplier, ruleNote || '', now());
  broadcastState();
  res.json({ booth: db.prepare('SELECT * FROM booths WHERE id = ?').get(id) });
});

app.put('/api/admin/booths/:id', adminAuth, (req, res) => {
  const booth = db.prepare('SELECT * FROM booths WHERE id = ?').get(req.params.id);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });
  const { name, type, baseMultiplier, ruleNote, pin, resetStreak } = req.body;
  const m = Number(baseMultiplier);
  db.prepare(`UPDATE booths SET name = ?, type = ?, base_multiplier = ?, rule_note = ?, pin = ?,
    win_streak = ?, bounty_active = ? WHERE id = ?`).run(
    name ?? booth.name,
    type ?? booth.type,
    (baseMultiplier === undefined || !Number.isFinite(m) || m <= 0) ? booth.base_multiplier : m,
    ruleNote === undefined ? booth.rule_note : ruleNote,
    pin ?? booth.pin,
    resetStreak ? 0 : booth.win_streak,
    resetStreak ? 0 : booth.bounty_active,
    booth.id
  );
  broadcastState();
  res.json({ booth: db.prepare('SELECT * FROM booths WHERE id = ?').get(booth.id) });
});

app.delete('/api/admin/booths/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM booths WHERE id = ?').run(req.params.id);
  broadcastState();
  res.json({ ok: true });
});

app.post('/api/admin/adjust', adminAuth, (req, res) => {
  const { playerId, delta, reason } = req.body;
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return res.status(400).json({ error: '조정값이 올바르지 않습니다.' });
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: '참가자를 찾을 수 없습니다.' });
  const newChips = Math.max(0, player.chips + d);
  db.prepare('UPDATE players SET chips = ? WHERE id = ?').run(newChips, player.id);
  db.prepare('INSERT INTO adjustments (id,player_id,delta,reason,created_at) VALUES (?,?,?,?,?)')
    .run(nanoid(), player.id, newChips - player.chips, reason || '', now());
  broadcastState();
  res.json({ ok: true, player: publicPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id)) });
});

// 조커 이벤트 (1부·2부 사이 패자부활전) — 배팅 없이 고정 보너스 칩 지급
app.post('/api/admin/joker-bonus', adminAuth, (req, res) => {
  const { playerId, label, amount } = req.body;
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ error: '지급할 칩 수가 올바르지 않습니다.' });
  if (!label || !String(label).trim()) return res.status(400).json({ error: '라벨을 입력해주세요.' });
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: '참가자를 찾을 수 없습니다.' });

  const txn = db.transaction(() => {
    db.prepare('UPDATE players SET chips = chips + ? WHERE id = ?').run(round(a), player.id);
    db.prepare('INSERT INTO event_bonuses (id,player_id,category,label,amount,created_at) VALUES (?,?,?,?,?,?)')
      .run(nanoid(), player.id, 'joker', String(label).trim(), round(a), now());
  });
  txn();
  broadcastState();
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
  const bonuses = db.prepare(`SELECT * FROM event_bonuses WHERE player_id = ? AND category = 'joker' ORDER BY created_at DESC`).all(player.id);
  res.json({ player: publicPlayer(updated), bonuses });
});

app.get('/api/admin/settings', adminAuth, (req, res) => {
  res.json({ settings: publicSettings() });
});

app.post('/api/admin/settings', adminAuth, (req, res) => {
  const allowed = Object.keys(DEFAULTS).filter(k => k !== 'adminPin');
  for (const key of allowed) {
    if (req.body[key] !== undefined) setSetting(key, req.body[key]);
  }
  if (req.body.newAdminPin) setSetting('adminPin', String(req.body.newAdminPin));
  broadcastState();
  res.json({ settings: publicSettings() });
});

app.post('/api/admin/reset', adminAuth, (req, res) => {
  const { resetBooths } = req.body;
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM players').run();
    db.prepare('DELETE FROM bets').run();
    db.prepare('DELETE FROM market_sales').run();
    db.prepare('DELETE FROM pinball_balls').run();
    db.prepare('DELETE FROM adjustments').run();
    db.prepare('DELETE FROM event_bonuses').run();
    if (resetBooths) {
      db.prepare('DELETE FROM booths').run();
      seedBooths();
    } else {
      db.prepare('UPDATE booths SET win_streak = 0, bounty_active = 0').run();
    }
  });
  txn();
  broadcastState();
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM players ORDER BY chips DESC').all();
  let csv = '순위,이름,잔여칩,승,패\n';
  rows.forEach((p, i) => {
    csv += `${i + 1},${p.display_name},${p.chips},${p.wins},${p.losses}\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ranking.csv"');
  res.send('﻿' + csv);
});

// ---------- state ----------
app.get('/api/state', (req, res) => {
  res.json({
    leaderboard: getLeaderboard(),
    booths: getBooths(),
    settings: publicSettings(),
  });
});

io.on('connection', (socket) => {
  socket.emit('state:update', {
    leaderboard: getLeaderboard(),
    booths: getBooths(),
    settings: publicSettings(),
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행중: http://localhost:${PORT}`);
});
