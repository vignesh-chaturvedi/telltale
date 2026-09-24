import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { WsGap } from "@telltale/hl";
import type { MinuteBar } from "./bars.ts";
import { dexConfig, type Universe } from "./universe.ts";

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dexes (
  name TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  deployer TEXT,
  oracle_updater TEXT,
  fee_recipient TEXT,
  collateral_token INTEGER NOT NULL,
  active INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS markets (
  coin TEXT PRIMARY KEY,
  dex TEXT NOT NULL,
  position INTEGER NOT NULL,
  sz_decimals INTEGER NOT NULL,
  max_leverage INTEGER NOT NULL,
  margin_table_id INTEGER,
  only_isolated INTEGER NOT NULL,
  margin_mode TEXT,
  growth_mode TEXT,
  is_delisted INTEGER NOT NULL,
  oi_cap_usd REAL,
  first_seen INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS minute_bars (
  coin TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ctx_source TEXT,
  ctx_updates INTEGER NOT NULL,
  oracle_px REAL,
  mark_px REAL,
  mid_px REAL,
  open_interest REAL,
  funding REAL,
  premium REAL,
  day_ntl_vlm REAL,
  oracle_changes INTEGER,
  oracle_max_gap_ms INTEGER,
  book_source TEXT,
  book_updates INTEGER NOT NULL,
  best_bid REAL,
  best_ask REAL,
  spread_bps REAL,
  bid_depth_1 REAL,
  ask_depth_1 REAL,
  bid_depth_2 REAL,
  ask_depth_2 REAL,
  bid_depth_5 REAL,
  ask_depth_5 REAL,
  min_depth_2 REAL,
  largest_level_usd REAL,
  reach_pct REAL,
  trades INTEGER NOT NULL,
  buy_ntl REAL NOT NULL,
  sell_ntl REAL NOT NULL,
  max_trade_ntl REAL NOT NULL,
  PRIMARY KEY (coin, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS minute_bars_ts ON minute_bars (ts);
CREATE TABLE IF NOT EXISTS config_snapshots (
  dex TEXT NOT NULL,
  ts INTEGER NOT NULL,
  hash TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (dex, ts)
);
CREATE TABLE IF NOT EXISTS ws_gaps (
  id INTEGER PRIMARY KEY,
  connection INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  subscriptions INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS health (
  ts INTEGER PRIMARY KEY,
  ws_open INTEGER NOT NULL,
  ws_connections INTEGER NOT NULL,
  subscriptions INTEGER NOT NULL,
  ws_received INTEGER NOT NULL,
  rest_weight INTEGER NOT NULL,
  bars INTEGER NOT NULL,
  bars_with_ctx INTEGER NOT NULL,
  bars_with_book INTEGER NOT NULL,
  db_bytes INTEGER NOT NULL
);
`;

export interface HealthRow {
  ts: number;
  wsOpen: number;
  wsConnections: number;
  subscriptions: number;
  wsReceived: number;
  restWeight: number;
  bars: number;
  barsWithCtx: number;
  barsWithBook: number;
  dbBytes: number;
}

const USD_FIELDS = [
  "dayNtlVlm", "bidDepth1", "askDepth1", "bidDepth2", "askDepth2", "bidDepth5", "askDepth5",
  "minDepth2", "largestLevelUsd", "buyNtl", "sellNtl", "maxTradeNtl",
] as const satisfies readonly (keyof MinuteBar)[];

/** Whole dollars are plenty for USD amounts, and SQLite stores small integers in fewer bytes than floats. */
function roundUsd(bar: MinuteBar): MinuteBar {
  const out = { ...bar };
  for (const f of USD_FIELDS) if (out[f] !== null) out[f] = Math.round(out[f]);
  return out;
}

/** SQLite storage for the collector. One file, WAL mode, safe to read while it writes. */
export class Store {
  readonly path: string;
  readonly db: DatabaseSync;
  private readonly insertBar: StatementSync;
  private readonly lastConfigHash: StatementSync;
  private readonly insertConfig: StatementSync;
  private readonly insertGap: StatementSync;
  private readonly insertHealth: StatementSync;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    const { user_version } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (user_version > SCHEMA_VERSION) throw new Error(`database schema v${user_version} is newer than this code (v${SCHEMA_VERSION})`);
    this.db.exec(SCHEMA);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

    this.insertBar = this.db.prepare(`
      INSERT OR REPLACE INTO minute_bars VALUES (
        :coin, :ts, :ctxSource, :ctxUpdates, :oraclePx, :markPx, :midPx, :openInterest, :funding, :premium,
        :dayNtlVlm, :oracleChanges, :oracleMaxGapMs, :bookSource, :bookUpdates, :bestBid, :bestAsk, :spreadBps,
        :bidDepth1, :askDepth1, :bidDepth2, :askDepth2, :bidDepth5, :askDepth5, :minDepth2, :largestLevelUsd,
        :reachPct, :trades, :buyNtl, :sellNtl, :maxTradeNtl
      )`);
    this.lastConfigHash = this.db.prepare("SELECT hash FROM config_snapshots WHERE dex = ? ORDER BY ts DESC LIMIT 1");
    this.insertConfig = this.db.prepare("INSERT OR REPLACE INTO config_snapshots (dex, ts, hash, body) VALUES (?, ?, ?, ?)");
    this.insertGap = this.db.prepare(
      "INSERT INTO ws_gaps (connection, started_at, ended_at, subscriptions, reason) VALUES (?, ?, ?, ?, ?)",
    );
    this.insertHealth = this.db.prepare(`
      INSERT OR REPLACE INTO health VALUES (
        :ts, :wsOpen, :wsConnections, :subscriptions, :wsReceived, :restWeight, :bars, :barsWithCtx, :barsWithBook, :dbBytes
      )`);
  }

  transaction(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  writeBars(bars: readonly MinuteBar[]): void {
    this.transaction(() => {
      for (const bar of bars) this.insertBar.run({ ...roundUsd(bar) });
    });
  }

  /** Upserts DEXs and markets, and stores a config snapshot for every DEX whose config changed. Returns those DEXs. */
  saveUniverse(universe: Universe): string[] {
    const changed: string[] = [];
    const at = universe.fetchedAt;
    const upsertDex = this.db.prepare(`
      INSERT INTO dexes VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET full_name = excluded.full_name, deployer = excluded.deployer,
        oracle_updater = excluded.oracle_updater, fee_recipient = excluded.fee_recipient,
        collateral_token = excluded.collateral_token, active = excluded.active, updated_at = excluded.updated_at`);
    const upsertMarket = this.db.prepare(`
      INSERT INTO markets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (coin) DO UPDATE SET dex = excluded.dex, position = excluded.position, sz_decimals = excluded.sz_decimals,
        max_leverage = excluded.max_leverage, margin_table_id = excluded.margin_table_id, only_isolated = excluded.only_isolated,
        margin_mode = excluded.margin_mode, growth_mode = excluded.growth_mode, is_delisted = excluded.is_delisted,
        oi_cap_usd = excluded.oi_cap_usd, updated_at = excluded.updated_at`);
    this.transaction(() => {
      for (const d of universe.dexes) {
        upsertDex.run(d.name, d.fullName, d.deployer, d.oracleUpdater, d.feeRecipient, d.collateralToken, d.active ? 1 : 0, at);
        const { body, hash } = dexConfig(universe, d.name);
        const last = this.lastConfigHash.get(d.name) as { hash: string } | undefined;
        if (last?.hash !== hash) {
          this.insertConfig.run(d.name, at, hash, body);
          changed.push(d.name);
        }
      }
      for (const m of universe.markets) {
        upsertMarket.run(
          m.coin, m.dex, m.position, m.szDecimals, m.maxLeverage, m.marginTableId, m.onlyIsolated ? 1 : 0,
          m.marginMode, m.growthMode, m.isDelisted ? 1 : 0, m.oiCapUsd, at, at,
        );
      }
    });
    return changed;
  }

  writeGap(gap: WsGap): void {
    this.insertGap.run(gap.connection, gap.startedAt, gap.endedAt, gap.subscriptions, gap.reason);
  }

  writeHealth(row: HealthRow): void {
    this.insertHealth.run({ ...row });
  }

  /** Database file plus its write-ahead log, in bytes. */
  sizeBytes(): number {
    if (this.path === ":memory:") return 0;
    const size = (p: string) => {
      try {
        return statSync(p).size;
      } catch {
        return 0;
      }
    };
    return size(this.path) + size(`${this.path}-wal`);
  }

  close(): void {
    this.db.close();
  }
}
