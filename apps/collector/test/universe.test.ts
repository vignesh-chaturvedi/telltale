import assert from "node:assert/strict";
import { test } from "node:test";
import type { AllDexsAssetCtxsData, PerpDex, PerpMeta } from "@telltale/hl";
import { decodeAllDexsCtxs, dexConfig, isLive, loadUniverse, marketSetChanged } from "../src/universe.ts";
import { fixtureInfo, wsFixture } from "./fixtures.ts";

test("loads every DEX and market, keeping universe order", async () => {
  const u = await loadUniverse(fixtureInfo(), { withLimits: true, now: () => 42 });
  assert.equal(u.fetchedAt, 42);
  assert.deepEqual(u.dexes.map((d) => d.name), ["", "xyz", "flx", "para"]);
  assert.deepEqual(u.order.get(""), ["BTC", "ETH", "ATOM", "MATIC", "DYDX"]);
  assert.equal(u.markets.length, 21);
  assert.equal(u.ctxs.size, 21);
  const sp500 = u.markets.find((m) => m.coin === "xyz:SP500")!;
  assert.equal(sp500.dex, "xyz");
  assert.equal(sp500.position, 5);
  assert.ok(sp500.oiCapUsd! > 0, "OI cap comes from perpDexLimits");
});

test("marks delisted markets and DEXs without volume", async () => {
  const u = await loadUniverse(fixtureInfo(), { withLimits: true });
  const live = u.markets.filter(isLive).map((m) => m.coin);
  assert.ok(!live.includes("MATIC"));
  assert.ok(!live.includes("para:H100"));
  assert.ok(!live.some((c) => c.startsWith("flx:")), "every flx market is delisted");
  assert.deepEqual(u.dexes.filter((d) => !d.active).map((d) => d.name), ["flx"]);
});

test("reuses the previous OI caps when limits aren't refreshed", async () => {
  const first = await loadUniverse(fixtureInfo(), { withLimits: true });
  const second = await loadUniverse(fixtureInfo(), { withLimits: false, previous: first });
  assert.deepEqual(second.dexes.map((d) => d.limits), first.dexes.map((d) => d.limits));
  const noLimits = await loadUniverse(fixtureInfo(), { withLimits: false });
  assert.ok(noLimits.markets.every((m) => m.oiCapUsd === null));
});

test("config fingerprints ignore the live funding rate but catch deployer changes", async () => {
  const base = await loadUniverse(fixtureInfo(), { withLimits: true });
  const rateMoved = await loadUniverse(
    fixtureInfo((type, _dex, body) => {
      if (type !== "perpDexs") return body;
      return (body as (PerpDex | null)[]).map((d) => d && { ...d, assetToFundingInterestRate: d.assetToFundingInterestRate.map(([c]) => [c, "0.99"]) });
    }),
    { withLimits: true },
  );
  const leverageCut = await loadUniverse(
    fixtureInfo((type, dex, body) => {
      if (type !== "metaAndAssetCtxs" || dex !== "xyz") return body;
      const [meta, ctxs] = body as [PerpMeta, unknown[]];
      return [{ ...meta, universe: meta.universe.map((m) => ({ ...m, maxLeverage: 2 })) }, ctxs];
    }),
    { withLimits: true },
  );
  assert.equal(dexConfig(rateMoved, "para").hash, dexConfig(base, "para").hash);
  assert.notEqual(dexConfig(leverageCut, "xyz").hash, dexConfig(base, "xyz").hash);
  assert.equal(dexConfig(leverageCut, "para").hash, dexConfig(base, "para").hash);
});

test("detects a change in the set of live markets", async () => {
  const base = await loadUniverse(fixtureInfo(), { withLimits: true });
  const same = await loadUniverse(fixtureInfo(), { withLimits: true });
  const delisted = await loadUniverse(
    fixtureInfo((type, dex, body) => {
      if (type !== "metaAndAssetCtxs" || dex !== "") return body;
      const [meta, ctxs] = body as [PerpMeta, unknown[]];
      return [{ ...meta, universe: meta.universe.map((m) => (m.name === "ETH" ? { ...m, isDelisted: true } : m)) }, ctxs];
    }),
    { withLimits: true },
  );
  assert.equal(marketSetChanged(base, same), false);
  assert.equal(marketSetChanged(base, delisted), true);
});

test("decodes allDexsAssetCtxs by universe order", async () => {
  const u = await loadUniverse(fixtureInfo(), { withLimits: false });
  const data = wsFixture("allDexsAssetCtxs")[0]!.data as AllDexsAssetCtxsData;
  const { pairs, mismatched } = decodeAllDexsCtxs(data, u.order);
  assert.deepEqual(mismatched, []);
  assert.equal(pairs.length, 21);
  assert.equal(pairs[0]![0], "BTC");
  assert.ok(pairs.some(([coin]) => coin === "xyz:SP500"));
});

test("flags DEXs whose context count doesn't match", () => {
  const data: AllDexsAssetCtxsData = { ctxs: [["xyz", [{} as never, {} as never]], ["new", [{} as never]]] };
  const { pairs, mismatched } = decodeAllDexsCtxs(data, new Map([["xyz", ["xyz:A"]]]));
  assert.deepEqual(pairs.map(([c]) => c), ["xyz:A"]);
  assert.deepEqual(mismatched, ["xyz", "new"]);
});
