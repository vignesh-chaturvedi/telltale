import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreDatabase, tickerOf } from "../src/scoring.ts";
import { T, seededStore } from "./seed.ts";

test("tickers drop the DEX prefix", () => {
  assert.equal(tickerOf("xyz:AVGO"), "AVGO");
  assert.equal(tickerOf("BTC"), "BTC");
});

test("grades markets with enough data and explains the rest", async () => {
  const store = await seededStore();
  const card = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20 });
  assert.equal(card.to, T + 29 * 60_000);
  assert.equal(card.from, T);
  const btc = card.markets.find((m) => m.coin === "BTC")!;
  assert.ok(btc.grade.grade !== null);
  assert.equal(btc.metrics.coverageMinutes, 30);
  const eth = card.markets.find((m) => m.coin === "ETH")!;
  assert.equal(eth.grade.grade, null, "5 minutes isn't enough");
  const atom = card.markets.find((m) => m.coin === "ATOM")!;
  assert.equal(atom.metrics.coverageMinutes, 0);
  assert.ok(!card.markets.some((m) => m.coin === "MATIC"), "delisted markets aren't graded");
  store.close();
});

test("checks each HIP-3 oracle against other deployers of the same ticker", async () => {
  const store = await seededStore();
  const card = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20 });
  const xyz = card.markets.find((m) => m.coin === "xyz:AVGO")!;
  assert.deepEqual(xyz.metrics.peers, ["para:AVGO"]);
  assert.ok(Math.abs(xyz.metrics.peerGapBps! - 49.75) < 0.01);
  assert.deepEqual(card.markets.find((m) => m.coin === "BTC")!.metrics.peers, [], "core markets have no peers");
  store.close();
});

test("summarizes every DEX, including dormant ones", async () => {
  const store = await seededStore();
  const card = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20 });
  const flx = card.dexes.find((d) => d.dex === "flx")!;
  assert.equal(flx.status, "dormant");
  const core = card.dexes.find((d) => d.dex === "")!;
  assert.equal(core.collateral, "USDC");
  assert.equal(core.graded, 1);
  store.close();
});
