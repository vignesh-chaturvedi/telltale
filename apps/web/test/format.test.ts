import assert from "node:assert/strict";
import { test } from "node:test";
import { age, bps, count, percent, price, score, usd } from "../src/lib/format.ts";

const d = (f: { display: string }) => f.display;

test("missing and invalid values show a placeholder, never NaN", () => {
  for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(d(usd(v)), "--");
    assert.equal(d(price(v)), "--");
    assert.equal(d(percent(v)), "--");
    assert.equal(d(bps(v)), "--");
  }
});

test("USD values follow the spec's examples", () => {
  assert.equal(d(usd(0)), "$0.00");
  assert.equal(d(usd(0.004)), "<$0.01");
  assert.equal(d(usd(-0.004)), "-<$0.01");
  assert.equal(d(usd(1234.5)), "$1.2K");
  assert.equal(d(usd(1234.5, "detailed")), "$1,234.50");
  assert.equal(d(usd(1.52e12)), "$1.5T");
  assert.equal(d(usd(362_264_803.88)), "$362.3M");
  assert.equal(d(usd(362_264_803.88, "detailed")), "$362,264,803.88");
  assert.equal(d(usd(999_950)), "$1M", "rounds up into the next suffix");
  assert.equal(d(usd(-0)), "$0.00", "no signed zero");
  assert.equal(usd(1234.5).raw, "1234.5", "copy keeps full precision");
});

test("prices use significant figures and zero-subscript", () => {
  assert.equal(d(price(84_000, "compact")), "$84,000.00");
  assert.equal(d(price(142.1234, "compact")), "$142");
  assert.equal(d(price(142.1234)), "$142.12");
  assert.equal(d(price(12.3456, "compact")), "$12.3");
  assert.equal(d(price(12.3456)), "$12.346");
  assert.equal(d(price(0.1235, "compact")), "$0.124");
  assert.equal(d(price(0.1235)), "$0.12350");
  assert.equal(d(price(0.00005835, "compact")), "$0.0₄58");
  assert.equal(d(price(0.00005835)), "$0.0₄5835");
  assert.equal(d(price(-0.00005835, "compact")), "-$0.0₄58");
  assert.equal(price(0.00005835).ariaLabel, "0.00005835 dollars");
});

test("percent takes a fraction and follows the spec's decimals", () => {
  assert.equal(d(percent(0)), "0.00%");
  assert.equal(d(percent(0.00004)), "<0.01%");
  assert.equal(d(percent(-0.00004)), "-<0.01%");
  assert.equal(d(percent(0.12345)), "12.35%");
  assert.equal(d(percent(1.23456)), "123.5%");
  assert.equal(d(percent(102.504)), "10,250%");
  assert.equal(d(percent(0.007)), "0.70%");
});

test("basis points, counts, scores and ages", () => {
  assert.equal(d(bps(0)), "0 bps");
  assert.equal(d(bps(1.62)), "1.6 bps");
  assert.equal(d(bps(123.8)), "124 bps");
  assert.equal(d(bps(0.01)), "<0.1 bps");
  assert.equal(d(count(1, ["day", "days"])), "1 day");
  assert.equal(d(count(2, ["day", "days"])), "2 days");
  assert.equal(d(count(1234)), "1,234");
  assert.equal(d(score(3.456)), "3.46");
  assert.equal(age(29), "29 s");
  assert.equal(age(600), "10 min");
  assert.equal(age(7200), "2 h");
});
