import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../src/store.ts";
import { TRACK, hourMove, measureOutcome, outcomeWindow, summarizeTrack, type Outcome, type TrackRow } from "../src/track.ts";
import { T, bar } from "./seed.ts";

const MIN = 60_000;
const DAY = 1_440 * MIN;
const START = T + 11 * DAY;

/** A market that drifts gently (up to 0.2% an hour) for `days` until START, then does `after` for an hour. */
function market(after: (k: number, startPx: number) => number, days = 11): Map<number, number> {
  const mids = new Map<number, number>();
  for (let t = START - days * DAY; t <= START; t += MIN) mids.set(t, 100 * (1 + 0.001 * Math.sin((t - T) / MIN / 9)));
  for (let k = 1; k <= TRACK.hourMinutes; k++) mids.set(START + k * MIN, after(k, mids.get(START)!));
  return mids;
}

test("an hour's move is the largest distance from its starting price", () => {
  const mids = new Map([[0, 100], ...Array.from({ length: 60 }, (_, i) => [(i + 1) * MIN, i === 30 ? 97 : 101] as [number, number])]);
  assert.ok(Math.abs(hourMove(mids, 0)! - 0.03) < 1e-12);
});

test("the starting price can come from a minute or two before, and a patchy hour doesn't count", () => {
  const late = new Map([[-2 * MIN, 100], ...Array.from({ length: 60 }, (_, i) => [(i + 1) * MIN, 102] as [number, number])]);
  assert.ok(Math.abs(hourMove(late, 0)! - 0.02) < 1e-12);
  const patchy = new Map([[0, 100], ...Array.from({ length: 39 }, (_, i) => [(i + 1) * MIN, 102] as [number, number])]);
  assert.equal(hourMove(patchy, 0), null);
});

test("a sharp hour after an alert ranks at the top of the market's own hours", () => {
  const o = measureOutcome(market((k, px) => px * (1 + 0.04 * (k / 60))), START + 25_000)!;
  assert.ok(Math.abs(o.movePct - 4) < 1e-9, `moved ${o.movePct}%`);
  assert.equal(o.rank, 1);
  assert.ok(o.usualPct > 0.05 && o.usualPct < 0.25, `usual ${o.usualPct}%`);
  // Every 15 minutes over 7 days, all ending before the alert's hour starts.
  assert.equal(o.baselineHours, 669);
  // The same time of day on each of the 3 days before, ranked against their own week.
  assert.equal(o.controlRanks.length, 3);
});

test("a quiet hour after an alert ranks low, and a market without a day of history isn't measured", () => {
  const quiet = measureOutcome(market((_, px) => px), START)!;
  assert.equal(quiet.movePct, 0);
  assert.equal(quiet.rank, 0);
  assert.equal(measureOutcome(market(() => 104, 0.5), START), null);
});

test("the window covers the baselines of the alert and its controls", () => {
  const { from, to } = outcomeWindow(START + 25_000);
  assert.equal(to, START + 60 * MIN);
  assert.equal(from, START - 10 * DAY - 2 * MIN);
});

const outcome = (rank: number, controlRanks: number[] = [0.5, 0.95]): Outcome => ({ movePct: rank * 2, usualPct: 0.3, rank, baselineHours: 600, controlRanks });
const row = (id: number, kind: TrackRow["kind"], o: Outcome | null | undefined): TrackRow => ({ id, kind, coin: "BTC", severity: "warning", startedAt: T + id * MIN, title: `#${id}`, outcome: o });

test("the summary counts hits, misses, controls and pending alerts, by kind too", () => {
  const rows = [
    row(1, "oi-surge", outcome(0.97)),
    row(2, "oi-surge", outcome(0.4)),
    row(3, "pulled-wall", outcome(0.92, [])),
    row(4, "pulled-wall", null),
    row(5, "pulled-wall", undefined),
    ...Array.from({ length: 6 }, (_, i) => row(10 + i, "stale-oracle", outcome(0.1))),
  ];
  const s = summarizeTrack(rows, { generatedAt: T, liveSince: T - DAY, alertsSince: 0 });
  assert.deepEqual(s.totals, { alerts: 11, measured: 9, followed: 2, controlHours: 16, controlFollowed: 8, pending: 1 });
  assert.deepEqual(
    s.kinds.map((k) => [k.kind, k.alerts, k.measured, k.followed]),
    [["stale-oracle", 6, 6, 0], ["pulled-wall", 3, 1, 1], ["oi-surge", 2, 2, 1]],
  );
  assert.deepEqual(s.recent.map((r) => r.id), [15, 14, 13, 12, 11, 10], "the latest measured, hits and misses alike");
});

test("the store hands out warnings about a market once, after their hour", () => {
  const store = new Store(":memory:");
  const add = (coin: string | null, severity: "info" | "warning" | "critical", at: number) =>
    store.insertAlert({ kind: "oi-surge", coin, dex: "", severity, startedAt: at, updatedAt: at, resolvedAt: null, minutes: 1, title: "t", detail: "d", evidence: {}, publishedAt: null });
  const warning = add("BTC", "warning", T);
  add("BTC", "info", T);
  add(null, "warning", T);
  const critical = add("ETH", "critical", T + MIN);
  add("BTC", "warning", T + 2 * DAY);
  assert.deepEqual(store.alertsToMeasure(T + DAY, 10).map((a) => a.id), [warning, critical]);
  store.writeOutcome(warning, T + DAY, outcome(0.95));
  store.writeOutcome(critical, T + DAY, null);
  assert.deepEqual(store.alertsToMeasure(T + DAY, 10), []);

  store.writeBars([bar("BTC", 0, { midPx: 101 }), bar("BTC", 1, { midPx: null }), bar("ETH", 0, { midPx: 5 })]);
  assert.deepEqual([...store.midSeries("BTC", T, T + 10 * MIN)], [[T, 101]]);
  store.close();
});
