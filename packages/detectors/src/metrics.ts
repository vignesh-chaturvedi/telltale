import { DEPTH_BANDS, type DepthBand } from "./book.ts";
import { last, median, min, p95, stdev } from "./stats.ts";

/** The per-minute fields the metrics read. The collector's minute bars have all of them. */
export interface BarInput {
  ts: number;
  oraclePx: number | null;
  markPx: number | null;
  midPx: number | null;
  openInterest: number | null;
  dayNtlVlm: number | null;
  spreadBps: number | null;
  oracleChanges: number | null;
  oracleMaxGapMs: number | null;
  bidDepth1: number | null;
  askDepth1: number | null;
  bidDepth2: number | null;
  askDepth2: number | null;
  bidDepth5: number | null;
  askDepth5: number | null;
  minDepth2: number | null;
  reachPct: number | null;
  /** USD in walls within each band (see wallDepth); absent where walls weren't measured, such as replays. */
  bidWall1?: number | null;
  askWall1?: number | null;
  bidWall2?: number | null;
  askWall2?: number | null;
  bidWall5?: number | null;
  askWall5?: number | null;
}

/** How often a market's large walls were pulled before the price reached them. */
export interface PullRate {
  /** Share of the walls' USD that was pulled. */
  rate: number;
  /** Walls in the sample. */
  walls: number;
}

export interface DailyCandleInput {
  /** Day start, epoch ms. */
  day: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Another DEX's market for the same underlying, used to cross-check the oracle. */
export interface PeerInput {
  coin: string;
  bars: readonly Pick<BarInput, "ts" | "oraclePx">[];
}

export interface MarketInput {
  coin: string;
  maxLeverage: number;
  oiCapUsd: number | null;
  /** Minute bars in the scoring window, oldest first. */
  bars: readonly BarInput[];
  /** Up to 30 finished days, oldest first. */
  candles: readonly DailyCandleInput[];
  peers: readonly PeerInput[];
  /** The market's pull rate, or `null` when too few of its walls have ended to measure one. */
  pullRate?: PullRate | null;
}

export interface MarketMetrics {
  coin: string;
  /** Minutes in the window with both a context and a book. */
  coverageMinutes: number;
  /** The last mark price in the window. */
  markPx: number | null;
  oiUsd: number | null;
  volume24hUsd: number | null;
  /** Median impact spread, bps. */
  spreadBps: number | null;
  /** Median USD resting within ±2% of mid, both sides. */
  depth2Usd: number | null;
  /** Thinnest ±2% depth seen in any snapshot. */
  thinnestDepth2Usd: number | null;
  /** Median USD resting on each side within each band: what it costs to push the price that far. */
  sideDepthUsd: Record<"bid" | "ask", Record<DepthBand, number | null>>;
  /** `depth2Usd` as a share of open interest. */
  depthToOi: number | null;
  /** Price move, in %, that wipes out a position opened at maximum leverage: 50 / maxLeverage. */
  liquidationDistancePct: number;
  /** The depth band used to price that move: the widest band not beyond the distance, at least 1%. */
  liquidationBandPct: DepthBand;
  /** Median USD needed to push price through that band on the thinner side. */
  liquidationMoveCostUsd: number | null;
  /** True when the visible book usually doesn't reach the band, so the cost is a lower bound. */
  moveCostIsLowerBound: boolean;
  /**
   * Experimental, not graded: the same cost with wall depth counted at (1 − pull rate). Equal to the
   * raw cost when no walls stood in the band; `null` without wall data, or with walls but no pull rate.
   */
  adjustedMoveCostUsd: number | null;
  pullRate: PullRate | null;
  /** 95th percentile of |mid − oracle| / oracle, bps. */
  oracleGapBps: number | null;
  /** 95th percentile of the longest unchanged-oracle stretch per minute, seconds. HIP-3 streams only. */
  oracleUnchangedP95Sec: number | null;
  /** Share of minutes with an unchanged-oracle stretch over 10 s. HIP-3 streams only. */
  oracleUnchangedOver10sShare: number | null;
  /** 95th percentile of |oracle − peer oracle| / peer oracle, bps. */
  peerGapBps: number | null;
  peers: string[];
  /** Days in the last 30 whose high or low was more than 50% from the open. */
  bigMoveDays30: number | null;
  /** Standard deviation of daily close-to-close returns, %. */
  dailyVolPct: number | null;
  /** Open interest as a share of the market's OI cap. */
  oiCapUse: number | null;
}

/** HIP-3's cross-margin rule: a >50% move from the start of day triggers a validator review. */
export const BIG_MOVE = 0.5;
/** A Hyperliquid mark falls back to its own value after 10 s without a fresh oracle. */
export const ORACLE_FALLBACK_MS = 10_000;
/** Peers whose prices differ by more than this are quoting a different unit, not disagreeing. */
const PEER_SCALE_TOLERANCE = 0.2;

export function liquidationBand(maxLeverage: number): { distancePct: number; bandPct: DepthBand } {
  const distancePct = 50 / Math.max(1, maxLeverage);
  const fitting = DEPTH_BANDS.filter((b) => b <= distancePct);
  return { distancePct, bandPct: fitting.at(-1) ?? DEPTH_BANDS[0] };
}

const depth = (b: BarInput, band: DepthBand, side: "bid" | "ask"): number | null =>
  b[`${side}Depth${band}` as keyof BarInput] as number | null;
const wall = (b: BarInput, band: DepthBand, side: "bid" | "ask"): number | null =>
  (b[`${side}Wall${band}` as keyof BarInput] as number | null | undefined) ?? null;

export function marketMetrics(input: MarketInput): MarketMetrics {
  const { bars } = input;
  const booked = bars.filter((b) => b.bidDepth2 !== null && b.askDepth2 !== null);
  const priced = bars.filter((b) => b.oraclePx !== null && b.markPx !== null);

  const lastPriced = last(priced.map((b) => b));
  const oiUsd = lastPriced && lastPriced.openInterest !== null ? lastPriced.openInterest * lastPriced.markPx! : null;
  const depth2Usd = median(booked.map((b) => b.bidDepth2! + b.askDepth2!));
  const { distancePct, bandPct } = liquidationBand(input.maxLeverage);
  const moveCosts = booked.map((b) => {
    const bid = depth(b, bandPct, "bid");
    const ask = depth(b, bandPct, "ask");
    return bid === null || ask === null ? null : Math.min(bid, ask);
  });
  const shortReach = booked.filter((b) => b.reachPct !== null && b.reachPct < bandPct).length;
  const walled = booked.filter((b) => [depth(b, bandPct, "bid"), depth(b, bandPct, "ask"), wall(b, bandPct, "bid"), wall(b, bandPct, "ask")].every((x) => x !== null));
  // Without a pull rate, the cost can still be adjusted when there were no walls to discount.
  const rate = input.pullRate?.rate ?? (walled.every((b) => wall(b, bandPct, "bid") === 0 && wall(b, bandPct, "ask") === 0) ? 0 : null);
  const adjustedCosts =
    rate === null
      ? []
      : walled.map((b) => Math.min(depth(b, bandPct, "bid")! - rate * wall(b, bandPct, "bid")!, depth(b, bandPct, "ask")! - rate * wall(b, bandPct, "ask")!));

  const sideDepth = (side: "bid" | "ask") =>
    Object.fromEntries(DEPTH_BANDS.map((band) => [band, median(booked.map((b) => depth(b, band, side)))])) as Record<DepthBand, number | null>;

  const streamed = bars.filter((b) => b.oracleChanges !== null);
  const gaps = streamed.map((b) => b.oracleMaxGapMs);
  const measuredGaps = gaps.filter((g): g is number => g !== null);

  return {
    coin: input.coin,
    coverageMinutes: bars.filter((b) => b.oraclePx !== null && b.bidDepth2 !== null).length,
    markPx: lastPriced?.markPx ?? null,
    oiUsd,
    volume24hUsd: last(bars.map((b) => b.dayNtlVlm)),
    spreadBps: median(bars.map((b) => b.spreadBps)),
    depth2Usd,
    thinnestDepth2Usd: min(bars.map((b) => b.minDepth2)),
    sideDepthUsd: { bid: sideDepth("bid"), ask: sideDepth("ask") },
    depthToOi: depth2Usd !== null && oiUsd ? depth2Usd / oiUsd : null,
    liquidationDistancePct: distancePct,
    liquidationBandPct: bandPct,
    liquidationMoveCostUsd: median(moveCosts),
    moveCostIsLowerBound: booked.length > 0 && shortReach > booked.length / 2,
    adjustedMoveCostUsd: median(adjustedCosts),
    pullRate: input.pullRate ?? null,
    oracleGapBps: p95(priced.map((b) => (b.midPx === null ? null : (Math.abs(b.midPx - b.oraclePx!) / b.oraclePx!) * 10_000))),
    oracleUnchangedP95Sec: measuredGaps.length ? p95(measuredGaps)! / 1000 : null,
    oracleUnchangedOver10sShare: measuredGaps.length ? measuredGaps.filter((g) => g > ORACLE_FALLBACK_MS).length / measuredGaps.length : null,
    ...peerGap(input),
    ...dailyMetrics(input.candles),
    oiCapUse: oiUsd !== null && input.oiCapUsd ? oiUsd / input.oiCapUsd : null,
  };
}

function peerGap(input: MarketInput): { peerGapBps: number | null; peers: string[] } {
  const usable = input.peers.filter((peer) => {
    const theirs = new Map(peer.bars.map((b) => [b.ts, b.oraclePx]));
    const ratios = input.bars.map((b) => {
      const other = theirs.get(b.ts);
      return b.oraclePx && other ? b.oraclePx / other : null;
    });
    const typical = median(ratios);
    return typical !== null && Math.abs(typical - 1) <= PEER_SCALE_TOLERANCE;
  });
  if (usable.length === 0) return { peerGapBps: null, peers: [] };
  const byTs = usable.map((p) => new Map(p.bars.map((b) => [b.ts, b.oraclePx])));
  const gaps = input.bars.map((b) => {
    const others = byTs.map((m) => m.get(b.ts)).filter((x): x is number => typeof x === "number" && x > 0);
    const ref = median(others);
    return b.oraclePx && ref ? (Math.abs(b.oraclePx - ref) / ref) * 10_000 : null;
  });
  return { peerGapBps: p95(gaps), peers: usable.map((p) => p.coin) };
}

function dailyMetrics(candles: readonly DailyCandleInput[]): { bigMoveDays30: number | null; dailyVolPct: number | null } {
  if (candles.length === 0) return { bigMoveDays30: null, dailyVolPct: null };
  const recent = candles.slice(-30);
  const bigMoveDays30 = recent.filter((c) => c.open > 0 && Math.max(c.high / c.open - 1, 1 - c.low / c.open) > BIG_MOVE).length;
  const returns = recent.slice(1).map((c, i) => (recent[i]!.close > 0 ? (c.close / recent[i]!.close - 1) * 100 : null));
  return { bigMoveDays30, dailyVolPct: stdev(returns) };
}
