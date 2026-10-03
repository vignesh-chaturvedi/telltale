import assert from "node:assert/strict";
import { test } from "node:test";
import type { Level } from "../src/book.ts";
import { DEFAULT_WALL_RULES, WallTracker, pulledWallSignal, type WallEvent } from "../src/walls.ts";

const T = 1_790_000_000_000;
const S = 5_000;

/** A book around 100 with 20 levels a side, 0.1 apart and $20K each, plus any extra size by price. */
function book(extra: Record<number, number> = {}, mid = 100): { bids: Level[]; asks: Level[] } {
  const side = (dir: 1 | -1) =>
    Array.from({ length: 20 }, (_, i) => {
      const px = Math.round((mid + dir * (0.05 + i * 0.1)) * 100) / 100;
      return { px, sz: (20_000 + (extra[px] ?? 0)) / px };
    });
  return { bids: side(-1), asks: side(1) };
}

type Snap = { at: number; extra?: Record<number, number>; mid?: number };

function run(snapshots: Snap[], trades: [number, "B" | "A", number, number][] = [], tracker = new WallTracker()) {
  const events: WallEvent[] = [];
  let t = 0;
  for (const snap of snapshots) {
    for (; t < trades.length && trades[t]![0] <= snap.at; t++) tracker.onTrade("ABC", trades[t]![1], trades[t]![2], trades[t]![3]);
    const { bids, asks } = book(snap.extra, snap.mid);
    events.push(...tracker.onBook("ABC", bids, asks, snap.at));
  }
  return events;
}
const kinds = (events: WallEvent[]) => events.filter((e) => e.kind !== "appeared").map((e) => `${e.kind}:${e.side}@${e.px}`);
/** Snapshots every 5 s from `from` to `to` (exclusive), with `extra` standing on the book. */
const span = (from: number, to: number, extra?: Record<number, number>): Snap[] =>
  Array.from({ length: Math.ceil((to - from) / S) }, (_, i) => ({ at: T + from + i * S, extra }));
const wall = { 99.55: 400_000 };

test("a wall that vanishes unfilled, and isn't replaced nearby, was pulled", () => {
  const events = run([...span(0, 200_000, wall), ...span(200_000, 230_000)]);
  assert.deepEqual(kinds(events), ["pulled:bid@99.55"], "reported once the 15 s wait for a replacement is over");
  const pulled = events.at(-1)!;
  assert.equal(pulled.peakUsd, 420_000);
  assert.equal(pulled.at, T + 200_000, "dated when it vanished");
  assert.equal(pulled.at - pulled.firstSeen, 200_000);
});

test("a wall that reappears nearby was moved, not pulled", () => {
  const events = run([...span(0, 100_000, wall), ...span(100_000, 105_000), ...span(105_000, 140_000, { 99.45: 380_000 })]);
  assert.deepEqual(kinds(events), ["moved:bid@99.55"]);
  const sameSnapshot = run([...span(0, 100_000, wall), ...span(100_000, 140_000, { 99.65: 400_000 })]);
  assert.deepEqual(kinds(sameSnapshot), ["moved:bid@99.55"], "moved in one step");
});

test("a one-snapshot flicker is ignored", () => {
  assert.deepEqual(kinds(run([{ at: T }, { at: T + S, extra: wall }, ...span(2 * S, 40_000)])), []);
});

test("a wall that was traded against isn't pulled", () => {
  const trades: [number, "B" | "A", number, number][] = [[T + 3 * S, "A", 99.55, 60_000]];
  assert.deepEqual(kinds(run([...span(0, 4 * S, wall), ...span(4 * S, 40_000)], trades)), ["filled:bid@99.55"]);
});

test("a wall the price moved through isn't pulled either", () => {
  assert.deepEqual(kinds(run([...span(0, 3 * S, wall), { at: T + 3 * S, mid: 99.4 }])), ["filled:bid@99.55"]);
});

test("a wall that stood longer than ten minutes expired", () => {
  const long = DEFAULT_WALL_RULES.maxLifetimeMs + S;
  assert.deepEqual(kinds(run([...span(0, long, wall), ...span(long, long + 30_000)])), ["expired:bid@99.55"]);
});

test("ordinary levels, and big ones far from mid, aren't walls", () => {
  assert.deepEqual(run(span(0, 2 * S, { 99.95: 30_000 })), [], "only 2.5× typical");
  const far = span(0, 2 * S, { 101.95: 400_000 });
  assert.deepEqual(run(far).map((e) => e.kind), ["appeared"], "1.95% from mid is within the default 2%");
  assert.deepEqual(run(far, [], new WallTracker({ ...DEFAULT_WALL_RULES, maxDistancePct: 1 })), [], "outside a 1% limit");
});

/** Ten routine $100K ask walls that come and go, so the market has a usual wall size. */
function withHistory(): { tracker: WallTracker; t: number } {
  const tracker = new WallTracker();
  let t = 0;
  for (let i = 0; i < 10; i++) {
    run([...span(t, t + 40_000, { 100.55: 100_000 }), ...span(t + 40_000, t + 60_000)], [], tracker);
    t += 60_000;
  }
  return { tracker, t };
}

test("an alert needs a wall far beyond the market's usual ones, most of its side, standing at least 30 s", () => {
  const { tracker, t } = withHistory();
  const huge = { 99.55: 2_500_000 };
  const events = run([...span(t, t + 60_000, huge), ...span(t + 60_000, t + 90_000)], [], tracker);
  const pulled = events.find((e) => e.kind === "pulled")!;
  assert.equal(pulled.typicalUsd, 120_000);
  const signal = pulledWallSignal(pulled, "")!;
  assert.equal(signal.severity, "critical");
  assert.equal(signal.title, "A $2.5M bid wall was pulled after 1 min");
  assert.match(signal.detail, /87% of the bid side within ±2% of mid and 21× this market's usual large order/);
  assert.match(signal.detail, /^A bid of \$2\.5M/);
  assert.match(pulledWallSignal({ ...pulled, side: "ask" }, "")!.detail, /^An ask of \$2\.5M/);
});

test("ordinary-sized pulled walls, brief ones, and walls in markets without history raise nothing", () => {
  const { tracker, t } = withHistory();
  const ordinary = run([...span(t, t + 60_000, { 99.55: 300_000 }), ...span(t + 60_000, t + 90_000)], [], tracker).find((e) => e.kind === "pulled")!;
  assert.equal(pulledWallSignal(ordinary, ""), null, "$320K is under twice the rest of its side");
  const brief = run([...span(t + 100_000, t + 120_000, { 99.55: 2_500_000 }), ...span(t + 120_000, t + 150_000)], [], tracker).find((e) => e.kind === "pulled")!;
  assert.equal(pulledWallSignal(brief, ""), null, "stood under 30 s");
  const fresh = run([...span(0, 60_000, { 99.55: 2_500_000 }), ...span(60_000, 90_000)]).find((e) => e.kind === "pulled")!;
  assert.equal(fresh.typicalUsd, null);
  assert.equal(pulledWallSignal(fresh, ""), null, "no usual size to compare against yet");
});
