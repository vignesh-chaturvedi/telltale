import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPullRates, scoreDatabase, tickerOf } from "../src/scoring.ts";
import { T, bar, seededStore } from "./seed.ts";

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

test("pull rates weigh 14 days of ended walls by USD, and the scorecard discounts walls by them", async () => {
  const store = await seededStore();
  const wall = store.db.prepare("INSERT INTO book_events VALUES (?, ?, ?, 'bid', 100, ?, 1e6, 0, ?)");
  // BTC: 10 pulled walls of $600K and 20 that held of $300K, so half the USD was pulled.
  for (let i = 0; i < 30; i++) wall.run("BTC", T - i * 60_000, i < 10 ? "pulled" : ["filled", "moved", "expired"][i % 3]!, i < 10 ? 600_000 : 300_000, T - i * 60_000);
  wall.run("BTC", T - 15 * 86_400_000, "pulled", 9e6, T - 15 * 86_400_000);
  for (let i = 0; i < 5; i++) wall.run("ETH", T - i * 60_000, "pulled", 300_000, T);
  const rates = loadPullRates(store.db, T + 29 * 60_000);
  assert.deepEqual(rates.get("BTC"), { rate: 0.5, walls: 30 }, "the 15-day-old wall is left out");
  assert.equal(rates.has("ETH"), false, "5 walls aren't enough to measure");

  // BTC trades at 40x, so the 1% band: $200K a side, $100K of the bids in a wall.
  store.writeBars(Array.from({ length: 30 }, (_, i) => bar("BTC", i, { bidWall1: 1e5 })));
  const btc = scoreDatabase(store.db, { windowMinutes: 30, minCoverageMinutes: 20, pullRates: rates }).markets.find((m) => m.coin === "BTC")!.metrics;
  assert.equal(btc.liquidationMoveCostUsd, 2e5);
  assert.equal(btc.adjustedMoveCostUsd, 1.5e5, "half the wall is discounted");
  assert.deepEqual(btc.pullRate, { rate: 0.5, walls: 30 });
  store.close();
});
