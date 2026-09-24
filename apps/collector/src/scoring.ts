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
} from "@telltale/detectors";
import { MINUTE } from "./bars.ts";

export interface ScoreOptions extends GradeOptions {
  windowMinutes: number;
  /** Grade the window ending at this minute; defaults to the latest minute stored. */
  to?: number;
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

const BAR_COLUMNS = `ts, oracle_px AS oraclePx, mark_px AS markPx, mid_px AS midPx, open_interest AS openInterest,
  day_ntl_vlm AS dayNtlVlm, spread_bps AS spreadBps, oracle_changes AS oracleChanges, oracle_max_gap_ms AS oracleMaxGapMs,
  bid_depth_1 AS bidDepth1, ask_depth_1 AS askDepth1, bid_depth_2 AS bidDepth2, ask_depth_2 AS askDepth2,
  bid_depth_5 AS bidDepth5, ask_depth_5 AS askDepth5, min_depth_2 AS minDepth2, reach_pct AS reachPct`;

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
