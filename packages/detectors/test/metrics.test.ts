import assert from "node:assert/strict";
import { test } from "node:test";
import { liquidationBand, marketMetrics, type BarInput, type DailyCandleInput, type MarketInput } from "../src/metrics.ts";

const M = 60_000;
function bar(i: number, over: Partial<BarInput> = {}): BarInput {
  return {
    ts: i * M,
    oraclePx: 100,
    markPx: 100,
    midPx: 100,
    openInterest: 1_000,
    dayNtlVlm: 5_000_000,
    spreadBps: 2,
    oracleChanges: null,
    oracleMaxGapMs: null,
    bidDepth1: 20_000,
    askDepth1: 30_000,
    bidDepth2: 50_000,
    askDepth2: 60_000,
    bidDepth5: 90_000,
    askDepth5: 80_000,
    minDepth2: 100_000,
    reachPct: 8,
    ...over,
  };
}
const input = (over: Partial<MarketInput> = {}): MarketInput => ({
  coin: "xyz:A",
  maxLeverage: 10,
  oiCapUsd: null,
  bars: Array.from({ length: 30 }, (_, i) => bar(i)),
  candles: [],
  peers: [],
  ...over,
});

test("liquidation distance is half the initial margin, priced at the widest band that fits", () => {
  assert.deepEqual(liquidationBand(40), { distancePct: 1.25, bandPct: 1 });
  assert.deepEqual(liquidationBand(20), { distancePct: 2.5, bandPct: 2 });
  assert.deepEqual(liquidationBand(10), { distancePct: 5, bandPct: 5 });
  assert.deepEqual(liquidationBand(3).bandPct, 5);
  assert.deepEqual(liquidationBand(100), { distancePct: 0.5, bandPct: 1 });
});

test("depth is measured against open interest in USD", () => {
  const m = marketMetrics(input());
  // OI is 1,000 contracts at a $100 mark.
  assert.equal(m.oiUsd, 100_000);
  assert.equal(m.depth2Usd, 110_000);
  assert.equal(m.depthToOi, 1.1);
  assert.equal(m.coverageMinutes, 30);
  assert.equal(m.spreadBps, 2);
  assert.equal(m.volume24hUsd, 5_000_000);
});

test("move cost takes the thinner side at the liquidation band", () => {
  assert.equal(marketMetrics(input({ maxLeverage: 10 })).liquidationMoveCostUsd, 80_000);
  assert.equal(marketMetrics(input({ maxLeverage: 20 })).liquidationMoveCostUsd, 50_000);
  assert.equal(marketMetrics(input({ maxLeverage: 50 })).liquidationMoveCostUsd, 20_000);
});

test("flags the move cost as a lower bound when the book rarely reaches the band", () => {
  const short = input({ bars: Array.from({ length: 10 }, (_, i) => bar(i, { reachPct: 3 })) });
  assert.equal(marketMetrics(short).moveCostIsLowerBound, true);
  assert.equal(marketMetrics(input()).moveCostIsLowerBound, false);
});

test("oracle gap is the 95th percentile distance between mid and oracle", () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(i, { midPx: i === 19 ? 102 : 100.1 }));
  // 19 of 20 minutes sit 10 bps away and one sits 200 bps away; the 95th percentile is the 19th value.
  assert.ok(Math.abs(marketMetrics(input({ bars })).oracleGapBps! - 10) < 1e-6);
});

test("oracle staleness comes only from per-market streams", () => {
  assert.equal(marketMetrics(input()).oracleUnchangedP95Sec, null);
  const bars = Array.from({ length: 20 }, (_, i) => bar(i, { oracleChanges: 10, oracleMaxGapMs: i < 5 ? 15_000 : 3_000 }));
  const m = marketMetrics(input({ bars }));
  assert.equal(m.oracleUnchangedOver10sShare, 0.25);
  assert.equal(m.oracleUnchangedP95Sec, 15);
});

test("compares the oracle with another deployer's market for the same ticker", () => {
  const peerBars = Array.from({ length: 30 }, (_, i) => ({ ts: i * M, oraclePx: 100.2 }));
  const m = marketMetrics(input({ peers: [{ coin: "para:A", bars: peerBars }] }));
  assert.deepEqual(m.peers, ["para:A"]);
  assert.ok(Math.abs(m.peerGapBps! - 19.96) < 0.01);
});

test("ignores a peer that quotes a different unit", () => {
  const peerBars = Array.from({ length: 30 }, (_, i) => ({ ts: i * M, oraclePx: 1000 }));
  const m = marketMetrics(input({ peers: [{ coin: "para:A", bars: peerBars }] }));
  assert.equal(m.peerGapBps, null);
  assert.deepEqual(m.peers, []);
});

test("counts days that moved more than 50% from the open", () => {
  const day = (i: number, over: Partial<DailyCandleInput> = {}): DailyCandleInput => ({ day: i * 86_400_000, open: 10, high: 11, low: 9, close: 10, ...over });
  const candles = [day(0), day(1, { high: 16 }), day(2, { low: 4.9 }), day(3, { high: 15 })];
  const m = marketMetrics(input({ candles }));
  assert.equal(m.bigMoveDays30, 2);
  assert.equal(m.dailyVolPct, 0);
  assert.equal(marketMetrics(input()).bigMoveDays30, null);
});

test("OI cap use needs a cap", () => {
  assert.equal(marketMetrics(input({ oiCapUsd: 200_000 })).oiCapUse, 0.5);
  assert.equal(marketMetrics(input()).oiCapUse, null);
});

test("an empty window measures nothing", () => {
  const m = marketMetrics(input({ bars: [] }));
  assert.equal(m.coverageMinutes, 0);
  assert.equal(m.depthToOi, null);
  assert.equal(m.oracleGapBps, null);
  assert.equal(m.liquidationMoveCostUsd, null);
});
