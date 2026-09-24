/** A price level as plain numbers. */
export interface Level {
  px: number;
  sz: number;
}

/** Distances from mid, in percent, at which resting depth is measured. */
export const DEPTH_BANDS = [1, 2, 5] as const;
export type DepthBand = (typeof DEPTH_BANDS)[number];

export interface BookSummary {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  spreadBps: number | null;
  /** USD resting within each band of mid, per side. Only counts the levels the feed shows. */
  bidDepth: Record<DepthBand, number>;
  askDepth: Record<DepthBand, number>;
  /** USD size of the largest single level on either side. */
  largestLevelUsd: number;
  /**
   * How far from mid, in percent, the shallower side's visible book reaches. When it is below
   * a band, that band's depth is a lower bound, not the full picture.
   */
  reachPct: number | null;
  bidLevels: number;
  askLevels: number;
}

const emptyDepth = (): Record<DepthBand, number> => ({ 1: 0, 2: 0, 5: 0 });

/** Parses the API's string levels. */
export function toLevels(levels: readonly { px: string; sz: string }[]): Level[] {
  return levels.map((l) => ({ px: Number(l.px), sz: Number(l.sz) }));
}

/**
 * Summarizes one order-book snapshot. `bids` and `asks` must be ordered best first, as the
 * Hyperliquid API returns them.
 */
export function summarizeBook(bids: readonly Level[], asks: readonly Level[]): BookSummary {
  const bestBid = bids[0]?.px ?? null;
  const bestAsk = asks[0]?.px ?? null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const summary: BookSummary = {
    bestBid,
    bestAsk,
    mid,
    spreadBps: mid && bestBid !== null && bestAsk !== null ? ((bestAsk - bestBid) / mid) * 10_000 : null,
    bidDepth: emptyDepth(),
    askDepth: emptyDepth(),
    largestLevelUsd: 0,
    reachPct: null,
    bidLevels: bids.length,
    askLevels: asks.length,
  };
  for (const l of [...bids, ...asks]) summary.largestLevelUsd = Math.max(summary.largestLevelUsd, l.px * l.sz);
  if (mid === null) return summary;

  for (const l of bids) {
    const dist = ((mid - l.px) / mid) * 100;
    for (const band of DEPTH_BANDS) if (dist <= band) summary.bidDepth[band] += l.px * l.sz;
  }
  for (const l of asks) {
    const dist = ((l.px - mid) / mid) * 100;
    for (const band of DEPTH_BANDS) if (dist <= band) summary.askDepth[band] += l.px * l.sz;
  }
  const bidReach = ((mid - bids.at(-1)!.px) / mid) * 100;
  const askReach = ((asks.at(-1)!.px - mid) / mid) * 100;
  summary.reachPct = Math.min(bidReach, askReach);
  return summary;
}
