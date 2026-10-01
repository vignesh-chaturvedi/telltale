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

function run(snapshots: { at: number; extra?: Record<number, number>; mid?: number }[], trades: [number, "B" | "A", number, number][] = []) {
  const tracker = new WallTracker();
  const events: WallEvent[] = [];
  let t = 0;
  for (const snap of snapshots) {
    for (; t < trades.length && trades[t]![0] <= snap.at; t++) tracker.onTrade("ABC", trades[t]![1], trades[t]![2], trades[t]![3]);
    const { bids, asks } = book(snap.extra, snap.mid);
    events.push(...tracker.onBook("ABC", bids, asks, snap.at));
  }
  return events;
}
const kinds = (events: WallEvent[]) => events.map((e) => `${e.kind}:${e.side}@${e.px}`);
const wall = { 99.55: 400_000 };

test("a wall that vanishes unfilled within minutes was pulled", () => {
  const events = run([
    { at: T },
    { at: T + S, extra: wall },
    { at: T + 2 * S, extra: wall },
    { at: T + 40 * S, extra: wall },
    { at: T + 41 * S },
  ]);
  assert.deepEqual(kinds(events), ["appeared:bid@99.55", "pulled:bid@99.55"]);
  const pulled = events[1]!;
  assert.equal(pulled.peakUsd, 420_000);
  assert.equal(pulled.at - pulled.firstSeen, 40 * S);
  const signal = pulledWallSignal(pulled, "")!;
  assert.equal(signal.severity, "warning");
  assert.equal(signal.title, "A $420K bid wall was pulled after 3 min 20 s");
});

test("a one-snapshot flicker is ignored", () => {
  assert.deepEqual(kinds(run([{ at: T }, { at: T + S, extra: wall }, { at: T + 2 * S }])), []);
});

test("a wall that was traded against isn't pulled", () => {
  const trades: [number, "B" | "A", number, number][] = [[T + 3 * S, "A", 99.55, 60_000]];
  const events = run([{ at: T, extra: wall }, { at: T + S, extra: wall }, { at: T + 2 * S, extra: wall }, { at: T + 4 * S }], trades);
  assert.deepEqual(kinds(events), ["appeared:bid@99.55", "filled:bid@99.55"]);
});

test("a wall the price moved through isn't pulled either", () => {
  const events = run([{ at: T, extra: wall }, { at: T + S, extra: wall }, { at: T + 2 * S, mid: 99.4 }]);
  assert.deepEqual(kinds(events), ["appeared:bid@99.55", "filled:bid@99.55"]);
});

test("a wall that stood longer than ten minutes expired", () => {
  const long = DEFAULT_WALL_RULES.maxLifetimeMs + S;
  const events = run([{ at: T, extra: wall }, { at: T + S, extra: wall }, { at: T + long, extra: wall }, { at: T + long + S }]);
  assert.deepEqual(kinds(events), ["appeared:bid@99.55", "expired:bid@99.55"]);
  assert.equal(pulledWallSignal(events[1]!, ""), null);
});

test("ordinary levels, and big ones far from mid, aren't walls", () => {
  assert.deepEqual(kinds(run([{ at: T, extra: { 99.95: 30_000 } }, { at: T + S, extra: { 99.95: 30_000 } }])), [], "only 2.5× typical");
  const far = [{ at: T, extra: { 101.95: 400_000 } }, { at: T + S, extra: { 101.95: 400_000 } }];
  assert.deepEqual(kinds(run(far)), ["appeared:ask@101.95"], "1.95% from mid is within the default 2%");
  const near = new WallTracker({ ...DEFAULT_WALL_RULES, maxDistancePct: 1 });
  const events = far.flatMap((s) => {
    const { bids, asks } = book(s.extra);
    return near.onBook("ABC", bids, asks, s.at);
  });
  assert.deepEqual(kinds(events), [], "outside a 1% limit");
});

test("small pulled walls are information, and a large share of a thin side is critical", () => {
  const small = run([{ at: T, extra: { 100.35: 120_000 } }, { at: T + S, extra: { 100.35: 120_000 } }, { at: T + 2 * S }]);
  assert.equal(pulledWallSignal(small.at(-1)!, "")!.severity, "info");
  const huge = run([{ at: T, extra: { 100.35: 5_000_000 } }, { at: T + S, extra: { 100.35: 5_000_000 } }, { at: T + 2 * S }]);
  const signal = pulledWallSignal(huge.at(-1)!, "")!;
  assert.equal(signal.severity, "critical");
  assert.match(signal.detail, /ask of \$5\.0M at 100\.350, 9\d% of the ask side/);
});
