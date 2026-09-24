import assert from "node:assert/strict";
import { test } from "node:test";
import type { MinuteBar } from "../src/bars.ts";
import { scoreDatabase, tickerOf } from "../src/scoring.ts";
import { Store } from "../src/store.ts";
import { loadUniverse } from "../src/universe.ts";
import { fixtureInfo } from "./fixtures.ts";

const T = 1_790_000_000_000 - (1_790_000_000_000 % 60_000);

function bar(coin: string, i: number, over: Partial<MinuteBar> = {}): MinuteBar {
  return {
    coin, ts: T + i * 60_000, ctxSource: "stream", ctxUpdates: 60, oraclePx: 100, markPx: 100, midPx: 100.05,
    openInterest: 10_000, funding: 0, premium: 0, dayNtlVlm: 1e7, oracleChanges: 20, oracleMaxGapMs: 4_000,
    spreadBps: 1, bookSource: "stream", bookUpdates: 12, bestBid: 99.9, bestAsk: 100.1,
    bidDepth1: 2e5, askDepth1: 2e5, bidDepth2: 5e5, askDepth2: 5e5, bidDepth5: 1e6, askDepth5: 1e6,
    minDepth2: 9e5, largestLevelUsd: 5e4, reachPct: 6, trades: 10, buyNtl: 1e4, sellNtl: 1e4, maxTradeNtl: 2e3,
    ...over,
  };
}

async function seededStore() {
  const store = new Store(":memory:");
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

test("tickers drop the DEX prefix", () => {
  assert.equal(tickerOf("xyz:AVGO"), "AVGO");
  assert.equal(tickerOf("BTC"), "BTC");
});

test("grades markets with enough data and explains the rest", async () => {
  const store = await seededStore();
  const card = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20 });
  assert.equal(card.to, T + 29 * 60_000);
  assert.equal(card.from, T);
  const btc = card.markets.find((m) => m.coin === "BTC")!;
  assert.ok(btc.grade.grade !== null);
  assert.equal(btc.metrics.coverageMinutes, 30);
  const eth = card.markets.find((m) => m.coin === "ETH")!;
  assert.equal(eth.grade.grade, null, "5 minutes isn't enough");
  const atom = card.markets.find((m) => m.coin === "ATOM")!;
  assert.equal(atom.metrics.coverageMinutes, 0);
  assert.ok(!card.markets.some((m) => m.coin === "MATIC"), "delisted markets aren't graded");
  store.close();
});

test("checks each HIP-3 oracle against other deployers of the same ticker", async () => {
  const store = await seededStore();
  const card = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20 });
  const xyz = card.markets.find((m) => m.coin === "xyz:AVGO")!;
  assert.deepEqual(xyz.metrics.peers, ["para:AVGO"]);
  assert.ok(Math.abs(xyz.metrics.peerGapBps! - 49.75) < 0.01);
  assert.deepEqual(card.markets.find((m) => m.coin === "BTC")!.metrics.peers, [], "core markets have no peers");
  store.close();
});

test("summarizes every DEX, including dormant ones", async () => {
  const store = await seededStore();
  const card = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20 });
  const flx = card.dexes.find((d) => d.dex === "flx")!;
  assert.equal(flx.status, "dormant");
  const core = card.dexes.find((d) => d.dex === "")!;
  assert.equal(core.collateral, "USDC");
  assert.equal(core.graded, 1);
  store.close();
});
