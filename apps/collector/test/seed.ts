import type { MinuteBar } from "../src/bars.ts";
import { Store } from "../src/store.ts";
import { loadUniverse } from "../src/universe.ts";
import { fixtureInfo } from "./fixtures.ts";

export const T = 1_790_000_000_000 - (1_790_000_000_000 % 60_000);

export function bar(coin: string, i: number, over: Partial<MinuteBar> = {}): MinuteBar {
  return {
    coin, ts: T + i * 60_000, ctxSource: "stream", ctxUpdates: 60, oraclePx: 100, markPx: 100, midPx: 100.05,
    openInterest: 10_000, funding: 0, premium: 0, dayNtlVlm: 1e7, oracleChanges: 20, oracleMaxGapMs: 4_000,
    spreadBps: 1, bookSource: "stream", bookUpdates: 12, bestBid: 99.9, bestAsk: 100.1,
    bidDepth1: 2e5, askDepth1: 2e5, bidDepth2: 5e5, askDepth2: 5e5, bidDepth5: 1e6, askDepth5: 1e6,
    minDepth2: 9e5, largestLevelUsd: 5e4, reachPct: 6, trades: 10, buyNtl: 1e4, sellNtl: 1e4, maxTradeNtl: 2e3,
    ...over,
  };
}

/** A store with the fixture universe and 30 minutes of bars for BTC, ETH (5 minutes), xyz:AVGO and para:AVGO. */
export async function seededStore(path = ":memory:") {
  const store = new Store(path);
  store.saveUniverse(await loadUniverse(fixtureInfo(), { withLimits: true, tokenNames: new Map([[0, "USDC"]]) }));
  // Two deployers listing the same ticker, to exercise the peer check (para:AVGO is in the fixtures).
  for (const coin of ["xyz:AVGO", "para:AVGO"]) {
    store.db.prepare("INSERT OR IGNORE INTO markets VALUES (?, ?, 99, 2, 10, null, 0, null, null, 0, null, 0, 0)").run(coin, coin.split(":")[0]!);
  }
  const bars: MinuteBar[] = [];
  for (let i = 0; i < 30; i++) {
    bars.push(bar("BTC", i));
    bars.push(bar("xyz:AVGO", i));
    bars.push(bar("para:AVGO", i, { oraclePx: 100.5 }));
    if (i >= 25) bars.push(bar("ETH", i));
  }
  store.writeBars(bars);
  return store;
}

