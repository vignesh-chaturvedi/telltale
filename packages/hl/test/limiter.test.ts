import assert from "node:assert/strict";
import { test } from "node:test";
import { TokenBucket, type Clock } from "../src/limiter.ts";

function fakeClock(): Clock & { t: number; slept: number[] } {
  const clock = {
    t: 0,
    slept: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.t += ms;
    },
  };
  return clock;
}

test("hands out the burst immediately, then paces at the per-minute rate", async () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ perMinute: 600, burst: 20, clock });
  await bucket.take(20);
  assert.deepEqual(clock.slept, []);
  await bucket.take(5);
  // 600 per minute is 10 per second, so 5 tokens take 500 ms.
  assert.deepEqual(clock.slept, [500]);
  assert.equal(bucket.taken, 25);
});

test("refills while idle, up to the burst size", async () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ perMinute: 600, burst: 20, clock });
  await bucket.take(20);
  clock.t += 60_000;
  await bucket.take(20);
  assert.deepEqual(clock.slept, []);
  await bucket.take(1);
  assert.equal(clock.slept.length, 1);
});

test("serves waiters in order", async () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ perMinute: 60, burst: 10, clock });
  const order: string[] = [];
  await Promise.all([
    bucket.take(10).then(() => order.push("big")),
    bucket.take(1).then(() => order.push("small")),
    bucket.take(5).then(() => order.push("medium")),
  ]);
  assert.deepEqual(order, ["big", "small", "medium"]);
});

test("rejects a request larger than the bucket", () => {
  const bucket = new TokenBucket({ perMinute: 60, burst: 10, clock: fakeClock() });
  assert.throws(() => bucket.take(11), /exceeds the bucket size/);
});

test("defaults the burst to a quarter of the rate", () => {
  assert.equal(new TokenBucket({ perMinute: 1000, clock: fakeClock() }).burst, 250);
});
