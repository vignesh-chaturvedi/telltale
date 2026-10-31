// Response shapes of the JSON API. Type-only, so the website can import them without pulling in
// any server code.
import type { AlertKind, DexSummary, Grade, MarketGrade, MarketMetrics, MetricKey, Severity } from "@telltale/detectors";

/** One market's row on the board: the grade plus the numbers the table shows. */
export interface BoardMarket {
  coin: string;
  /** "" for core. */
  dex: string;
  grade: Grade | null;
  score: number | null;
  oiUsd: number | null;
  volume24hUsd: number | null;
  depthToOi: number | null;
  liquidationMoveCostUsd: number | null;
  liquidationBandPct: number;
  moveCostIsLowerBound: boolean;
  oracleGapBps: number | null;
  peerGapBps: number | null;
  bigMoveDays30: number | null;
  spreadBps: number | null;
  bands: Partial<Record<MetricKey, Grade>>;
  reasons: { metric: MetricKey; grade: Grade; label: string }[];
  /** Why the market isn't graded, when it isn't. */
  ungradedNote: string | null;
}

export interface BoardDex extends DexSummary {
  /** URL-safe name: "core" for the core DEX. */
  slug: string;
  fullName: string;
  collateral: string | null;
}

export interface Board {
  /** When the API computed this, epoch ms. */
  generatedAt: number;
  /** The version of docs/methodology.md these numbers follow. */
  methodologyVersion: string;
  windowMinutes: number;
  /** First and last minute of the window, epoch ms. */
  from: number;
  to: number;
  /** Seconds between the newest stored minute and `generatedAt`. */
  dataAgeSeconds: number;
  counts: Record<Grade, number>;
  dexes: BoardDex[];
  markets: BoardMarket[];
}

/** Five-minute buckets over the last 24 hours. */
export interface HistoryPoint {
  t: number;
  markPx: number | null;
  oraclePx: number | null;
  /** Largest |mid − oracle| in the bucket, bps. */
  oracleGapBps: number | null;
  depth2Usd: number | null;
  oiUsd: number | null;
}

/** The ranges `/api/markets/{coin}/history` serves. */
export type HistoryRange = "24h" | "7d" | "30d";

/**
 * One step of a market's history. Each check is measured the way the grade measures it, over the
 * step instead of the last 60 minutes: medians of depth, the 95th percentile of gaps, and the
 * last minute's prices, open interest and funding.
 */
export interface MetricPoint {
  t: number;
  markPx: number | null;
  oraclePx: number | null;
  oiUsd: number | null;
  /** USD resting within ±2% of mid, both sides. */
  depth2Usd: number | null;
  depthToOi: number | null;
  /** USD on the thinner side within the liquidation band: what it takes to push the price that far. */
  moveCostUsd: number | null;
  /** Experimental: the same with wall depth counted at (1 − the market's current pull rate); null without wall data or a pull rate. */
  adjustedMoveCostUsd: number | null;
  /** |mid − oracle| / oracle, bps. */
  oracleGapBps: number | null;
  /** |oracle − peers' median oracle|, bps; null without peers. */
  peerGapBps: number | null;
  spreadBps: number | null;
  /** Hourly funding rate, as a fraction. */
  funding: number | null;
}

export type SummarizedMetric = Exclude<keyof MetricPoint, "t" | "markPx" | "oraclePx">;

/** A metric's spread over the range's steps, and the latest step. */
export interface MetricSummary {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  latest: number | null;
}

/** A finished day's largest move from its open, what the big-moves check counts. */
export interface DayMove {
  day: number;
  /** max(high / open − 1, 1 − low / open), %. */
  movePct: number;
}

export interface MarketHistory {
  generatedAt: number;
  /** The version of docs/methodology.md these numbers follow. */
  methodologyVersion: string;
  coin: string;
  range: HistoryRange;
  stepMinutes: number;
  /** First and last step, epoch ms. */
  from: number;
  to: number;
  /** The depth band cost to liquidation is measured in (1, 2 or 5%), the same as the grade's. */
  liquidationBandPct: number;
  peers: string[];
  /** Steps before this are built from 15-minute bars, whose depth and spread are averages; null when the whole range has minute bars. */
  minuteBarsFrom: number | null;
  /** One per step from `from` to `to`; steps without data hold nulls. */
  points: MetricPoint[];
  summary: Record<SummarizedMetric, MetricSummary>;
  /** The last 30 finished days, whatever the range. */
  dailyMoves: DayMove[];
}

export interface MarketDetail {
  generatedAt: number;
  /** The version of docs/methodology.md these numbers follow. */
  methodologyVersion: string;
  windowMinutes: number;
  from: number;
  to: number;
  dataAgeSeconds: number;
  coin: string;
  dex: string;
  dexSlug: string;
  dexName: string;
  maxLeverage: number;
  metrics: MarketMetrics;
  grade: MarketGrade;
  history: HistoryPoint[];
  /** This market's latest alerts, newest first; empty until alerts are public. */
  alerts: AlertView[];
}

export interface DexDetail {
  generatedAt: number;
  /** The version of docs/methodology.md these numbers follow. */
  methodologyVersion: string;
  windowMinutes: number;
  dex: BoardDex;
  markets: BoardMarket[];
}

export interface Health {
  ok: boolean;
  now: number;
  latestMinute: number | null;
  dataAgeSeconds: number | null;
  markets: number;
  /** Whether the site shows alerts yet (they're recorded privately during the shadow run). */
  alerts: boolean;
}

export interface AlertView {
  id: number;
  kind: AlertKind;
  /** `null` for alerts about a whole DEX. */
  coin: string | null;
  dex: string;
  severity: Severity;
  startedAt: number;
  updatedAt: number;
  /** `null` while the condition still holds. */
  resolvedAt: number | null;
  minutes: number;
  title: string;
  detail: string;
  evidence: Record<string, number | string | null>;
  /** When it was sent to the alert channels, if it was. */
  publishedAt: number | null;
}

export interface AlertList {
  public: boolean;
  alerts: AlertView[];
}

/** Track-record counts for one kind of alert, or for all of them. */
export interface TrackKind {
  kind: AlertKind;
  /** Warnings and critical alerts about one market since alerts went public. */
  alerts: number;
  /** Those whose next hour could be measured. */
  measured: number;
  /** Measured alerts whose next hour was one of the market's most volatile tenth. */
  followed: number;
  /** The same hour on the 3 days before each measured alert, ranked the same way. */
  controlHours: number;
  controlFollowed: number;
}

/** A measured alert: how far the price moved in the hour after it. */
export interface TrackAlert {
  id: number;
  kind: AlertKind;
  coin: string;
  severity: Severity;
  startedAt: number;
  title: string;
  /** Largest move from the alert's price within the hour, in percent. */
  movePct: number;
  /** The market's median hour over the 7 days before, measured the same way, in percent. */
  usualPct: number;
  /** Share of those hours that moved less, 0 to 1. */
  rank: number;
}

export interface TrackRecord {
  public: true;
  generatedAt: number;
  /** When the collector first saw a market, epoch ms. */
  liveSince: number | null;
  /** Alerts are counted from here, when they went public. */
  alertsSince: number;
  /** An hour at or above this rank counts as one of the market's most volatile tenth. */
  topRank: number;
  /** `pending` alerts are waiting for their hour to end. */
  totals: Omit<TrackKind, "kind"> & { pending: number };
  kinds: TrackKind[];
  /** The latest measured alerts, newest first, hits and misses alike. */
  recent: TrackAlert[];
}

/** Until alerts are public, the track record is `{ public: false }`. */
export type TrackRecordResponse = TrackRecord | { public: false };
