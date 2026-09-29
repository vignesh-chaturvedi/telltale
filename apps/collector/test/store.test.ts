import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Candle, PerpMeta } from "@telltale/hl";
import type { MinuteBar } from "../src/bars.ts";
import { ROLLUP_MS, SCHEMA_V1, SCHEMA_VERSION, Store } from "../src/store.ts";
import { loadUniverse } from "../src/universe.ts";
import { fixtureInfo } from "./fixtures.ts";

const bar: MinuteBar = {
  coin: "xyz:SP500",
  ts: 1_790_000_000_000,
  ctxSource: "stream",
  ctxUpdates: 58,
  oraclePx: 7672.3,
  markPx: 7672.8,
  midPx: 7672.85,
  openInterest: 53494.122,
  funding: 0.0000018507,
  premium: -0.0001368274,
  dayNtlVlm: 310398879.94,
  oracleChanges: 19,
  oracleMaxGapMs: 6100,
  bookSource: "stream",
  bookUpdates: 12,
  bestBid: 7672.8,
  bestAsk: 7672.9,
  spreadBps: 0.13,
  bidDepth1: 1234.56,
  askDepth1: 2345.67,
  bidDepth2: 3456.78,
  askDepth2: 4567.89,
  bidDepth5: null,
  askDepth5: null,
  minDepth2: 7000.4,
  largestLevelUsd: 999.5,
  reachPct: 0.02,
  trades: 3,
  buyNtl: 10.4,
  sellNtl: 0,
  maxTradeNtl: 10.4,
};

test("writes bars with USD amounts rounded to whole dollars", () => {
  const store = new Store(":memory:");
  store.writeBars([bar]);
  const row = store.db.prepare("SELECT * FROM minute_bars").get() as Record<string, unknown>;
  assert.equal(row.coin, "xyz:SP500");
  assert.equal(row.bid_depth_1, 1235);
  assert.equal(row.day_ntl_vlm, 310398880);
  assert.equal(row.bid_depth_5, null);
  assert.equal(row.buy_ntl, 10);
  assert.equal(row.oracle_px, 7672.3, "prices keep full precision");
  assert.equal(row.funding, 0.0000018507);
  store.close();
});

test("rewriting a bar for the same minute replaces it", () => {
  const store = new Store(":memory:");
  store.writeBars([bar]);
  store.writeBars([{ ...bar, trades: 9 }]);
  const rows = store.db.prepare("SELECT trades FROM minute_bars").all() as { trades: number }[];
  assert.deepEqual(rows.map((r) => r.trades), [9]);
  store.close();
});

test("stores a config snapshot only when a DEX's config changes", async () => {
  const store = new Store(":memory:");
  const first = await loadUniverse(fixtureInfo(), { withLimits: true, now: () => 1 });
  assert.deepEqual(store.saveUniverse(first), ["", "xyz", "flx", "para"]);
  const again = await loadUniverse(fixtureInfo(), { withLimits: true, now: () => 2 });
  assert.deepEqual(store.saveUniverse(again), []);
  const edited = await loadUniverse(
    fixtureInfo((type, dex, body) => {
      if (type !== "metaAndAssetCtxs" || dex !== "para") return body;
      const [meta, ctxs] = body as [PerpMeta, unknown[]];
      return [{ ...meta, universe: meta.universe.map((m) => ({ ...m, maxLeverage: m.maxLeverage + 1 })) }, ctxs];
    }),
    { withLimits: true, now: () => 3 },
  );
  assert.deepEqual(store.saveUniverse(edited), ["para"]);
  const counts = store.db.prepare("SELECT dex, count(*) AS n FROM config_snapshots GROUP BY dex ORDER BY dex").all();
  assert.deepEqual(
    counts.map((r) => ({ ...r })),
    [
      { dex: "", n: 1 },
      { dex: "flx", n: 1 },
      { dex: "para", n: 2 },
      { dex: "xyz", n: 1 },
    ],
  );
  const markets = store.db.prepare("SELECT count(*) AS n, sum(is_delisted) AS delisted FROM markets").get();
  assert.deepEqual({ ...markets }, { n: 21, delisted: 7 });
  store.close();
});

test("records gaps and health rows", () => {
  const store = new Store(":memory:");
  store.writeGap({ connection: 2, startedAt: 10, endedAt: 25, subscriptions: 150, reason: "closed 1006" });
  store.writeHealth({ ts: 60_000, wsOpen: 4, wsConnections: 4, subscriptions: 751, wsReceived: 15000, restWeight: 296, bars: 328, barsWithCtx: 328, barsWithBook: 328, dbBytes: 0 });
  assert.deepEqual({ ...(store.db.prepare("SELECT connection, ended_at - started_at AS ms FROM ws_gaps").get() as object) }, { connection: 2, ms: 15 });
  assert.equal((store.db.prepare("SELECT bars FROM health").get() as { bars: number }).bars, 328);
  store.close();
});

test("reopens an existing database without migrating it again", () => {
  const dir = mkdtempSync(join(tmpdir(), "telltale-"));
  try {
    const path = join(dir, "t.db");
    const a = new Store(path);
    a.writeBars([bar]);
    a.close();
    const b = new Store(path);
    assert.equal((b.db.prepare("SELECT count(*) AS n FROM minute_bars").get() as { n: number }).n, 1);
    assert.equal((b.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrades a Phase 1 (v1) database in place", () => {
  const dir = mkdtempSync(join(tmpdir(), "telltale-"));
  try {
    const path = join(dir, "v1.db");
    const old = new DatabaseSync(path);
    old.exec(SCHEMA_V1);
    old.exec("PRAGMA user_version = 1");
    old.prepare("INSERT INTO dexes VALUES ('xyz', 'XYZ', null, null, null, 0, 1, 1)").run();
    old.close();

    const store = new Store(path);
    assert.equal((store.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
    assert.deepEqual({ ...(store.db.prepare("SELECT name, collateral FROM dexes").get() as object) }, { name: "xyz", collateral: null });
    store.writeCandles("xyz:A", [{ t: 86_400_000, T: 172_799_999, s: "xyz:A", i: "1d", o: "1", h: "2", l: "0.5", c: "1.5", v: "10", n: 3 } satisfies Candle]);
    assert.equal((store.db.prepare("SELECT high FROM daily_candles").get() as { high: number }).high, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("names each DEX's collateral token", async () => {
  const store = new Store(":memory:");
  const u = await loadUniverse(fixtureInfo(), { withLimits: true, tokenNames: new Map([[0, "USDC"], [360, "USDH"]]) });
  store.saveUniverse(u);
  const rows = store.db.prepare("SELECT name, collateral FROM dexes ORDER BY name").all();
  assert.equal((rows.find((r) => r.name === "xyz") as { collateral: string }).collateral, "USDC");
  store.close();
});

test("rolls minute bars past the cutoff into 15-minute bars", () => {
  const store = new Store(":memory:");
  const t0 = Math.floor(1_790_000_000_000 / ROLLUP_MS) * ROLLUP_MS;
  const bars = Array.from({ length: 20 }, (_, i) => ({
    ...bar,
    ts: t0 + i * 60_000,
    oraclePx: 100,
    midPx: 100 + i,
    trades: 1,
    buyNtl: 10,
    bidDepth2: 1000 + i * 10,
    minDepth2: 500 - i,
  }));
  store.writeBars(bars);
  store.writeHealth({ ts: t0, wsOpen: 4, wsConnections: 4, subscriptions: 752, wsReceived: 1, restWeight: 1, bars: 1, barsWithCtx: 1, barsWithBook: 1, dbBytes: 1 });

  // 17 minutes in: only the first full quarter hour is rolled up, never part of one.
  assert.deepEqual(store.rollUp(t0 + 17 * 60_000), { minuteBars: 15, rolledBars: 1 });
  const row = store.db.prepare("SELECT * FROM bars_15m").get() as Record<string, number>;
  assert.equal(row.ts, t0);
  assert.equal(row.minutes, 15);
  assert.equal(row.mid_px, 114, "prices are the last minute's");
  assert.equal(row.mid_high, 114);
  assert.equal(row.mid_low, 100);
  assert.equal(row.oracle_gap_max_bps, 1400);
  assert.equal(row.bid_depth_2, 1070, "depth is the average");
  assert.equal(row.min_depth_2, 486, "and the thinnest book is kept");
  assert.equal(row.trades, 15);
  assert.equal(row.buy_ntl, 150);
  const left = store.db.prepare("SELECT count(*) AS n, min(ts) AS first FROM minute_bars").get() as { n: number; first: number };
  assert.deepEqual({ ...left }, { n: 5, first: t0 + 15 * 60_000 });
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM health").get() as { n: number }).n, 0);

  assert.deepEqual(store.rollUp(t0 + 17 * 60_000), { minuteBars: 0, rolledBars: 0 }, "running again changes nothing");
  store.close();
});
