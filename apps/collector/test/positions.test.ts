import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClearinghouseState, Trade } from "@telltale/hl";
import { EMPTY_REPOLL_MS, FAILED_REPOLL_MS, MIN_REPOLL_MS, PositionPoller, TRADE_REPOLL_MS, toSnapshot } from "../src/positions.ts";
import { Store } from "../src/store.ts";
import { TraderTally, dexOfCoin } from "../src/traders.ts";

const T = 1_790_000_000_000;
const MIN = 60_000;
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";

const trade = (coin: string, px: number, sz: number, users: [string, string], time = T): Trade =>
  ({ coin, side: "B", px: String(px), sz: String(sz), time, hash: "0x", tid: 1, users }) as Trade;

const position = (coin: string, szi: number, value: number, liq: number | null, type: "cross" | "isolated" = "cross") => ({
  type: "oneWay",
  position: {
    coin, szi: String(szi), entryPx: "100", positionValue: String(value), unrealizedPnl: "0", returnOnEquity: "0",
    liquidationPx: liq === null ? null : String(liq), marginUsed: String(value / 10), maxLeverage: 20,
    leverage: { type, value: 10 }, cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
  },
});

const state = (accountValue: number, positions: ReturnType<typeof position>[]): ClearinghouseState => ({
  marginSummary: { accountValue: String(accountValue), totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" },
  crossMarginSummary: { accountValue: String(accountValue), totalNtlPos: "0", totalRawUsd: "0", totalMarginUsed: "0" },
  crossMaintenanceMarginUsed: "0",
  withdrawable: "0",
  assetPositions: positions,
  time: T,
});

const rows = (store: Store, sql: string, ...args: (string | number)[]) => store.db.prepare(sql).all(...args).map((r) => ({ ...r }));

test("the tally counts both sides of every trade, by market, with lowercase addresses", () => {
  const tally = new TraderTally();
  tally.onTrades([trade("xyz:SP500", 100, 2, [A.toUpperCase().replace("0X", "0x"), B]), trade("xyz:SP500", 101, 1, [B, A], T + 5_000), trade("BTC", 50_000, 0.1, [A, C])]);
  const out = tally.take().sort((x, y) => (x.coin + x.address < y.coin + y.address ? -1 : 1));
  assert.deepEqual(
    out.map((a) => [a.coin, a.dex, a.address, a.trades, a.tradedUsd, a.lastSeen]),
    [
      ["BTC", "", A, 1, 5000, T],
      ["BTC", "", C, 1, 5000, T],
      ["xyz:SP500", "xyz", A, 2, 301, T + 5_000],
      ["xyz:SP500", "xyz", B, 2, 301, T + 5_000],
    ],
  );
  assert.deepEqual(tally.take(), [], "taking starts over");
  assert.equal(dexOfCoin("para:AVGO"), "para");
  assert.equal(dexOfCoin("HYPE"), "");
});

test("a new account is due at once; a trade brings a read forward, but not within 10 minutes of the last", () => {
  const store = new Store(":memory:");
  const tally = new TraderTally();
  tally.onTrades([trade("xyz:SP500", 100, 10, [A, B]), trade("xyz:TSLA", 400, 1, [A, C])]);
  store.writeTraders(tally.take());
  assert.deepEqual(rows(store, "SELECT address, dex, traded_since_poll AS usd, next_poll FROM accounts ORDER BY address"), [
    { address: A, dex: "xyz", usd: 1400, next_poll: T },
    { address: B, dex: "xyz", usd: 1000, next_poll: T },
    { address: C, dex: "xyz", usd: 400, next_poll: T },
  ]);
  assert.deepEqual(store.dueAccounts(T, 2), [{ address: A, dex: "xyz" }, { address: B, dex: "xyz" }], "most USD first");

  store.writeSnapshot(toSnapshot(A, "xyz", state(500, []), T));
  const nextPoll = () => (store.db.prepare("SELECT next_poll AS t FROM accounts WHERE address = ?").get(A) as { t: number }).t;
  assert.equal(nextPoll(), T + EMPTY_REPOLL_MS, "holding nothing, it's checked daily");
  tally.onTrades([trade("xyz:SP500", 100, 1, [A, B], T + 2 * MIN)]);
  store.writeTraders(tally.take());
  assert.equal(nextPoll(), T + MIN_REPOLL_MS, "not sooner than 10 minutes after the read");
  tally.onTrades([trade("xyz:SP500", 100, 1, [A, B], T + 60 * MIN)]);
  store.writeTraders(tally.take());
  assert.equal(nextPoll(), T + MIN_REPOLL_MS, "an earlier due time stands");
  store.writeSnapshot(toSnapshot(A, "xyz", state(500, []), T + 30 * MIN));
  tally.onTrades([trade("xyz:SP500", 100, 1, [A, B], T + 60 * MIN)]);
  store.writeTraders(tally.take());
  assert.equal(nextPoll(), T + 60 * MIN + TRADE_REPOLL_MS, "a minute after the trade");
  assert.deepEqual(rows(store, "SELECT trades, traded_usd FROM traders WHERE coin = 'xyz:SP500' AND address = ?", A), [{ trades: 4, traded_usd: 1300 }]);
  store.close();
});

test("a snapshot keeps open positions, reads null liquidation prices, and sets the next read by size", () => {
  const s = toSnapshot(A, "xyz", state(2e5, [
    position("xyz:SP500", 10, 1.5e6, 90),
    position("xyz:TSLA", -2, 800, 600, "isolated"),
    position("xyz:GOLD", 0, 0, null),
    position("xyz:NVDA", 1, 100, -50),
  ]), T);
  assert.deepEqual(s.positions.map((p) => [p.coin, p.size, p.positionUsd, p.liquidationPx, p.cross]), [
    ["xyz:SP500", 10, 1.5e6, 90, true],
    ["xyz:TSLA", -2, 800, 600, false],
    ["xyz:NVDA", 1, 100, null, true],
  ]);
  assert.equal(s.positionUsd, 1_500_900);
  assert.equal(s.accountUsd, 2e5);
  assert.equal(s.nextPoll, T + 10 * MIN, "$1M+ is read every 10 minutes");
  assert.equal(toSnapshot(A, "nope", null, T).positions.length, 0, "an unknown DEX holds nothing");
});

test("the poller reads due accounts biggest first, replaces their positions, and backs off failures", async () => {
  const store = new Store(":memory:");
  const tally = new TraderTally();
  tally.onTrades([trade("xyz:SP500", 100, 100, [A, B]), trade("BTC", 100, 1, [C, A])]);
  store.writeTraders(tally.take());
  const answers = new Map<string, ClearinghouseState | Error>([
    [`xyz ${A}`, state(1e5, [position("xyz:SP500", 50, 5000, 80), position("xyz:TSLA", -1, 400, 500)])],
    [`xyz ${B}`, new Error("info clearinghouseState: HTTP 500")],
    [` ${C}`, state(10, [])],
    [` ${A}`, state(10, [position("BTC", 1, 100, 50)])],
  ]);
  const asked: string[] = [];
  const slept: number[] = [];
  let now = T;
  const logs: string[] = [];
  const poller = new PositionPoller({
    info: {
      clearinghouseState: async (user: string, dex = "") => {
        asked.push(`${dex} ${user}`);
        const a = answers.get(`${dex} ${user}`)!;
        if (a instanceof Error) throw a;
        return a;
      },
    },
    store,
    perMinute: 60,
    log: (l) => logs.push(l),
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  });
  assert.equal(await poller.pollDue(), 3);
  assert.deepEqual(asked, [`xyz ${A}`, `xyz ${B}`, ` ${A}`, ` ${C}`], "by USD traded, then due time");
  assert.deepEqual(slept, [1000, 1000, 1000, 1000], "spaced evenly over the minute");
  assert.equal(logs.length, 1);
  assert.deepEqual(rows(store, "SELECT coin, address, size, position_usd, liquidation_px FROM positions ORDER BY coin"), [
    { coin: "BTC", address: A, size: 1, position_usd: 100, liquidation_px: 50 },
    { coin: "xyz:SP500", address: A, size: 50, position_usd: 5000, liquidation_px: 80 },
    { coin: "xyz:TSLA", address: A, size: -1, position_usd: 400, liquidation_px: 500 },
  ]);
  assert.deepEqual(rows(store, "SELECT next_poll - ? AS wait FROM accounts WHERE address = ? AND dex = 'xyz'", T, B), [{ wait: FAILED_REPOLL_MS + 1000 }]);

  answers.set(`xyz ${A}`, state(1e5, [position("xyz:SP500", 20, 2000, 70)]));
  now += 3 * 60 * MIN;
  assert.equal(await poller.pollDue(), 2, "A on xyz and core are due again after 2 hours; B after its back-off");
  assert.deepEqual(rows(store, "SELECT coin, size FROM positions WHERE dex = 'xyz'"), [{ coin: "xyz:SP500", size: 20 }], "the closed TSLA short is gone");
  store.close();
});

test("retention drops idle traders and empty accounts, keeps accounts with positions, and drops stale positions", () => {
  const store = new Store(":memory:");
  const tally = new TraderTally();
  tally.onTrades([trade("xyz:SP500", 100, 1, [A, B]), trade("BTC", 100, 1, [C, A], T + 20 * 86_400_000)]);
  store.writeTraders(tally.take());
  store.writeSnapshot(toSnapshot(A, "xyz", state(1e5, [position("xyz:SP500", 1, 100, 50)]), T));
  store.writeSnapshot(toSnapshot(B, "xyz", state(0, []), T));
  const now = T + 31 * 86_400_000;
  assert.deepEqual(store.prunePositions(now), { traders: 2, accounts: 1, positions: 1 });
  assert.deepEqual(rows(store, "SELECT address, dex FROM accounts ORDER BY address, dex"), [
    { address: A, dex: "" },
    { address: A, dex: "xyz" },
    { address: C, dex: "" },
  ], "B held nothing and stopped trading; A still held SP500 at its last read");
  store.close();
});
