import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTE } from "../src/bars.ts";
import { HISTORY_RANGES, marketHistory, type HistoryOptions } from "../src/history.ts";
import { Store } from "../src/store.ts";
import { T, bar, seededStore } from "./seed.ts";

const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LAST = T + 29 * MINUTE;
const options = (over: Partial<HistoryOptions> = {}): HistoryOptions => ({
  coin: "xyz:AVGO", maxLeverage: 10, peers: ["para:AVGO"], pullRate: null, range: "24h", to: LAST, generatedAt: 0, ...over,
});

test("every step measures the checks the way the grade does, in the grade's depth band", async () => {
  const store = await seededStore();
  const h = marketHistory(store.db, options());
  const step = 5 * MINUTE;
  assert.equal(h.points.length, 288, "a day of 5-minute steps");
  assert.equal(h.to, LAST - (LAST % step));
  assert.equal(h.from, h.to - DAY + step);
  assert.ok(h.points.every((p, i) => p.t === h.from + i * step), "one point per step, gaps included");

  const filled = h.points.filter((p) => p.markPx !== null);
  const steps = new Set(Array.from({ length: 30 }, (_, i) => Math.floor((T + i * MINUTE) / step))).size;
  assert.equal(filled.length, steps);
  assert.equal(h.liquidationBandPct, 5, "50 / 10x leverage is a 5% move");
  for (const p of filled) {
    assert.equal(p.moveCostUsd, 1e6, "the thinner side within 5%");
    assert.equal(p.depth2Usd, 1e6);
    assert.equal(p.oiUsd, 1e6);
    assert.equal(p.depthToOi, 1);
    assert.equal(p.oracleGapBps, 5);
    assert.equal(p.peerGapBps, 49.75, "100 against para's 100.5");
  }
  assert.deepEqual(h.summary.moveCostUsd, { p10: 1e6, p50: 1e6, p90: 1e6, latest: 1e6 });
  assert.equal(h.minuteBarsFrom, null);

  const btc = marketHistory(store.db, options({ coin: "BTC", maxLeverage: 40, peers: [] }));
  assert.equal(btc.liquidationBandPct, 1, "50 / 40x is 1.25%, so the 1% band");
  assert.equal(btc.points.at(-1)!.moveCostUsd, 2e5);
  assert.equal(btc.points.at(-1)!.peerGapBps, null);
  store.close();
});

test("the cancel-adjusted cost applies the pull rate to each minute's wall depth", async () => {
  const store = await seededStore();
  store.writeBars(Array.from({ length: 30 }, (_, i) => bar("xyz:AVGO", i, { bidWall5: 4e5 })));
  const p = marketHistory(store.db, options({ pullRate: 0.5 })).points.at(-1)!;
  assert.equal(p.moveCostUsd, 1e6);
  assert.equal(p.adjustedMoveCostUsd, 8e5, "the bids within 5% lose half their $400K wall");
  assert.equal(marketHistory(store.db, options()).points.at(-1)!.adjustedMoveCostUsd, null, "no pull rate, no adjusted cost");
  store.close();
});

test("depth is the step's median and open interest its last minute, so one spike doesn't move the line", () => {
  const store = new Store(":memory:");
  const start = T - (T % HOUR) + HOUR;
  store.writeBars(
    [1, 2, 3, 4, 1000].map((x, i) =>
      bar("X", (start - T) / MINUTE + i, { bidDepth1: x * 1e5, askDepth1: x * 1e5, openInterest: (i + 1) * 1000, midPx: 100 + i / 100 }),
    ),
  );
  const h = marketHistory(store.db, options({ coin: "X", maxLeverage: 50, peers: [], range: "7d", to: start + 4 * MINUTE }));
  const p = h.points.at(-1)!;
  assert.equal(h.stepMinutes, 60);
  assert.equal(p.t, start);
  assert.equal(p.moveCostUsd, 3e5, "the median, not the mean of 2.02e7");
  assert.equal(p.oiUsd, 5e5, "the last minute's 5,000 contracts at 100");
  assert.equal(p.oracleGapBps, 4, "the 95th percentile of 0 to 4 bps");
  store.close();
});

test("the 30-day range reads 15-minute bars before the oldest minute bar, and minute bars where both exist", async () => {
  const store = await seededStore();
  const insert = store.db.prepare(`INSERT INTO bars_15m VALUES (?, ?, 15, ?, ?, ?, ?, ?, 10000, 0, 1e7, ?, 4000, 2, 1e6, 1e6, 2e6, 2e6, ?, ?, 2e6, 150, 1e5, 1e5, 1e4)`);
  const quarter = 15 * MINUTE;
  const old = T - 10 * DAY - ((T - 10 * DAY) % quarter);
  insert.run("xyz:AVGO", old, 90, 90, 90.09, 91, 89, 150, 3e6, 4e6);
  insert.run("para:AVGO", old, 91, 91, 91, 91, 91, 1, 3e6, 3e6);
  const sameStep = T - 30 * MINUTE - ((T - 30 * MINUTE) % quarter);
  insert.run("xyz:AVGO", sameStep, 50, 50, 50, 50, 50, 1, 1, 1);

  const h = marketHistory(store.db, options({ range: "30d" }));
  const step = HISTORY_RANGES["30d"].stepMs;
  assert.equal(h.points.length, 180, "30 days of 4-hour steps");
  assert.equal(h.minuteBarsFrom, T);
  const rolled = h.points.find((p) => p.t === old - (old % step))!;
  assert.equal(rolled.markPx, 90);
  assert.equal(rolled.moveCostUsd, 3e6, "the thinner side's 15-minute average within 5%");
  assert.equal(rolled.oracleGapBps, 10, "the quarter hour's last minute, like a minute bar, not its largest gap of 150");
  assert.equal(rolled.peerGapBps, 109.89, "oracle 90 against para's 91");
  const mixed = h.points.find((p) => p.t === T - (T % step))!;
  assert.equal(mixed.markPx, 100, "the minute bars win over the 15-minute bar in the same step");
  assert.equal(mixed.moveCostUsd, 1e6);
  assert.equal(h.points.filter((p) => p.markPx !== null).length, 2);
  store.close();
});

test("daily moves cover the last 30 finished days", async () => {
  const store = await seededStore();
  const today = LAST - (LAST % DAY);
  const candle = store.db.prepare("INSERT INTO daily_candles VALUES ('xyz:AVGO', ?, 100, ?, ?, 100, 1e6)");
  candle.run(today - 31 * DAY, 400, 100);
  candle.run(today - 2 * DAY, 160, 95);
  candle.run(today - DAY, 110, 70);
  candle.run(today, 300, 100);
  const h = marketHistory(store.db, options());
  assert.deepEqual(h.dailyMoves, [
    { day: today - 2 * DAY, movePct: 60 },
    { day: today - DAY, movePct: 30 },
  ]);
  store.close();
});
