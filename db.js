const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// DATA_DIR lets a persistent disk (e.g. Render) be mounted somewhere other
// than the project folder. Locally / without a disk, it just uses this folder.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  chips INTEGER NOT NULL DEFAULT 100,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS booths (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'board', -- 'board' | 'mini'
  pin TEXT NOT NULL,
  base_multiplier REAL NOT NULL DEFAULT 2, -- 이 부스의 기본 배당 (승리 시 MC가 조정 가능)
  rule_note TEXT NOT NULL DEFAULT '',      -- MC 화면에 표시할 룰/배당 안내 메모
  win_streak INTEGER NOT NULL DEFAULT 0,   -- MC(운영진) 연승 카운트
  bounty_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL, -- '1v1' | '1v3'
  stake INTEGER NOT NULL,
  result TEXT NOT NULL, -- 'win' | 'lose' | 'fold'
  multiplier REAL NOT NULL,
  bounty_applied INTEGER NOT NULL DEFAULT 0,
  payout INTEGER NOT NULL, -- 순변동액 (양수/음수)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_bonuses (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'joker', -- 조커 이벤트 등 배팅 없는 보너스 지급 기록
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_sales (
  id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  winner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pinball_balls (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  is_free INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  rank INTEGER, -- 1,2,3 or null
  payout INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adjustments (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
`);

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

const DEFAULTS = {
  startingChips: 100,
  minBet: 5,
  defaultBoothMultiplier: 2, // 새 부스를 만들 때 채워지는 기본값 (부스별로 이후 자유롭게 조정)
  bountyThreshold: 5,       // MC 연승 몇 번부터 현상금 부스
  bountyMode: 'multiplier', // 'multiplier' | 'flat'
  bountyMultiplierBonus: 1, // 배당에 추가로 더해지는 배수 (x2 -> x3)
  bountyFlatBonus: 50,      // flat 모드일 때 추가 지급 칩
  ballCost: 10,
  freeBallsPerPlayer: 1,
  ballBaselineValue: 10,    // 무료공도 이 값 기준으로 정산 (0이면 진짜 투자금 기준)
  pinballPayouts: { 1: 2.5, 2: 1.8, 3: 1.2 },
  jokerEligibleMaxChips: 10, // 조커 이벤트 참가 가능한 최대 잔여칩
  jokerBottleBonus: 10,      // 물병세우기 성공 보너스
  jokerArmWrestleBonus: 15,  // 팔씨름 승리 보너스
  adminPin: '1234',
  eventName: 'MT 보드게임장',
};

function initDefaults() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (getSetting(k, undefined) === undefined) setSetting(k, v);
  }
}
initDefaults();

module.exports = { db, getSetting, setSetting, DEFAULTS };
