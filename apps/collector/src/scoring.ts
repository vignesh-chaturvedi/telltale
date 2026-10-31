import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_GRADE_OPTIONS,
  gradeDex,
  gradeMarket,
  marketMetrics,
  type BarInput,
  type DailyCandleInput,
  type DexSummary,
  type GradeOptions,
  type MarketGrade,
  type MarketMetrics,
  type PullRate,
} from "@telltale/detectors";
import { MINUTE } from "./bars.ts";

export interface ScoreOptions extends GradeOptions {
  windowMinutes: number;
  /** Grade the window ending at this minute; defaults to the latest minute stored. */
  to?: number;
  /** Each market's pull rate (see loadPullRates), for the cancel-adjusted cost. */
  pullRates?: ReadonlyMap<string, PullRate>;
}

export interface ScoredMarket {
  coin: string;
  dex: string;
  maxLeverage: number;
  metrics: MarketMetrics;
  grade: MarketGrade;
}

export interface ScoredDex extends DexSummary {
  fullName: string;
  collateral: string | null;
}

export interface Scorecard {
  windowMinutes: number;
  /** First and last minute of the window, epoch ms. */
  from: number;
  to: number;
  dexes: ScoredDex[];
  markets: ScoredMarket[];
}

/** Minute-bar columns under the names the detectors use. */
export const BAR_COLUMNS = `ts, oracle_px AS oraclePx, mark_px AS markPx, mid_px AS midPx, open_interest AS openInterest,
  day_ntl_vlm AS dayNtlVlm, spread_bps AS spreadBps, oracle_changes AS oracleChanges, oracle_max_gap_ms AS oracleMaxGapMs,
  bid_depth_1 AS bidDepth1, ask_depth_1 AS askDepth1, bid_depth_2 AS bidDepth2, ask_depth_2 AS askDepth2,
  bid_depth_5 AS bidDepth5, ask_depth_5 AS askDepth5, min_depth_2 AS minDepth2, reach_pct AS reachPct,
  bid_wall_1 AS bidWall1, ask_wall_1 AS askWall1, bid_wall_2 AS bidWall2, ask_wall_2 AS askWall2, bid_wall_5 AS bidWall5, ask_wall_5 AS askWall5`;

/** A market needs this many ended walls before its pull rate is used. */
export const MIN_PULL_SAMPLE = 20;
/** Pull rates look back as far as book_events are kept. */
export const PULL_WINDOW_MS = 14 * 86_400_000;

/**
 * Each market's pull rate over the last 14 days of book_events: the share of its large walls' USD
 * that was pulled before the price reached them, out of all its walls that ended (filled, moved,
 * expired or pulled). Markets with fewer than MIN_PULL_SAMPLE walls are left out.
 */
export function loadPullRates(db: DatabaseSync, to: number): Map<string, PullRate> {
  try {
    // NOT INDEXED: the table holds only 14 days anyway, and reading it straight through is about 3×
    // faster than the planner's walk of the (coin, ts) index with a row lookup per wall.
    const rows = db
      .prepare(
        `SELECT coin, count(*) AS walls, sum(peak_usd) AS usd, sum(CASE WHEN kind = 'pulled' THEN peak_usd ELSE 0 END) AS pulled
         FROM book_events NOT INDEXED WHERE ts > ? GROUP BY coin HAVING count(*) >= ?`,
      )
      .all(to - PULL_WINDOW_MS, MIN_PULL_SAMPLE) as { coin: string; walls: number; usd: number; pulled: number }[];
    return new Map(rows.filter((r) => r.usd > 0).map((r) => [r.coin, { rate: r.pulled / r.usd, walls: r.walls }]));
  } catch {
    // The collector creates book_events; until it has, there are no rates.
    return new Map();
  }
}

/** The ticker without its DEX prefix. HIP-3 markets with the same ticker are checked against each other. */
export const tickerOf = (coin: string): string => coin.slice(coin.indexOf(":") + 1);

const groupBy = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
};

/** Grades every live market and DEX from what the collector has stored. */
export function scoreDatabase(db: DatabaseSync, options: ScoreOptions): Scorecard {
  const grading = { ...DEFAULT_GRADE_OPTIONS, ...options };
  const latest = (db.prepare("SELECT max(ts) AS ts FROM minute_bars").get() as { ts: number | null }).ts;
  const to = options.to ?? latest ?? 0;
  const from = to - (options.windowMinutes - 1) * MINUTE;

  const markets = db
    .prepare("SELECT coin, dex, max_leverage AS maxLeverage, oi_cap_usd AS oiCapUsd FROM markets WHERE is_delisted = 0 ORDER BY coin")
    .all() as unknown as { coin: string; dex: string; maxLeverage: number; oiCapUsd: number | null }[];
  const dexes = db.prepare("SELECT name, full_name AS fullName, collateral FROM dexes ORDER BY name").all() as unknown as {
    name: string;
    fullName: string;
    collateral: string | null;
  }[];
  const bars = groupBy(
    db.prepare(`SELECT coin, ${BAR_COLUMNS} FROM minute_bars WHERE ts BETWEEN ? AND ? ORDER BY coin, ts`).all(from, to) as unknown as (BarInput & {
      coin: string;
    })[],
    (b) => b.coin,
  );
  // Only finished days: the current day's candle is still moving.
  const today = to - (to % 86_400_000);
  const candles = groupBy(
    db
      .prepare("SELECT coin, day, open, high, low, close FROM daily_candles WHERE day >= ? AND day < ? ORDER BY coin, day")
      .all(today - 30 * 86_400_000, today) as unknown as (DailyCandleInput & { coin: string })[],
    (c) => c.coin,
  );
  const hip3ByTicker = groupBy(
    markets.filter((m) => m.dex !== ""),
    (m) => tickerOf(m.coin),
  );

  const scored: ScoredMarket[] = markets.map((m) => {
    const peers =
      m.dex === ""
        ? []
        : (hip3ByTicker.get(tickerOf(m.coin)) ?? [])
            .filter((p) => p.coin !== m.coin)
            .map((p) => ({ coin: p.coin, bars: bars.get(p.coin) ?? [] }));
    const metrics = marketMetrics({
      coin: m.coin,
      maxLeverage: m.maxLeverage,
      oiCapUsd: m.oiCapUsd,
      bars: bars.get(m.coin) ?? [],
      candles: candles.get(m.coin) ?? [],
      peers,
      pullRate: options.pullRates?.get(m.coin) ?? null,
    });
    return { coin: m.coin, dex: m.dex, maxLeverage: m.maxLeverage, metrics, grade: gradeMarket(metrics, grading) };
  });

  const byDex = groupBy(scored, (m) => m.dex);
  const scoredDexes = dexes.map((d) => ({
    ...gradeDex({ dex: d.name, collateral: d.collateral, markets: byDex.get(d.name) ?? [] }),
    fullName: d.fullName,
    collateral: d.collateral,
  }));
  return { windowMinutes: options.windowMinutes, from, to, dexes: scoredDexes, markets: scored };
}
