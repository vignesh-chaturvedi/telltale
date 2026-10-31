import type { DepthBand } from "./book.ts";

/** One account's open position in a market, as read from Hyperliquid. */
export interface PositionInput {
  address: string;
  /** Contracts; negative is short. */
  size: number;
  /** Size at the mark price when read, USD. */
  positionUsd: number;
  /** `null` when the account's margin covers any price. */
  liquidationPx: number | null;
  leverage: number;
  polledAt: number;
}

export interface PositionContext {
  markPx: number;
  /** Open interest in USD: one side's total, so longs and shorts each add up to it. */
  oiUsd: number | null;
  /** Median USD resting on each side within each band (see `MarketMetrics.sideDepthUsd`). */
  sideDepthUsd: Record<"bid" | "ask", Record<DepthBand, number | null>>;
}

export type PositionSide = "long" | "short";

/** The ladder runs in 1% steps out to 20% from the mark. */
export const LADDER_STEP_PCT = 1;
export const LADDER_MAX_PCT = 20;
/** The smallest liquidation cluster worth naming. */
export const CLUSTER_USD = 1e6;
export const TOP_ACCOUNTS = 10;
/** Book depth is measured out to 5% from mid, so pushes are priced only that far. */
export const PRICED_PUSH_PCT = 5;

export interface LadderRung {
  /** Distance from the mark, %: longs liquidate this far below it, shorts this far above. */
  fromPct: number;
  toPct: number;
  longUsd: number;
  shortUsd: number;
  longAccounts: number;
  shortAccounts: number;
}

export interface LargePosition {
  address: string;
  side: PositionSide;
  positionUsd: number;
  liquidationPx: number | null;
  /** How far the mark must move to liquidate it, %; `null` without a liquidation price. */
  distancePct: number | null;
  leverage: number;
}

/** What pushing the price a given distance costs, against the positions it would liquidate. */
export interface Push {
  side: PositionSide;
  pct: number;
  /** Book depth in the way: bids for a push down (longs), asks for a push up (shorts). */
  costUsd: number;
  liquidatedUsd: number;
  /** `liquidatedUsd / costUsd`: above 1, a push liquidates more than it costs. */
  ratio: number;
}

export interface Cluster {
  side: PositionSide;
  fromPct: number;
  toPct: number;
  usd: number;
  accounts: number;
  /** Book depth in the way of reaching its far edge; `null` beyond the 5% the book is measured to. */
  costUsd: number | null;
}

export interface PositionMetrics {
  accounts: number;
  longAccounts: number;
  shortAccounts: number;
  longUsd: number;
  shortUsd: number;
  /** Tracked longs plus shorts against all of them (twice the open interest), at most 1. */
  coverage: number | null;
  /** The largest accounts' share of all open positions; a lower bound when coverage is partial. */
  topShare: number | null;
  largest: LargePosition[];
  ladder: LadderRung[];
  /** Liquidating further than the ladder reaches. */
  beyondUsd: Record<PositionSide, number>;
  /** Positions with no liquidation price. */
  unliquidatableUsd: Record<PositionSide, number>;
  /** For each side, the push with the most liquidated per dollar of depth, within 5%. */
  worstPush: Record<PositionSide, Push | null>;
  /** For each side, the nearest 1% rung with $1M+ of liquidations. */
  nearestCluster: Record<PositionSide, Cluster | null>;
  oldestPolledAt: number | null;
  newestPolledAt: number | null;
}

/** How far the mark must move to liquidate a position, %. A stale read already past its price counts as 0. */
export function liquidationDistancePct(size: number, liquidationPx: number | null, markPx: number): number | null {
  if (liquidationPx === null || !(markPx > 0)) return null;
  const pct = ((size > 0 ? markPx - liquidationPx : liquidationPx - markPx) / markPx) * 100;
  return Math.max(0, pct);
}

/**
 * Book depth between mid and `pct` on one side, interpolated linearly between the measured bands
 * (nothing at 0, then 1%, 2% and 5%); `null` past 5% or without depth.
 */
export function pushCostUsd(depth: Record<DepthBand, number | null>, pct: number): number | null {
  const points: [number, number | null][] = [[0, 0], [1, depth[1]], [2, depth[2]], [5, depth[5]]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    if (pct > x1) continue;
    if (y0 === null || y1 === null) return null;
    return y0 + ((y1 - y0) * (pct - x0)) / (x1 - x0);
  }
  return null;
}

/** Concentration and liquidation map for one market, from the positions read so far. */
export function positionMetrics(positions: readonly PositionInput[], ctx: PositionContext): PositionMetrics {
  const open = positions.filter((p) => p.size !== 0);
  const sideOf = (p: PositionInput): PositionSide => (p.size > 0 ? "long" : "short");
  const longs = open.filter((p) => p.size > 0);
  const shorts = open.filter((p) => p.size < 0);
  const sum = (ps: readonly PositionInput[]) => ps.reduce((s, p) => s + p.positionUsd, 0);
  const longUsd = sum(longs);
  const shortUsd = sum(shorts);
  const all = ctx.oiUsd ? 2 * ctx.oiUsd : null;

  const sorted = [...open].sort((a, b) => b.positionUsd - a.positionUsd);
  const top = sorted.slice(0, TOP_ACCOUNTS);
  const distance = (p: PositionInput) => liquidationDistancePct(p.size, p.liquidationPx, ctx.markPx);

  const rungs = LADDER_MAX_PCT / LADDER_STEP_PCT;
  const ladder: LadderRung[] = Array.from({ length: rungs }, (_, i) => ({
    fromPct: i * LADDER_STEP_PCT,
    toPct: (i + 1) * LADDER_STEP_PCT,
    longUsd: 0,
    shortUsd: 0,
    longAccounts: 0,
    shortAccounts: 0,
  }));
  const beyondUsd = { long: 0, short: 0 };
  const unliquidatableUsd = { long: 0, short: 0 };
  for (const p of open) {
    const side = sideOf(p);
    const d = distance(p);
    if (d === null) unliquidatableUsd[side] += p.positionUsd;
    else if (d >= LADDER_MAX_PCT) beyondUsd[side] += p.positionUsd;
    else {
      const rung = ladder[Math.floor(d / LADDER_STEP_PCT)]!;
      rung[`${side}Usd`] += p.positionUsd;
      rung[`${side}Accounts`]++;
    }
  }

  const book = (side: PositionSide) => ctx.sideDepthUsd[side === "long" ? "bid" : "ask"];
  const worstPush = (side: PositionSide): Push | null => {
    let worst: Push | null = null;
    let liquidated = 0;
    for (const rung of ladder) {
      if (rung.toPct > PRICED_PUSH_PCT) break;
      liquidated += rung[`${side}Usd`];
      const cost = pushCostUsd(book(side), rung.toPct);
      if (!cost || liquidated === 0) continue;
      const push = { side, pct: rung.toPct, costUsd: cost, liquidatedUsd: liquidated, ratio: liquidated / cost };
      if (!worst || push.ratio > worst.ratio) worst = push;
    }
    return worst;
  };
  const nearestCluster = (side: PositionSide): Cluster | null => {
    const rung = ladder.find((r) => r[`${side}Usd`] >= CLUSTER_USD);
    if (!rung) return null;
    return {
      side,
      fromPct: rung.fromPct,
      toPct: rung.toPct,
      usd: rung[`${side}Usd`],
      accounts: rung[`${side}Accounts`],
      costUsd: pushCostUsd(book(side), rung.toPct),
    };
  };

  return {
    accounts: new Set(open.map((p) => p.address)).size,
    longAccounts: longs.length,
    shortAccounts: shorts.length,
    longUsd,
    shortUsd,
    coverage: all ? Math.min(1, (longUsd + shortUsd) / all) : null,
    topShare: all && top.length ? Math.min(1, sum(top) / all) : null,
    largest: top.map((p) => ({
      address: p.address,
      side: sideOf(p),
      positionUsd: p.positionUsd,
      liquidationPx: p.liquidationPx,
      distancePct: distance(p),
      leverage: p.leverage,
    })),
    ladder,
    beyondUsd,
    unliquidatableUsd,
    worstPush: { long: worstPush("long"), short: worstPush("short") },
    nearestCluster: { long: nearestCluster("long"), short: nearestCluster("short") },
    oldestPolledAt: open.length ? open.reduce((t, p) => Math.min(t, p.polledAt), Infinity) : null,
    newestPolledAt: open.length ? open.reduce((t, p) => Math.max(t, p.polledAt), -Infinity) : null,
  };
}
