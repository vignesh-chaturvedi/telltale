import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ALERT_RULES, detectMinute, type AlertContext } from "../src/alerts.ts";
import type { BarInput } from "../src/metrics.ts";
import { duration } from "../src/text.ts";

const T = 1_790_000_000_000;
const M = 60_000;

/** A quiet market: mark, mid and oracle agree, $1M within ±2%, $10M of open interest. */
function bar(i: number, over: Partial<BarInput> = {}): BarInput {
  return {
    ts: T + i * M,
    oraclePx: 100,
    markPx: 100.05,
    midPx: 100.05,
    openInterest: 100_000,
    dayNtlVlm: 5e6,
    spreadBps: 2,
    oracleChanges: null,
    oracleMaxGapMs: null,
    bidDepth1: 250_000,
    askDepth1: 250_000,
    bidDepth2: 500_000,
    askDepth2: 500_000,
    bidDepth5: 900_000,
    askDepth5: 900_000,
    minDepth2: 900_000,
    reachPct: 6,
    ...over,
  };
}

const history = (n: number, over: (i: number) => Partial<BarInput> = () => ({})) => Array.from({ length: n }, (_, i) => bar(i, over(i)));
const ctx = (bars: BarInput[], extra: Partial<AlertContext> = {}): AlertContext => ({ coin: "xyz:ABC", dex: "xyz", oiCapUsd: null, bars, peers: [], ...extra });
const kinds = (c: AlertContext) => detectMinute(c).map((s) => `${s.kind}:${s.severity}`);

test("a quiet market raises nothing", () => {
  assert.deepEqual(kinds(ctx(history(45))), []);
});

test("mark divergence needs every checked minute past the threshold", () => {
  const away = (bps: number) => ({ markPx: 100 * (1 + bps / 10_000) });
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 42 ? away(350) : {})))), ["mark-divergence:warning"]);
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 43 ? away(350) : {})))), [], "two minutes aren't enough");
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 42 ? away(i === 43 ? 250 : 1200) : {})))), ["mark-divergence:info"], "graded by the smallest gap");
  const [s] = detectMinute(ctx(history(45, (i) => (i >= 42 ? away(1200) : {}))));
  assert.equal(s!.severity, "critical");
  assert.equal(s!.title, "Mark price 12% from the oracle");
  assert.equal(s!.at, T + 44 * M);
});

test("a gap in the minutes stops a sustained check", () => {
  const bars = history(45, (i) => (i >= 40 ? { markPx: 104 } : {}));
  bars.splice(43, 1);
  assert.deepEqual(kinds(ctx(bars)), []);
});

test("a stale oracle only counts while the market moves away from it", () => {
  const frozen = { oracleMaxGapMs: 240_000, oracleChanges: 0 };
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 42 ? { ...frozen, midPx: 102.5, markPx: 100.5 } : {})))), ["stale-oracle:warning"]);
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 42 ? { ...frozen, midPx: 100.3 } : {})))), [], "frozen but in line with the market");
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 42 ? { oracleMaxGapMs: 20_000, midPx: 103, markPx: 100.5 } : {})))), [], "a short pause");
  const [s] = detectMinute(ctx(history(45, (i) => (i >= 42 ? { ...frozen, midPx: 101.5, markPx: 100.5 } : {}))));
  assert.equal(s!.severity, "info");
  assert.match(s!.detail, /can be normal when the underlying market is closed/);
});

test("peer divergence is reported once per pair, and ignores a peer quoting another unit", () => {
  const peerBars = (px: number) => history(45).map((b) => ({ ts: b.ts, oraclePx: px }));
  const mine = history(45);
  assert.deepEqual(kinds(ctx(mine, { peers: [{ coin: "xyz:ZZZ", bars: peerBars(98) }] })), ["peer-divergence:warning"]);
  assert.deepEqual(kinds(ctx(mine, { peers: [{ coin: "abc:ABC", bars: peerBars(98) }] })), [], "the other market of the pair reports it");
  assert.deepEqual(kinds(ctx(mine, { peers: [{ coin: "xyz:ZZZ", bars: peerBars(50) }] })), [], "a different unit");
  const [s] = detectMinute(ctx(mine, { peers: [{ coin: "xyz:ZZZ", bars: peerBars(98.8) }, { coin: "xyz:ZZY", bars: peerBars(98) }] }));
  assert.equal(s!.evidence.peer, "xyz:ZZY", "the widest gap wins");
});

test("depth collapse needs a sustained fall that leaves the book thin, with open interest holding", () => {
  const thin = { bidDepth2: 100_000, askDepth2: 100_000 };
  const collapsed = history(45, (i) => (i >= 40 ? thin : {}));
  const [s] = detectMinute(ctx(collapsed));
  assert.equal(`${s!.kind}:${s!.severity}`, "depth-collapse:warning");
  assert.equal(s!.evidence.depthUsd, 200_000);
  assert.match(s!.title, /down 80%/);
  const [milder] = detectMinute(ctx(history(45, (i) => (i >= 40 ? { bidDepth2: 150_000, askDepth2: 150_000 } : {}))));
  assert.equal(`${milder!.kind}:${milder!.severity}`, "depth-collapse:info", "down 70%, leaving 3% of open interest");
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 41 ? thin : {})))), [], "four minutes");
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 40 ? { ...thin, openInterest: 70_000 } : {})))), [], "positions unwinding");
  assert.deepEqual(kinds(ctx(history(45, (i) => (i >= 40 ? { bidDepth2: 150_000, askDepth2: 150_000, openInterest: 20_000 } : {})))), [], "still deep for its open interest");
});

test("an open-interest surge counts only in a thin market", () => {
  const surge = (depth: number) => history(45, (i) => ({ openInterest: i >= 44 ? 140_000 : 100_000, bidDepth2: depth, askDepth2: depth }));
  assert.deepEqual(kinds(ctx(surge(200_000))), ["oi-surge:warning"]);
  assert.deepEqual(kinds(ctx(surge(500_000))), [], "deep enough for it");
});

test("open interest near its cap is information only", () => {
  const [s] = detectMinute(ctx(history(45), { oiCapUsd: 10_500_000 }));
  assert.equal(`${s!.kind}:${s!.severity}`, "oi-cap:info");
  assert.deepEqual(kinds(ctx(history(45), { oiCapUsd: 20_000_000 })), []);
});

test("the default rules need no more history than advertised", () => {
  const r = DEFAULT_ALERT_RULES.depthCollapse;
  assert.ok(r.baselineMinutes + r.gapMinutes + r.minutes <= 45);
});

test("durations read naturally", () => {
  assert.equal(duration(45_000), "45 s");
  assert.equal(duration(150_000), "2 min 30 s");
  assert.equal(duration(1_500_000), "25 min");
  assert.equal(duration(7_200_000), "2 h");
});
