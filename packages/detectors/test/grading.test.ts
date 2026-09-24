import assert from "node:assert/strict";
import { test } from "node:test";
import { RULES, band, gradeDex, gradeMarket, letter } from "../src/grading.ts";
import type { MarketMetrics } from "../src/metrics.ts";

const strong: MarketMetrics = {
  coin: "BTC",
  coverageMinutes: 60,
  oiUsd: 3e9,
  volume24hUsd: 5e9,
  spreadBps: 0.5,
  depth2Usd: 4e8,
  thinnestDepth2Usd: 3e8,
  depthToOi: 0.13,
  liquidationDistancePct: 1.25,
  liquidationBandPct: 1,
  liquidationMoveCostUsd: 1e8,
  moveCostIsLowerBound: false,
  oracleGapBps: 3,
  oracleUnchangedP95Sec: null,
  oracleUnchangedOver10sShare: null,
  peerGapBps: null,
  peers: [],
  bigMoveDays30: 0,
  dailyVolPct: 2,
  oiCapUse: null,
};
const rule = (key: string) => RULES.find((r) => r.key === key)!;

test("bands follow each rule's direction", () => {
  assert.equal(band(rule("depthToOi"), 0.1), "A");
  assert.equal(band(rule("depthToOi"), 0.099), "B");
  assert.equal(band(rule("depthToOi"), 0.001), "E");
  assert.equal(band(rule("oracleGap"), 20), "A");
  assert.equal(band(rule("oracleGap"), 251), "E");
  assert.equal(band(rule("bigMoves"), 0), "A");
  assert.equal(band(rule("bigMoves"), 1), "C");
  assert.equal(band(rule("bigMoves"), 2), "E");
});

test("letters from scores", () => {
  assert.deepEqual([4, 3.5, 3.49, 2.5, 1.5, 0.75, 0.74].map(letter), ["A", "A", "B", "B", "C", "D", "E"]);
});

test("the weights add up to one", () => {
  assert.ok(Math.abs(RULES.reduce((s, r) => s + r.weight, 0) - 1) < 1e-9);
});

test("a deep, well-priced market grades A with no reasons", () => {
  const g = gradeMarket(strong);
  assert.equal(g.grade, "A");
  assert.deepEqual(g.reasons, []);
  assert.equal(g.bands.peerGap, undefined, "no peer, so the peer check drops out");
});

test("one serious problem caps the grade at two letters above it", () => {
  const g = gradeMarket({ ...strong, oracleGapBps: 500 });
  assert.equal(g.bands.oracleGap, "E");
  // The weighted score is about 2.9 (a B), and the E caps it at C.
  assert.equal(g.grade, "C");
  assert.equal(g.reasons[0]!.metric, "oracleGap");
  assert.match(g.reasons[0]!.text, /500 bps apart/);
});

test("reasons list C-or-worse metrics, worst first, in neutral words", () => {
  const g = gradeMarket({ ...strong, depthToOi: 0.03, liquidationMoveCostUsd: 20_000, bigMoveDays30: 1 });
  assert.deepEqual(g.reasons.map((r) => [r.metric, r.grade]), [
    ["liquidationMoveCost", "E"],
    ["depthToOi", "C"],
    ["bigMoves", "C"],
  ]);
  for (const r of g.reasons) assert.doesNotMatch(`${r.label} ${r.text}`, /manipulat|scam|fraud|attack/i);
});

test("too little data means no grade, with a note saying why", () => {
  const g = gradeMarket({ ...strong, coverageMinutes: 5 });
  assert.equal(g.grade, null);
  assert.match(g.notes[0]!, /Only 5 minutes/);
});

test("notes explain context that isn't graded", () => {
  const g = gradeMarket({ ...strong, oiCapUse: 0.95, oracleUnchangedOver10sShare: 0.5, moveCostIsLowerBound: true });
  assert.equal(g.notes.length, 3);
  assert.match(g.notes.join(" "), /95% of its open-interest cap/);
  assert.match(g.notes.join(" "), /may be closed or have no public price/);
});

const graded = (coin: string, over: Partial<MarketMetrics>) => {
  const metrics = { ...strong, coin, ...over };
  return { metrics, grade: gradeMarket(metrics) };
};

test("a DEX without live markets is dormant", () => {
  const d = gradeDex({ dex: "flx", collateral: "USDH", markets: [] });
  assert.equal(d.status, "dormant");
  assert.equal(d.grade, null);
});

test("DEX grades weight markets by open interest", () => {
  const big = graded("xyz:BIG", { oiUsd: 1e9 });
  const tiny = graded("xyz:TINY", { oiUsd: 1e5, depthToOi: 0.001, liquidationMoveCostUsd: 1_000 });
  const d = gradeDex({ dex: "xyz", collateral: "USDC", markets: [big, tiny] });
  assert.equal(d.grade, "A");
  assert.deepEqual(d.counts, { A: 1, B: 0, C: 1, D: 0, E: 0 });
  assert.deepEqual(d.notes, ["Collateral: USDC."]);
});

test("widespread oracle gaps cap a DEX at C", () => {
  const markets = [graded("x:A", {}), graded("x:B", {}), graded("x:C", { oracleGapBps: 300 })];
  const d = gradeDex({ dex: "x", collateral: null, markets });
  assert.equal(d.grade, "C");
  assert.match(d.reasons[0]!, /1 of 3 markets/);
});
