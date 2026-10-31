import type { DatabaseSync } from "node:sqlite";
import { last, liquidationBand, median, p95, quantile } from "@telltale/detectors";
import type { DayMove, HistoryRange, MarketHistory, MetricPoint, MetricSummary, SummarizedMetric } from "./api-types.ts";
import { MINUTE } from "./bars.ts";
import { METHODOLOGY_VERSION } from "./methodology.ts";

const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How far back each range reaches, and how long each step is. */
export const HISTORY_RANGES: Record<HistoryRange, { spanMs: number; stepMs: number }> = {
  "24h": { spanMs: DAY, stepMs: 5 * MINUTE },
  "7d": { spanMs: 7 * DAY, stepMs: HOUR },
  "30d": { spanMs: 30 * DAY, stepMs: 4 * HOUR },
};

export const isHistoryRange = (x: string): x is HistoryRange => Object.hasOwn(HISTORY_RANGES, x);

const SUMMARIZED: readonly SummarizedMetric[] = ["oiUsd", "depth2Usd", "depthToOi", "moveCostUsd", "adjustedMoveCostUsd", "oracleGapBps", "peerGapBps", "spreadBps", "funding"];

export interface HistoryOptions {
  coin: string;
  maxLeverage: number;
  /** Markets whose oracle the peer gap is measured against: the grade's usable peers. */
  peers: readonly string[];
  /** The market's pull rate now, applied to every step's wall depth; `null` leaves the adjusted cost out. */
  pullRate: number | null;
  range: HistoryRange;
  /** The last minute to include, epoch ms. */
  to: number;
  generatedAt: number;
}

/** One stored bar, from minute_bars or bars_15m, reduced to what the history reads. */
interface Sample {
  ts: number;
  markPx: number | null;
  oraclePx: number | null;
  openInterest: number | null;
  funding: number | null;
  spreadBps: number | null;
  depth2: number | null;
  moveCost: number | null;
  moveCostAdjusted: number | null;
  oracleGapBps: number | null;
  peerGapBps?: number | null;
}

/**
 * A market's checks step by step over `range`, read from minute bars and, before the oldest
 * minute bar, from 15-minute bars. A step with both keeps only its minute bars.
 */
export function marketHistory(db: DatabaseSync, options: HistoryOptions): MarketHistory {
  const { coin, range } = options;
  const { spanMs, stepMs } = HISTORY_RANGES[range];
  const to = options.to - (options.to % stepMs);
  const from = to - spanMs + stepMs;
  const { bandPct } = liquidationBand(options.maxLeverage);
  const oldestMinute = (db.prepare("SELECT min(ts) AS ts FROM minute_bars").get() as { ts: number | null }).ts;
  const minuteFrom = oldestMinute ?? options.to + 1;

  // bandPct is 1, 2 or 5, so the column names are fixed. A 15-minute bar keeps its last minute's
  // prices, so its oracle gap is a one-minute snapshot like the minute bars', not the quarter's largest.
  const columns = `ts, mark_px AS markPx, oracle_px AS oraclePx, open_interest AS openInterest, funding, spread_bps AS spreadBps,
    bid_depth_2 + ask_depth_2 AS depth2, min(bid_depth_${bandPct}, ask_depth_${bandPct}) AS moveCost,
    CASE WHEN oracle_px > 0 AND mid_px IS NOT NULL THEN abs(mid_px - oracle_px) / oracle_px * 10000 END AS oracleGapBps`;
  // Walls are only recorded per minute, and only since schema v6; earlier minutes read NULL.
  const minutes = db
    .prepare(
      `SELECT ${columns}, min(bid_depth_${bandPct} - ? * bid_wall_${bandPct}, ask_depth_${bandPct} - ? * ask_wall_${bandPct}) AS moveCostAdjusted
       FROM minute_bars WHERE coin = ? AND ts BETWEEN ? AND ? ORDER BY ts`,
    )
    .all(options.pullRate, options.pullRate, coin, from, options.to) as unknown as Sample[];
  const rolled =
    from < minuteFrom
      ? (db
          .prepare(`SELECT ${columns}, NULL AS moveCostAdjusted FROM bars_15m WHERE coin = ? AND ts >= ? AND ts < ? ORDER BY ts`)
          .all(coin, from, minuteFrom) as unknown as Sample[])
      : [];
  if (options.peers.length) measurePeerGap(db, [...rolled, ...minutes], options.peers, from, options.to, minuteFrom);

  const steps = new Map<number, { minutes: Sample[]; rolled: Sample[] }>();
  const add = (s: Sample, kind: "minutes" | "rolled") => {
    const t = s.ts - (s.ts % stepMs);
    let step = steps.get(t);
    if (!step) steps.set(t, (step = { minutes: [], rolled: [] }));
    step[kind].push(s);
  };
  for (const s of rolled) add(s, "rolled");
  for (const s of minutes) add(s, "minutes");

  const points: MetricPoint[] = [];
  for (let t = from; t <= to; t += stepMs) {
    const step = steps.get(t);
    points.push(measureStep(t, step ? (step.minutes.length ? step.minutes : step.rolled) : []));
  }
  const summary = Object.fromEntries(SUMMARIZED.map((k) => [k, summarize(points.map((p) => p[k]))])) as Record<SummarizedMetric, MetricSummary>;

  return {
    generatedAt: options.generatedAt,
    methodologyVersion: METHODOLOGY_VERSION,
    coin,
    range,
    stepMinutes: stepMs / MINUTE,
    from,
    to,
    liquidationBandPct: bandPct,
    peers: [...options.peers],
    minuteBarsFrom: oldestMinute !== null && rolled.length ? oldestMinute : null,
    points,
    summary,
    dailyMoves: dailyMoves(db, coin, options.to),
  };
}

/** Each sample's gap to the median of its peers' oracles at the same minute (or quarter hour). */
function measurePeerGap(db: DatabaseSync, samples: Sample[], peers: readonly string[], from: number, to: number, minuteFrom: number): void {
  const minuteQuery = db.prepare("SELECT ts, oracle_px AS px FROM minute_bars WHERE coin = ? AND ts BETWEEN ? AND ?");
  const rolledQuery = db.prepare("SELECT ts, oracle_px AS px FROM bars_15m WHERE coin = ? AND ts >= ? AND ts < ?");
  const byPeer = peers.map((peer) => {
    const rows = [...rolledQuery.all(peer, from, minuteFrom), ...minuteQuery.all(peer, from, to)] as { ts: number; px: number | null }[];
    return new Map(rows.map((r) => [r.ts, r.px]));
  });
  for (const s of samples) {
    const ref = median(byPeer.map((m) => m.get(s.ts)).filter((x): x is number => typeof x === "number" && x > 0));
    s.peerGapBps = s.oraclePx && ref ? (Math.abs(s.oraclePx - ref) / ref) * 10_000 : null;
  }
}

/** The grade's measurements (see marketMetrics), over one step's samples. */
function measureStep(t: number, samples: readonly Sample[]): MetricPoint {
  const priced = last(samples.map((s) => (s.oraclePx !== null && s.markPx !== null ? s : null)));
  const oiUsd = priced && priced.openInterest !== null ? priced.openInterest * priced.markPx! : null;
  const depth2Usd = median(samples.map((s) => s.depth2));
  return {
    t,
    markPx: last(samples.map((s) => s.markPx)),
    oraclePx: last(samples.map((s) => s.oraclePx)),
    oiUsd: round(oiUsd, 0),
    depth2Usd: round(depth2Usd, 0),
    depthToOi: depth2Usd !== null && oiUsd ? round(depth2Usd / oiUsd, 6) : null,
    moveCostUsd: round(median(samples.map((s) => s.moveCost)), 0),
    adjustedMoveCostUsd: round(median(samples.map((s) => s.moveCostAdjusted)), 0),
    oracleGapBps: round(p95(samples.map((s) => s.oracleGapBps)), 2),
    peerGapBps: round(p95(samples.map((s) => s.peerGapBps)), 2),
    spreadBps: round(median(samples.map((s) => s.spreadBps)), 2),
    funding: last(samples.map((s) => s.funding)),
  };
}

function summarize(values: readonly (number | null)[]): MetricSummary {
  return { p10: quantile(values, 0.1), p50: median(values), p90: quantile(values, 0.9), latest: last(values) };
}

/** The last 30 finished days' largest move from the open, as the big-moves check reads them. */
function dailyMoves(db: DatabaseSync, coin: string, to: number): DayMove[] {
  const today = to - (to % DAY);
  const candles = db
    .prepare("SELECT day, open, high, low FROM daily_candles WHERE coin = ? AND day >= ? AND day < ? ORDER BY day")
    .all(coin, today - 30 * DAY, today) as { day: number; open: number; high: number; low: number }[];
  return candles.filter((c) => c.open > 0).map((c) => ({ day: c.day, movePct: round(Math.max(c.high / c.open - 1, 1 - c.low / c.open) * 100, 2)! }));
}

const round = (x: number | null, digits: number): number | null => (x === null ? null : Math.round(x * 10 ** digits) / 10 ** digits);
