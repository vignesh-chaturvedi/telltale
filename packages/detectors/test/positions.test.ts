import assert from "node:assert/strict";
import { test } from "node:test";
import { liquidationDistancePct, positionMetrics, pushCostUsd, type PositionContext, type PositionInput } from "../src/positions.ts";

const T = 1_790_000_000_000;
const ctx: PositionContext = {
  markPx: 100,
  oiUsd: 10e6,
  sideDepthUsd: { bid: { 1: 1e6, 2: 2e6, 5: 4e6 }, ask: { 1: 5e5, 2: 1e6, 5: 3e6 } },
};
const pos = (address: string, usd: number, liquidationPx: number | null, side: "long" | "short" = "long", polledAt = T): PositionInput => ({
  address,
  size: (side === "long" ? 1 : -1) * (usd / 100),
  positionUsd: usd,
  liquidationPx,
  leverage: 10,
  polledAt,
});
const book: PositionInput[] = [
  pos("L1", 2e6, 98.5),
  pos("L2", 5e5, 99.5),
  pos("L3", 3e6, 85, "long", T - 3_600_000),
  pos("L4", 1e6, null),
  pos("L5", 1e5, 50),
  pos("L6", 5e4, 101, "long", T + 60_000),
  pos("S1", 1.2e6, 104.5, "short"),
  pos("S2", 3e5, 100.2, "short"),
  pos("S3", 2e6, null, "short"),
];

test("distance to liquidation is measured from the mark, toward the side that loses", () => {
  assert.equal(liquidationDistancePct(1, 95, 100), 5);
  assert.equal(liquidationDistancePct(-1, 110, 100), 10);
  assert.equal(liquidationDistancePct(1, 101, 100), 0, "a read already past its price counts as at the mark");
  assert.equal(liquidationDistancePct(1, null, 100), null);
});

test("a push is priced from the measured bands, interpolated between them and not past 5%", () => {
  const depth = { 1: 1e6, 2: 2e6, 5: 5e6 } as const;
  assert.equal(pushCostUsd(depth, 0.5), 5e5);
  assert.equal(pushCostUsd(depth, 2), 2e6);
  assert.equal(pushCostUsd(depth, 3.5), 3.5e6);
  assert.equal(pushCostUsd(depth, 6), null);
  assert.equal(pushCostUsd({ 1: 1e6, 2: null, 5: 5e6 }, 3), null);
});

test("coverage and concentration count longs and shorts against twice the open interest", () => {
  const m = positionMetrics(book, ctx);
  assert.equal(m.accounts, 9);
  assert.deepEqual([m.longAccounts, m.shortAccounts], [6, 3]);
  assert.deepEqual([m.longUsd, m.shortUsd], [6.65e6, 3.5e6]);
  assert.equal(m.coverage, 10.15e6 / 20e6);
  assert.equal(m.topShare, m.coverage, "nine accounts, all in the top ten");
  assert.deepEqual(m.largest.slice(0, 2).map((p) => [p.address, p.side, p.distancePct]), [["L3", "long", 15], ["L1", "long", 1.5]]);
  assert.equal(m.largest.find((p) => p.address === "S3")!.distancePct, null);
  assert.deepEqual([m.oldestPolledAt, m.newestPolledAt], [T - 3_600_000, T + 60_000]);
  assert.equal(positionMetrics(book, { ...ctx, oiUsd: null }).coverage, null);
  assert.equal(positionMetrics([pos("W", 30e6, 90)], ctx).coverage, 1, "reads at different times can't add up to more than everything");
});

test("the ladder buckets liquidations by 1% of distance, with the rest set aside", () => {
  const m = positionMetrics(book, ctx);
  assert.equal(m.ladder.length, 20);
  const rung = (i: number) => {
    const r = m.ladder[i]!;
    return [r.longUsd, r.longAccounts, r.shortUsd, r.shortAccounts];
  };
  assert.deepEqual(rung(0), [5.5e5, 2, 3e5, 1], "L2, the stale L6, and S2");
  assert.deepEqual(rung(1), [2e6, 1, 0, 0]);
  assert.deepEqual(rung(4), [0, 0, 1.2e6, 1]);
  assert.deepEqual(rung(15), [3e6, 1, 0, 0]);
  assert.deepEqual(m.beyondUsd, { long: 1e5, short: 0 });
  assert.deepEqual(m.unliquidatableUsd, { long: 1e6, short: 2e6 });
});

test("the worst push liquidates the most per dollar of book, and clusters are $1M+ rungs", () => {
  const m = positionMetrics(book, ctx);
  assert.deepEqual(m.worstPush.long, { side: "long", pct: 2, costUsd: 2e6, liquidatedUsd: 2.55e6, ratio: 1.275 });
  assert.deepEqual(m.worstPush.short, { side: "short", pct: 1, costUsd: 5e5, liquidatedUsd: 3e5, ratio: 0.6 });
  assert.deepEqual(m.nearestCluster.long, { side: "long", fromPct: 1, toPct: 2, usd: 2e6, accounts: 1, costUsd: 2e6 });
  assert.deepEqual(m.nearestCluster.short, { side: "short", fromPct: 4, toPct: 5, usd: 1.2e6, accounts: 1, costUsd: 3e6 });

  const far = positionMetrics([pos("F", 5e6, 90)], ctx);
  assert.equal(far.nearestCluster.long!.costUsd, null, "10% away is past the measured book");
  assert.equal(far.worstPush.long, null, "nothing liquidates within 5%");
  assert.equal(positionMetrics([], ctx).largest.length, 0);
});
