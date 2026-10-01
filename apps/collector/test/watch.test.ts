import assert from "node:assert/strict";
import { test } from "node:test";
import type { BarInput } from "@telltale/detectors";
import type { L2Book } from "@telltale/hl";
import { MemoryAlertStore } from "../src/alerts.ts";
import { Watch } from "../src/watch.ts";

const T = 1_790_000_000_000;
const M = 60_000;

function bar(coin: string, i: number, over: Partial<BarInput> = {}): BarInput & { coin: string } {
  return {
    coin,
    ts: T + i * M,
    oraclePx: 100,
    markPx: 100,
    midPx: 100,
    openInterest: 10_000,
    dayNtlVlm: 1e6,
    spreadBps: 2,
    oracleChanges: 5,
    oracleMaxGapMs: 3_000,
    bidDepth1: 50_000,
    askDepth1: 50_000,
    bidDepth2: 100_000,
    askDepth2: 100_000,
    bidDepth5: 200_000,
    askDepth5: 200_000,
    minDepth2: 180_000,
    reachPct: 6,
    ...over,
  };
}

function setup() {
  const store = new MemoryAlertStore();
  const watch = new Watch({ alerts: store, sinks: [], publish: false, log: () => {}, now: () => T });
  watch.setMarkets([
    { coin: "xyz:NET", dex: "xyz", oiCapUsd: null },
    { coin: "para:NET", dex: "para", oiCapUsd: null },
    { coin: "BTC", dex: "", oiCapUsd: null },
  ]);
  return { store, watch };
}

test("checks each market's minute against its own history and its peers'", () => {
  const { store, watch } = setup();
  for (let i = 0; i < 5; i++) {
    watch.addBars([bar("para:NET", i), bar("xyz:NET", i, { oraclePx: 102.5, markPx: 102.5, midPx: 102.5 }), bar("BTC", i)]);
    watch.checkMinute(T + i * M);
  }
  assert.deepEqual(
    store.alerts.map((a) => `${a.kind} ${a.coin} ${a.severity}`),
    ["peer-divergence para:NET warning"],
    "one alert for the pair, from the market whose name sorts first",
  );
  assert.equal(store.alerts[0]!.minutes, 3);
});

test("markets without a bar for the minute aren't checked, and unknown markets are ignored", () => {
  const { store, watch } = setup();
  for (let i = 0; i < 4; i++) watch.addBars([bar("BTC", i, { markPx: 104 }), bar("DOGE", i, { markPx: 110 })]);
  assert.deepEqual(watch.checkMinute(T + 9 * M), []);
  assert.deepEqual(watch.checkMinute(T + 3 * M).map((s) => s.coin), ["BTC"]);
  assert.equal(store.alerts.length, 1);
});

test("order books feed the wall tracker; only how the bigger walls ended is kept", () => {
  const { store, watch } = setup();
  const book = (wall: boolean, at: number): L2Book => ({
    coin: "BTC",
    time: at,
    levels: [
      Array.from({ length: 20 }, (_, i) => ({ px: String(99.95 - i * 0.1), sz: String(((i === 4 && wall ? 400_000 : 0) + 20_000) / (99.95 - i * 0.1)), n: 1 })),
      Array.from({ length: 20 }, (_, i) => ({ px: String(100.05 + i * 0.1), sz: String(20_000 / (100.05 + i * 0.1)), n: 1 })),
    ],
  });
  const walls = [true, true, true, false, false, false, false, false];
  for (const [i, wall] of walls.entries()) watch.onBook(book(wall, T + i * 5_000), T + i * 5_000);
  const kept = watch.takeBookEvents();
  assert.deepEqual(kept.map((e) => `${e.kind} ${e.peakUsd}`), ["pulled 420000"], "appearances aren't stored");
  assert.deepEqual(watch.takeBookEvents(), [], "handed over once");
  assert.equal(store.alerts.length, 0, "no alert without the market's usual wall size to compare against");
});

test("config updates are diffed against the previous snapshot; a DEX's first snapshot isn't a change", () => {
  const { store, watch } = setup();
  const cfg = (cap: number) => JSON.stringify({ fullName: "XYZ", markets: [{ coin: "xyz:NET", maxLeverage: 10, isDelisted: false, oiCapUsd: cap }] });
  watch.onConfigUpdates([{ dex: "xyz", fullName: "XYZ", before: null, after: cfg(1e7) }], T);
  assert.equal(store.alerts.length, 0);
  watch.onConfigUpdates([{ dex: "xyz", fullName: "XYZ", before: cfg(1e7), after: cfg(2e7) }], T + M);
  assert.equal(store.alerts[0]!.title, "XYZ: xyz:NET open-interest cap $10M → $20M");
});
