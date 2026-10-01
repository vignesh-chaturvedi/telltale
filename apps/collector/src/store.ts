import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { BarInput, Severity, Signal, WallEvent } from "@telltale/detectors";
import type { Candle, WsGap } from "@telltale/hl";
import type { MinuteBar } from "./bars.ts";
import { BAR_COLUMNS } from "./scoring.ts";
import { dexConfig, type Universe } from "./universe.ts";

export const SCHEMA_VERSION = 4;

/** Version 1: the Phase 1 schema. Later versions are applied by MIGRATIONS. */
export const SCHEMA_V1 = `
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

/** Each entry upgrades the schema by one version: MIGRATIONS[0] takes v1 to v2. */
const MIGRATIONS = [
  `
  ALTER TABLE dexes ADD COLUMN collateral TEXT;
  CREATE TABLE daily_candles (
    coin TEXT NOT NULL,
    day INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (coin, day)
  ) WITHOUT ROWID;
  `,
  // Minute bars older than the retention window are rolled into these. Prices, open interest and
  // funding are the last minute's; depth and spread are averages; the rest are sums or extremes.
  `
  CREATE TABLE bars_15m (
    coin TEXT NOT NULL,
    ts INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    oracle_px REAL,
    mark_px REAL,
    mid_px REAL,
    mid_high REAL,
    mid_low REAL,
    open_interest REAL,
    funding REAL,
    day_ntl_vlm REAL,
    oracle_gap_max_bps REAL,
    oracle_max_gap_ms INTEGER,
    spread_bps REAL,
    bid_depth_1 REAL,
    ask_depth_1 REAL,
    bid_depth_2 REAL,
    ask_depth_2 REAL,
    bid_depth_5 REAL,
    ask_depth_5 REAL,
    min_depth_2 REAL,
    trades INTEGER NOT NULL,
    buy_ntl REAL NOT NULL,
    sell_ntl REAL NOT NULL,
    max_trade_ntl REAL NOT NULL,
    PRIMARY KEY (coin, ts)
  ) WITHOUT ROWID;
  `,
  // Alerts, and the order-book walls behind pulled-wall alerts.
  `
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    coin TEXT,
    dex TEXT NOT NULL,
    severity TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    minutes INTEGER NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    evidence TEXT NOT NULL,
    published_at INTEGER
  );
  CREATE INDEX alerts_started ON alerts (started_at);
  CREATE INDEX alerts_coin ON alerts (coin, started_at);
  CREATE TABLE book_events (
    coin TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    side TEXT NOT NULL,
    px REAL NOT NULL,
    peak_usd REAL NOT NULL,
    side_depth_usd REAL NOT NULL,
    filled_usd REAL NOT NULL,
    first_seen INTEGER NOT NULL
  );
  CREATE INDEX book_events_ts ON book_events (ts);
  CREATE INDEX book_events_coin ON book_events (coin, ts);
  `,
];

export const ROLLUP_MS = 15 * 60_000;

// Integer division buckets each minute into its quarter hour. The literal keeps it integer
// arithmetic, since bound JS numbers arrive as REAL.
const ROLLUP_SQL = `
WITH agg AS (
  SELECT coin, (ts / ${ROLLUP_MS}) * ${ROLLUP_MS} AS bucket, MAX(ts) AS last_ts, COUNT(*) AS minutes,
    MAX(mid_px) AS mid_high, MIN(mid_px) AS mid_low,
    ROUND(MAX(CASE WHEN oracle_px > 0 AND mid_px IS NOT NULL THEN ABS(mid_px - oracle_px) / oracle_px * 10000 END), 2) AS gap_bps,
    MAX(oracle_max_gap_ms) AS oracle_max_gap_ms, AVG(spread_bps) AS spread_bps,
    ROUND(AVG(bid_depth_1)) AS bid_depth_1, ROUND(AVG(ask_depth_1)) AS ask_depth_1,
    ROUND(AVG(bid_depth_2)) AS bid_depth_2, ROUND(AVG(ask_depth_2)) AS ask_depth_2,
    ROUND(AVG(bid_depth_5)) AS bid_depth_5, ROUND(AVG(ask_depth_5)) AS ask_depth_5,
    MIN(min_depth_2) AS min_depth_2, SUM(trades) AS trades, SUM(buy_ntl) AS buy_ntl, SUM(sell_ntl) AS sell_ntl,
    MAX(max_trade_ntl) AS max_trade_ntl
  FROM minute_bars WHERE ts < :cutoff GROUP BY coin, bucket
)
INSERT OR REPLACE INTO bars_15m
SELECT a.coin, a.bucket, a.minutes, b.oracle_px, b.mark_px, b.mid_px, a.mid_high, a.mid_low, b.open_interest, b.funding,
  b.day_ntl_vlm, a.gap_bps, a.oracle_max_gap_ms, a.spread_bps, a.bid_depth_1, a.ask_depth_1, a.bid_depth_2, a.ask_depth_2,
  a.bid_depth_5, a.ask_depth_5, a.min_depth_2, a.trades, a.buy_ntl, a.sell_ntl, a.max_trade_ntl
FROM agg a JOIN minute_bars b ON b.coin = a.coin AND b.ts = a.last_ts`;

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

/** A stored alert. Minute alerts stay open while their condition holds; events open and close at once. */
export interface AlertRecord {
  id: number;
  kind: Signal["kind"];
  coin: string | null;
  dex: string;
  severity: Severity;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  /** Minutes the condition held. */
  minutes: number;
  title: string;
  detail: string;
  evidence: Signal["evidence"];
  publishedAt: number | null;
}

/** What the alert engine needs from storage, so replays can run it in memory. */
export interface AlertStore {
  insertAlert(alert: Omit<AlertRecord, "id">): number;
  updateAlert(alert: AlertRecord): void;
  /** Alerts still open, and every alert started since `since`, oldest first. */
  loadAlerts(since: number): AlertRecord[];
}

/** A DEX whose config changed in a refresh, with the stored snapshot before it (`null` the first time). */
export interface ConfigUpdate {
  dex: string;
  fullName: string;
  before: string | null;
  after: string;
}

const ALERT_COLUMNS = `id, kind, coin, dex, severity, started_at AS startedAt, updated_at AS updatedAt, resolved_at AS resolvedAt,
  minutes, title, detail, evidence, published_at AS publishedAt`;

export const toAlert = (row: Record<string, unknown>): AlertRecord => ({ ...(row as unknown as AlertRecord), evidence: JSON.parse(row.evidence as string) });

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
  private readonly lastConfig: StatementSync;
  private readonly insertConfig: StatementSync;
  private readonly insertGap: StatementSync;
  private readonly insertHealth: StatementSync;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    this.migrate();

    this.insertBar = this.db.prepare(`
      INSERT OR REPLACE INTO minute_bars VALUES (
        :coin, :ts, :ctxSource, :ctxUpdates, :oraclePx, :markPx, :midPx, :openInterest, :funding, :premium,
        :dayNtlVlm, :oracleChanges, :oracleMaxGapMs, :bookSource, :bookUpdates, :bestBid, :bestAsk, :spreadBps,
        :bidDepth1, :askDepth1, :bidDepth2, :askDepth2, :bidDepth5, :askDepth5, :minDepth2, :largestLevelUsd,
        :reachPct, :trades, :buyNtl, :sellNtl, :maxTradeNtl
      )`);
    this.lastConfig = this.db.prepare("SELECT hash, body FROM config_snapshots WHERE dex = ? ORDER BY ts DESC LIMIT 1");
    this.insertConfig = this.db.prepare("INSERT OR REPLACE INTO config_snapshots (dex, ts, hash, body) VALUES (?, ?, ?, ?)");
    this.insertGap = this.db.prepare(
      "INSERT INTO ws_gaps (connection, started_at, ended_at, subscriptions, reason) VALUES (?, ?, ?, ?, ?)",
    );
    this.insertHealth = this.db.prepare(`
      INSERT OR REPLACE INTO health VALUES (
        :ts, :wsOpen, :wsConnections, :subscriptions, :wsReceived, :restWeight, :bars, :barsWithCtx, :barsWithBook, :dbBytes
      )`);
  }

  private migrate(): void {
    let { user_version: version } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version > SCHEMA_VERSION) throw new Error(`database schema v${version} is newer than this code (v${SCHEMA_VERSION})`);
    if (version === 0) {
      this.db.exec(SCHEMA_V1);
      version = 1;
    }
    for (; version < SCHEMA_VERSION; version++) {
      this.transaction(() => this.db.exec(MIGRATIONS[version - 1]!));
      this.db.exec(`PRAGMA user_version = ${version + 1}`);
    }
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
  saveUniverse(universe: Universe): ConfigUpdate[] {
    const changed: ConfigUpdate[] = [];
    const at = universe.fetchedAt;
    const upsertDex = this.db.prepare(`
      INSERT INTO dexes (name, full_name, deployer, oracle_updater, fee_recipient, collateral_token, active, updated_at, collateral)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET full_name = excluded.full_name, deployer = excluded.deployer,
        oracle_updater = excluded.oracle_updater, fee_recipient = excluded.fee_recipient,
        collateral_token = excluded.collateral_token, active = excluded.active, updated_at = excluded.updated_at,
        collateral = excluded.collateral`);
    const upsertMarket = this.db.prepare(`
      INSERT INTO markets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (coin) DO UPDATE SET dex = excluded.dex, position = excluded.position, sz_decimals = excluded.sz_decimals,
        max_leverage = excluded.max_leverage, margin_table_id = excluded.margin_table_id, only_isolated = excluded.only_isolated,
        margin_mode = excluded.margin_mode, growth_mode = excluded.growth_mode, is_delisted = excluded.is_delisted,
        oi_cap_usd = excluded.oi_cap_usd, updated_at = excluded.updated_at`);
    this.transaction(() => {
      for (const d of universe.dexes) {
        upsertDex.run(d.name, d.fullName, d.deployer, d.oracleUpdater, d.feeRecipient, d.collateralToken, d.active ? 1 : 0, at, d.collateral);
        const { body, hash } = dexConfig(universe, d.name);
        const last = this.lastConfig.get(d.name) as { hash: string; body: string } | undefined;
        if (last?.hash !== hash) {
          this.insertConfig.run(d.name, at, hash, body);
          changed.push({ dex: d.name, fullName: d.fullName, before: last?.body ?? null, after: body });
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

  /** Upserts daily candles for one market; the latest day is replaced as it fills in. */
  writeCandles(coin: string, candles: readonly Candle[]): void {
    const upsert = this.db.prepare("INSERT OR REPLACE INTO daily_candles VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.transaction(() => {
      for (const c of candles) upsert.run(coin, c.t, Number(c.o), Number(c.h), Number(c.l), Number(c.c), Number(c.v));
    });
  }

  /**
   * Rolls minute bars from before `before` (rounded down to a quarter hour, so no bucket is
   * split) into 15-minute bars, then deletes them, the matching health rows and old book events.
   */
  rollUp(before: number): { minuteBars: number; rolledBars: number } {
    const cutoff = Math.floor(before / ROLLUP_MS) * ROLLUP_MS;
    let result = { minuteBars: 0, rolledBars: 0 };
    this.transaction(() => {
      const rolled = this.db.prepare(ROLLUP_SQL).run({ cutoff });
      const deleted = this.db.prepare("DELETE FROM minute_bars WHERE ts < ?").run(cutoff);
      this.db.prepare("DELETE FROM health WHERE ts < ?").run(cutoff);
      this.db.prepare("DELETE FROM book_events WHERE ts < ?").run(cutoff);
      result = { minuteBars: Number(deleted.changes), rolledBars: Number(rolled.changes) };
    });
    return result;
  }

  /** The newest `minutes` minutes of bars, oldest first, to prime the minute detectors after a restart. */
  recentBars(minutes: number): (BarInput & { coin: string })[] {
    const latest = (this.db.prepare("SELECT max(ts) AS ts FROM minute_bars").get() as { ts: number | null }).ts;
    if (latest === null) return [];
    return this.db
      .prepare(`SELECT coin, ${BAR_COLUMNS} FROM minute_bars WHERE ts > ? ORDER BY ts, coin`)
      .all(latest - minutes * 60_000) as unknown as (BarInput & { coin: string })[];
  }

  insertAlert(alert: Omit<AlertRecord, "id">): number {
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO alerts (kind, coin, dex, severity, started_at, updated_at, resolved_at, minutes, title, detail, evidence, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(alert.kind, alert.coin, alert.dex, alert.severity, alert.startedAt, alert.updatedAt, alert.resolvedAt, alert.minutes, alert.title, alert.detail, JSON.stringify(alert.evidence), alert.publishedAt);
    return Number(lastInsertRowid);
  }

  updateAlert(a: AlertRecord): void {
    this.db
      .prepare("UPDATE alerts SET severity = ?, updated_at = ?, resolved_at = ?, minutes = ?, title = ?, detail = ?, evidence = ?, published_at = ? WHERE id = ?")
      .run(a.severity, a.updatedAt, a.resolvedAt, a.minutes, a.title, a.detail, JSON.stringify(a.evidence), a.publishedAt, a.id);
  }

  loadAlerts(since: number): AlertRecord[] {
    const rows = this.db.prepare(`SELECT ${ALERT_COLUMNS} FROM alerts WHERE resolved_at IS NULL OR started_at >= ? ORDER BY started_at, id`).all(since);
    return rows.map((r) => toAlert(r as Record<string, unknown>));
  }

  writeBookEvents(events: readonly WallEvent[]): void {
    if (events.length === 0) return;
    const insert = this.db.prepare("INSERT INTO book_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    this.transaction(() => {
      for (const e of events) insert.run(e.coin, e.at, e.kind, e.side, e.px, e.peakUsd, e.sideDepthUsd, e.filledUsd, e.firstSeen);
    });
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
