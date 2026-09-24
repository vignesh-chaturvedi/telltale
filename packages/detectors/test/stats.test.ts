import assert from "node:assert/strict";
import { test } from "node:test";
import { last, median, min, p95, quantile, stdev } from "../src/stats.ts";

test("quantiles use the nearest rank and skip missing values", () => {
  const xs = [5, null, 1, 3, undefined, 2, 4];
  assert.equal(median(xs), 3);
  assert.equal(quantile(xs, 0), 1);
  assert.equal(quantile(xs, 1), 5);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2);
  assert.equal(p95(Array.from({ length: 100 }, (_, i) => i + 1)), 95);
});

test("empty input gives null rather than a made-up number", () => {
  assert.equal(median([]), null);
  assert.equal(median([null, Number.NaN]), null);
  assert.equal(min([]), null);
  assert.equal(stdev([7]), null);
  assert.equal(last([null, undefined]), null);
});

test("standard deviation, minimum and last value", () => {
  assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9])! - 2.138) < 1e-3);
  assert.equal(min([3, null, -1]), -1);
  assert.equal(last([1, 2, null]), 2);
});
