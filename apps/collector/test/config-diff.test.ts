import assert from "node:assert/strict";
import { test } from "node:test";
import { deployerChangeSignal, diffDexConfig } from "../src/config-diff.ts";

const market = (coin: string, over: Record<string, unknown> = {}) => ({
  coin,
  deployerFeeScale: "1.0",
  growthMode: null,
  isDelisted: false,
  marginMode: "noCross",
  marginTableId: 10,
  maxLeverage: 10,
  oiCapUsd: 25_000_000,
  onlyIsolated: true,
  szDecimals: 2,
  ...over,
});

const dex = (over: Record<string, unknown> = {}) => ({
  fullName: "XYZ",
  deployer: "0x88806a71d74ad0a510b350545c9ae490912f0888",
  oracleUpdater: null,
  feeRecipient: "0x83ffcfb1f2ad843c474b2e28df86c721cb869d3a",
  collateral: "USDC",
  collateralToken: 0,
  limits: { maxTransferNtl: "300000000.0" },
  markets: [market("xyz:AAPL"), market("xyz:KIOXIA", { oiCapUsd: 100_000_000 })],
  raw: {
    subDeployers: [["setOracle", ["0x1234567890545d1df9ee64b35fdd16966e08acec"]]],
    assetToFundingMultiplier: [["xyz:AAPL", "0.5"], ["xyz:KIOXIA", "0.5"]],
  },
  ...over,
});
const texts = (a: object, b: object) => diffDexConfig(JSON.stringify(a), JSON.stringify(b)).map((c) => `${c.severity}: ${c.text}`);

test("identical configs have no changes", () => {
  assert.deepEqual(texts(dex(), dex()), []);
});

test("a new market inserted in the middle is one change, not a shifted list", () => {
  const after = dex({
    markets: [market("xyz:AAPL"), market("xyz:ABNB"), market("xyz:KIOXIA", { oiCapUsd: 100_000_000 })],
    raw: { ...dex().raw, assetToFundingMultiplier: [["xyz:AAPL", "0.5"], ["xyz:ABNB", "0.5"], ["xyz:KIOXIA", "0.5"]] },
  });
  assert.deepEqual(texts(dex(), after), ["info: opened xyz:ABNB for trading (up to 10x)"]);
});

test("market settings changes read as neutral sentences", () => {
  const after = dex({ markets: [market("xyz:AAPL", { maxLeverage: 20 }), market("xyz:KIOXIA", { oiCapUsd: 50_000_000 })] });
  assert.deepEqual(texts(dex(), after), ["warning: xyz:AAPL maximum leverage 10x → 20x", "info: xyz:KIOXIA open-interest cap $100M → $50M"]);
});

test("setting up a market that isn't trading yet isn't reported, and delisting is", () => {
  const registered = dex({ markets: [...dex().markets, market("xyz:TWST", { isDelisted: true, oiCapUsd: null })] });
  assert.deepEqual(texts(dex(), registered), []);
  const prepared = dex({
    markets: [...dex().markets, market("xyz:TWST", { isDelisted: true })],
    raw: { ...dex().raw, assetToFundingMultiplier: [...dex().raw.assetToFundingMultiplier, ["xyz:TWST", "0.5"]] },
  });
  assert.deepEqual(texts(registered, prepared), []);
  const delisted = dex({ markets: [market("xyz:AAPL"), market("xyz:KIOXIA", { oiCapUsd: 100_000_000, isDelisted: true })] });
  assert.deepEqual(texts(dex(), delisted), ["warning: delisted xyz:KIOXIA"]);
});

test("oracle and permission changes are warnings", () => {
  const after = dex({
    oracleUpdater: "0xabcdefabcdefabcdefabcdefabcdefabcdef0001",
    raw: { ...dex().raw, subDeployers: [["setOracle", ["0x9999999999999999999999999999999999999999"]], ["setFundingClamps", ["0xecc1e0731ca1cbd237c0564935637c4c9e899e41"]]] },
  });
  assert.deepEqual(texts(dex(), after), [
    "warning: oracle updater none → 0xabcd…0001",
    "warning: gave 0x9999…9999 permission to setOracle",
    "warning: removed 0x1234…acec's permission to setOracle",
    "info: gave 0xecc1…9e41 permission to setFundingClamps",
  ]);
});

test("one alert per refresh, naming the market when there's only one", () => {
  const one = diffDexConfig(JSON.stringify(dex()), JSON.stringify(dex({ markets: [market("xyz:AAPL"), market("xyz:KIOXIA", { oiCapUsd: 50_000_000 })] })));
  const s = deployerChangeSignal("xyz", "XYZ", one, 1_790_000_000_000)!;
  assert.equal(s.coin, "xyz:KIOXIA");
  assert.equal(s.severity, "info");
  assert.equal(s.title, "XYZ: xyz:KIOXIA open-interest cap $100M → $50M");
  const many = diffDexConfig(JSON.stringify(dex()), JSON.stringify(dex({ oracleUpdater: "0x1", markets: [market("xyz:AAPL", { maxLeverage: 5 }), market("xyz:KIOXIA")] })));
  const m = deployerChangeSignal("xyz", "XYZ", many, 1_790_000_000_000)!;
  assert.equal(m.coin, null);
  assert.equal(m.severity, "warning");
  assert.equal(m.title, "XYZ changed 3 settings");
  assert.equal(deployerChangeSignal("xyz", "XYZ", [], 0), null);
});
