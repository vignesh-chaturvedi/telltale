import assert from "node:assert/strict";
import { beforeEach, afterEach, mock, test } from "node:test";
import { WsPool, subscriptionKey, type WebSocketLike, type WsGap } from "../src/ws.ts";
import type { WsMessage } from "../src/types.ts";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = ""): void {
    this.closedWith = code;
    this.drop(code, reason);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

let clock = 0;
let sockets: FakeSocket[] = [];
let messages: WsMessage[] = [];
let gaps: WsGap[] = [];
let logs: string[] = [];

function makePool(overrides: Partial<ConstructorParameters<typeof WsPool>[0]> = {}): WsPool {
  return new WsPool({
    url: "wss://example",
    onMessage: (msg) => messages.push(msg),
    onGap: (gap) => gaps.push(gap),
    onLog: (level, message) => logs.push(`${level}: ${message}`),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    now: () => clock,
    random: () => 1,
    sendPerSecond: 1000,
    ...overrides,
  });
}

/** Advances both the pool's clock and the mocked timers. */
function advance(ms: number): void {
  clock += ms;
  mock.timers.tick(ms);
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  clock = 1_000_000;
  sockets = [];
  messages = [];
  gaps = [];
  logs = [];
});
afterEach(() => mock.timers.reset());

const sub = (coin: string) => ({ type: "l2Book", coin });
const subscribeMessages = (s: FakeSocket) =>
  s.sent.filter((m) => (m as { method: string }).method === "subscribe").map((m) => (m as { subscription: unknown }).subscription);

test("subscription keys ignore property order", () => {
  assert.equal(subscriptionKey({ type: "l2Book", coin: "BTC" }), subscriptionKey({ coin: "BTC", type: "l2Book" }));
  assert.notEqual(subscriptionKey(sub("BTC")), subscriptionKey(sub("ETH")));
});

test("fills connections up to the per-connection limit and subscribes once open", () => {
  const pool = makePool({ maxSubscriptionsPerConnection: 2 });
  pool.subscribe([sub("A"), sub("B"), sub("C"), sub("D"), sub("E")]);
  assert.equal(sockets.length, 3);
  for (const s of sockets) s.open();
  advance(100);
  assert.deepEqual(sockets.map((s) => subscribeMessages(s).length), [2, 2, 1]);
  assert.equal(pool.stats().subscriptions, 5);
  pool.close();
});

test("ignores duplicate subscriptions and enforces the total budget", () => {
  const pool = makePool({ maxSubscriptions: 3 });
  pool.subscribe([sub("A"), sub("A"), sub("B")]);
  assert.equal(pool.subscriptionCount, 2);
  assert.throws(() => pool.subscribe([sub("C"), sub("D")]), /budget exceeded/);
  pool.close();
});

test("forwards data messages and swallows pongs and acknowledgements", () => {
  const pool = makePool();
  pool.subscribe([sub("A")]);
  const s = sockets[0]!;
  s.open();
  s.receive({ channel: "pong" });
  s.receive({ channel: "subscriptionResponse", data: {} });
  s.receive({ channel: "l2Book", data: { coin: "A" } });
  s.receive({ channel: "error", data: "Invalid subscription" });
  assert.deepEqual(messages, [{ channel: "l2Book", data: { coin: "A" } }]);
  assert.match(logs.join("\n"), /server error: Invalid subscription/);
  pool.close();
});

test("reconnects after a drop, resubscribes, and reports the outage as a gap", () => {
  const pool = makePool();
  pool.subscribe([sub("A"), sub("B")]);
  sockets[0]!.open();
  advance(100);

  sockets[0]!.drop(1006);
  assert.equal(sockets.length, 1);
  // First retry waits 1 s (random() = 1 keeps the full delay).
  advance(1000);
  assert.equal(sockets.length, 2);
  sockets[1]!.open();
  advance(100);

  assert.deepEqual(subscribeMessages(sockets[1]!), [sub("A"), sub("B")]);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], { connection: 0, startedAt: 1_000_100, endedAt: 1_001_100, subscriptions: 2, reason: "closed 1006" });
  assert.equal(pool.stats().reconnects, 1);
  pool.close();
});

test("backs off exponentially while the server stays down", () => {
  const pool = makePool();
  pool.subscribe([sub("A")]);
  sockets[0]!.drop();
  advance(1000);
  sockets[1]!.drop();
  advance(1999);
  assert.equal(sockets.length, 2);
  advance(1);
  assert.equal(sockets.length, 3);
  pool.close();
});

test("pings on an interval and reconnects a connection that goes silent", () => {
  const pool = makePool({ pingIntervalMs: 50_000, staleAfterMs: 90_000 });
  pool.subscribe([sub("A")]);
  const s = sockets[0]!;
  s.open();
  advance(50_000);
  assert.ok(s.sent.some((m) => (m as { method: string }).method === "ping"));
  advance(50_000);
  assert.equal(s.closedWith, 4000);
  pool.close();
});

test("unsubscribes on the connection that holds the subscription", () => {
  const pool = makePool();
  pool.subscribe([sub("A"), sub("B")]);
  sockets[0]!.open();
  advance(100);
  pool.unsubscribe([sub("A")]);
  advance(100);
  assert.equal(pool.subscriptionCount, 1);
  assert.deepEqual(sockets[0]!.sent.at(-1), { method: "unsubscribe", subscription: sub("A") });
  pool.close();
});

test("refuses limits above Hyperliquid's", () => {
  assert.throws(() => makePool({ maxConnections: 11 }), /maxConnections/);
  assert.throws(() => makePool({ maxSubscriptions: 1001 }), /maxSubscriptions/);
});
