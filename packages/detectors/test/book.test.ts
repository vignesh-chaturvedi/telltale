import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { summarizeBook, toLevels } from "../src/book.ts";

const close = (actual: number | null, expected: number, digits = 6) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 10 ** -digits, `${actual} ≈ ${expected}`);

test("measures spread, depth bands and reach on a simple book", () => {
  // mid = 100, so the 1% band is 99..101, 2% is 98..102 and 5% is 95..105.
  const s = summarizeBook(
    [
      { px: 99.5, sz: 10 },
      { px: 98.5, sz: 10 },
      { px: 96, sz: 10 },
    ],
    [
      { px: 100.5, sz: 4 },
      { px: 101.5, sz: 4 },
      { px: 104, sz: 20 },
    ],
  );
  assert.equal(s.mid, 100);
  close(s.spreadBps, 100);
  assert.deepEqual(s.bidDepth, { 1: 995, 2: 995 + 985, 5: 995 + 985 + 960 });
  assert.deepEqual(s.askDepth, { 1: 402, 2: 402 + 406, 5: 402 + 406 + 2080 });
  assert.equal(s.largestLevelUsd, 2080);
  // Bids reach 4% below mid and asks 4% above; the shallower side decides.
  close(s.reachPct, 4);
});

test("counts a level exactly on a band edge as inside it", () => {
  const s = summarizeBook([{ px: 99, sz: 1 }], [{ px: 101, sz: 1 }]);
  assert.equal(s.bidDepth[1], 99);
  assert.equal(s.askDepth[1], 101);
});

test("returns empty depth and no mid for a one-sided or empty book", () => {
  const oneSided = summarizeBook([{ px: 10, sz: 5 }], []);
  assert.equal(oneSided.mid, null);
  assert.equal(oneSided.spreadBps, null);
  assert.deepEqual(oneSided.bidDepth, { 1: 0, 2: 0, 5: 0 });
  assert.equal(oneSided.largestLevelUsd, 50);

  const empty = summarizeBook([], []);
  assert.equal(empty.bestBid, null);
  assert.equal(empty.reachPct, null);
  assert.equal(empty.largestLevelUsd, 0);
});

test("handles a real HIP-3 book from the API", () => {
  const book = JSON.parse(
    readFileSync(new URL("../../../apps/collector/test/fixtures/rest/l2Book-xyz_SP500.json", import.meta.url), "utf8"),
  ) as { levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] };
  const s = summarizeBook(toLevels(book.levels[0]), toLevels(book.levels[1]));
  assert.equal(s.bidLevels, 20);
  assert.ok(s.bestBid! < s.bestAsk!);
  assert.ok(s.bidDepth[1] <= s.bidDepth[2] && s.bidDepth[2] <= s.bidDepth[5]);
  assert.ok(s.reachPct! > 0);
});
