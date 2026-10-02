import assert from "node:assert/strict";
import { test } from "node:test";
import { datesOf, hoursOf, INCIDENTS } from "../src/incidents.ts";
import { parseContexts, type ContextRow, type Snapshot } from "../src/load.ts";
import { barOf, crashOf, depthSensitivity, leadOf } from "../src/replay.ts";
import type { ReplayAlert } from "../src/types.ts";

const T = Date.parse("2026-04-08T22:00:00Z");
const M = 60_000;

const row = (i: number, over: Partial<ContextRow> = {}): ContextRow => ({
  ts: T + i * M,
  oraclePx: 0.2,
  markPx: 0.2,
  midPx: 0.2,
  openInterest: 200_000_000,
  dayNtlVlm: 1e8,
  impactBid: 0.1999,
  impactAsk: 0.2001,
  ...over,
});

/** A book with 20 levels a side, 0.0001 apart from 0.2, $10K each. */
const snapshot = (at: number, size = 10_000): Snapshot => {
  const side = (dir: 1 | -1) =>
    Array.from({ length: 20 }, (_, k) => {
      const px = 0.2 + dir * 0.0001 * (k + 1);
      return { px: px.toFixed(4), sz: String(size / Number(px.toFixed(4))), n: 1 };
    });
  return { at, book: { coin: "X", time: at, levels: [side(-1), side(1)] } };
};

test("asset-context CSVs parse into minutes", () => {
  const rows = parseContexts(
    "time,coin,funding,open_interest,prev_day_px,day_ntl_vlm,premium,oracle_px,mark_px,mid_px,impact_bid_px,impact_ask_px\n" +
      "2025-11-13T00:01:00Z,POPCAT,-0.0003,44122738,0.15002,133328618.73,-0.0019,0.12585,0.12543,0.12545,0.125332,0.125601\n",
  );
  assert.deepEqual(rows, [
    { ts: Date.parse("2025-11-13T00:01:00Z"), oraclePx: 0.12585, markPx: 0.12543, midPx: 0.12545, openInterest: 44122738, dayNtlVlm: 133328618.73, impactBid: 0.125332, impactAsk: 0.125601 },
  ]);
});

test("a minute bar takes depth from the minute's last snapshot and the thinnest one", () => {
  const bar = barOf(row(0), [snapshot(T, 10_000), snapshot(T + 30_000, 5_000)]);
  assert.equal(Math.round(bar.bidDepth2!), 100_000);
  assert.equal(Math.round(bar.askDepth2!), 100_000);
  assert.equal(Math.round(bar.minDepth2!), 200_000);
  assert.equal(Math.round(bar.spreadBps!), 10);
  assert.equal(bar.oracleMaxGapMs, null, "oracle timing isn't archived");
  assert.equal(barOf(row(0), []).bidDepth2, null, "no book, no depth");
});

test("the crash is the steepest one-minute fall, dated by the minute it began", () => {
  const rows = [row(0), row(1, { markPx: 0.19 }), row(2, { markPx: 0.17 }), row(3, { markPx: 0.172 })];
  assert.deepEqual(crashOf(rows), { at: T + M, movePct: (0.17 / 0.19 - 1) * 100 });
});

const alert = (minute: number, severity: ReplayAlert["severity"]): ReplayAlert => ({
  kind: "oi-surge",
  severity,
  startedAt: T + minute * M,
  resolvedAt: null,
  minutes: 1,
  title: "t",
  detail: "d",
  evidence: {},
  first: { title: "t", detail: "d", evidence: {} },
});

test("lead time counts only warnings that came before the crash", () => {
  const crashAt = T + 60 * M;
  assert.deepEqual(leadOf([alert(5, "info"), alert(13, "warning"), alert(40, "critical")], crashAt), { first: alert(13, "warning"), minutes: 47 });
  assert.deepEqual(leadOf([alert(70, "warning")], crashAt), { first: null, minutes: null }, "after the crash is a miss");
});

test("the depth check shows when a surge alert needs a thinner book", () => {
  // Open interest jumps 40% at minute 20, with $200K of depth against $40M → $56M of open interest.
  const bars = Array.from({ length: 30 }, (_, i) => barOf(row(i, { openInterest: i >= 20 ? 280_000_000 : 200_000_000 }), [snapshot(T + i * M)]));
  const result = depthSensitivity(bars, T + 25 * M, [1, 20]);
  assert.deepEqual(result[0], { multiple: 1, firstAt: T + 20 * M, leadMinutes: 5 });
  assert.deepEqual(result[1], { multiple: 20, firstAt: null, leadMinutes: null }, "$4M of depth is 7% of open interest, too deep for the alert");
});

test("incident windows cover the right archive days and hours", () => {
  const popcat = INCIDENTS.find((i) => i.id === "popcat-2025-11")!;
  assert.deepEqual(datesOf(popcat), ["2025-11-12"]);
  assert.equal(hoursOf(popcat).length, 9);
  assert.deepEqual(hoursOf(popcat)[0], ["20251112", 9]);
  const fartcoin = INCIDENTS.find((i) => i.id === "fartcoin-2026-04")!;
  assert.deepEqual(datesOf(fartcoin), ["2026-04-08", "2026-04-09"]);
});
