import assert from "node:assert/strict";
import { test } from "node:test";
import { planSubscriptions } from "../src/plan.ts";
import { isLive, loadUniverse } from "../src/universe.ts";
import { fixtureInfo } from "./fixtures.ts";

const universe = await loadUniverse(fixtureInfo(), { withLimits: true });
const live = universe.markets.filter(isLive).map((m) => m.coin);
const delisted = universe.markets.filter((m) => !isLive(m)).map((m) => m.coin);

test("streams per-market contexts only for live markets on active HIP-3 DEXs", () => {
  const plan = planSubscriptions(universe, { bookStreams: 4 });
  const expected = universe.markets.filter((m) => isLive(m) && (m.dex === "xyz" || m.dex === "para")).map((m) => m.coin);
  assert.deepEqual([...plan.ctxStreamed].sort(), expected.sort());
  assert.ok(!plan.ctxStreamed.some((c) => !c.includes(":")), "core oracles are validator-run, not streamed per market");
});

test("streams books for the thinnest markets and polls the rest", () => {
  const plan = planSubscriptions(universe, { bookStreams: 4 });
  const volume = (c: string) => Number(universe.ctxs.get(c)!.dayNtlVlm);
  assert.equal(plan.bookStreamed.length, 4);
  const thickestStreamed = Math.max(...plan.bookStreamed.map(volume));
  assert.ok(plan.bookPolled.every((c) => volume(c) >= thickestStreamed));
  assert.deepEqual([...plan.bookStreamed, ...plan.bookPolled].sort(), [...live].sort(), "every live market gets a book exactly once");
});

test("never subscribes to a delisted market, since one bad coin drops the whole connection", () => {
  const plan = planSubscriptions(universe, { bookStreams: 100 });
  const coins = plan.subscriptions.map((s) => s.coin).filter(Boolean);
  assert.ok(delisted.length > 0);
  assert.ok(!coins.some((c) => delisted.includes(c!)));
  assert.ok(!plan.bookPolled.some((c) => delisted.includes(c)));
});

test("adds one all-markets stream, two subscriptions per streamed book and one per trades-only market", () => {
  const plan = planSubscriptions(universe, { bookStreams: 5 });
  assert.equal(plan.subscriptions.filter((s) => s.type === "allDexsAssetCtxs").length, 1);
  assert.equal(plan.subscriptions.length, 1 + plan.ctxStreamed.length + 2 * plan.bookStreamed.length + plan.tradesOnly.length);
});

test("streams trades for polled markets on active DEXs, so the position sample sees who trades them", () => {
  const plan = planSubscriptions(universe, { bookStreams: 4 });
  assert.ok(plan.tradesOnly.length > 0);
  assert.ok(plan.tradesOnly.every((c) => plan.bookPolled.includes(c)));
  const traded = plan.subscriptions.filter((s) => s.type === "trades").map((s) => s.coin!);
  assert.deepEqual(traded.sort(), [...plan.bookStreamed, ...plan.tradesOnly].sort());
  const dormant = universe.markets.filter((m) => isLive(m) && !universe.dexes.find((d) => d.name === m.dex)?.active).map((m) => m.coin);
  assert.ok(!plan.tradesOnly.some((c) => dormant.includes(c)), "dormant DEXs have no trades to stream");
});
