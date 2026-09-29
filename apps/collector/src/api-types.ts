// Response shapes of the JSON API. Type-only, so the website can import them without pulling in
// any server code.
import type { DexSummary, Grade, MarketGrade, MarketMetrics, MetricKey } from "@telltale/detectors";

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

export interface MarketDetail {
  generatedAt: number;
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
}

export interface DexDetail {
  generatedAt: number;
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
}
