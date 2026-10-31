import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ClearinghouseState } from "@telltale/hl";
import { Api, type ApiOptions } from "../src/api.ts";
import type { MarketDetail, WalletView } from "../src/api-types.ts";
import { toSnapshot } from "../src/positions.ts";
import { Store } from "../src/store.ts";
import { T, seededStore } from "./seed.ts";

const HOUR = 3_600_000;
const now = T + 31 * 60_000;
const ME = "0x00000000000000000000000000000000000000ee";
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";

const position = (coin: string, szi: number, value: number, liq: number | null) => ({
  type: "oneWay",
  position: {
    coin, szi: String(szi), entryPx: "95", positionValue: String(value), unrealizedPnl: "10", returnOnEquity: "0",
    liquidationPx: liq === null ? null : String(liq), marginUsed: "1", maxLeverage: 20,
    leverage: { type: "cross" as const, value: 10 }, cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
  },
});
const state = (accountValue: number, positions: ReturnType<typeof position>[]): ClearinghouseState => ({
  marginSummary: { accountValue: String(accountValue), totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" },
  crossMarginSummary: { accountValue: String(accountValue), totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" },
  crossMaintenanceMarginUsed: "0",
  withdrawable: "0",
  assetPositions: positions,
  time: now,
});

let dir: string;
const servers: Server[] = [];
const asked: string[] = [];
let failNext = false;

async function serve(options: Partial<ApiOptions>): Promise<string> {
  const api = new Api({ dbPath: join(dir, "t.db"), windowMinutes: 30, webRoot: null, now: () => now, ...options });
  api.refresh();
  const server = createServer(api.handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.on("close", () => api.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let base: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "telltale-positions-"));
  const store = await seededStore(join(dir, "t.db"));
  const trade = (address: string, coin: string) => ({ address, coin, dex: "", lastSeen: now - HOUR, trades: 1, tradedUsd: 1000 });
  store.writeTraders([trade(A, "BTC"), trade(B, "BTC"), trade(C, "BTC")]);
  // BTC's mark is 100 and its open interest $1M (10,000 contracts).
  store.writeSnapshot(toSnapshot(A, "", state(1e5, [position("BTC", 3000, 3e5, 98.5)]), now - HOUR));
  store.writeSnapshot(toSnapshot(B, "", state(1e5, [position("BTC", -2000, 2e5, 103)]), now - HOUR));
  store.writeSnapshot(toSnapshot(C, "", state(1e5, [position("BTC", 1000, 1e5, 99.5)]), now - 7 * HOUR));
  store.close();
  base = await serve({
    info: {
      clearinghouseState: async (user, dex = "") => {
        asked.push(`${dex} ${user}`);
        if (failNext) {
          failNext = false;
          throw new Error("HTTP 500");
        }
        if (dex === "") return state(5000, [position("BTC", 2, 200, 97)]);
        if (dex === "xyz") return state(800, [position("xyz:AVGO", -1, 100, 110), position("xyz:NOTLISTED", 1, 50, null)]);
        return state(0, []);
      },
    },
  });
});

after(() => {
  for (const s of servers) s.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async <T>(b: string, path: string) => {
  const res = await fetch(b + path);
  return { status: res.status, body: (await res.json()) as T };
};

test("a market's detail maps the positions read in the last 6 hours", async () => {
  const { body } = await get<MarketDetail>(base, "/api/markets/BTC");
  const p = body.positions!;
  assert.equal(p.freshHours, 6);
  assert.equal(p.traders24h, 3);
  assert.equal(p.accounts, 2, "C was read 7 hours ago");
  assert.equal(p.coverage, 0.25, "$500K of $2M (longs plus shorts)");
  assert.deepEqual([p.ladder[1]!.longUsd, p.ladder[3]!.shortUsd], [3e5, 2e5]);
  assert.deepEqual(p.worstPush.long, { side: "long", pct: 2, costUsd: 5e5, liquidatedUsd: 3e5, ratio: 0.6 });
  assert.equal(body.metrics.markPx, 100);
  assert.deepEqual(body.metrics.sideDepthUsd.bid, { 1: 2e5, 2: 5e5, 5: 1e6 });

  const empty = (await get<MarketDetail>(base, `/api/markets/${encodeURIComponent("xyz:AVGO")}`)).body.positions!;
  assert.deepEqual([empty.accounts, empty.coverage, empty.traders24h], [0, 0, 0]);
});

test("a wallet's positions are read live and set against their markets", async () => {
  const { status, body } = await get<WalletView>(base, `/api/wallets/${ME.toUpperCase().replace("0X", "0x")}`);
  assert.equal(status, 200);
  assert.equal(body.address, ME);
  assert.deepEqual(body.dexes.map((d) => [d.slug, d.accountUsd, d.positionUsd]), [["core", 5000, 200], ["xyz", 800, 150]]);
  const [btc, avgo, unlisted] = body.positions;
  assert.equal(btc!.coin, "BTC");
  assert.equal(btc!.side, "long");
  assert.equal(btc!.markPx, 100);
  assert.equal(btc!.distancePct, 3);
  assert.ok(btc!.graded && btc!.grade !== null);
  assert.ok(Math.abs(btc!.pushCostUsd! - (5e5 + 5e5 / 3)) < 1e-6, "bids between 2% and 5% are interpolated");
  assert.equal(btc!.liquidatedFirstUsd, 3e5, "A's long liquidates at 1.5%; C's read is stale");
  assert.equal(avgo!.side, "short");
  assert.equal(avgo!.pushCostUsd, null, "10% is past the measured book");
  assert.deepEqual([unlisted!.graded, unlisted!.grade, unlisted!.distancePct], [false, null, null]);

  const before = asked.length;
  await get(base, `/api/wallets/${ME}`);
  assert.equal(asked.length, before, "a repeat visit within 30 s is served from memory");
});

test("bad addresses are refused, a failed read is a 502 that isn't cached, and lookups can be off", async () => {
  assert.equal((await get(base, "/api/wallets/0x123")).status, 400);
  failNext = true;
  const other = "0x00000000000000000000000000000000000000dd";
  const failed = await get<{ error: string }>(base, `/api/wallets/${other}`);
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /HTTP 500/);
  assert.equal((await get(base, `/api/wallets/${other}`)).status, 200, "tried again");
  const off = await serve({});
  assert.equal((await get(off, `/api/wallets/${ME}`)).status, 503);
});
