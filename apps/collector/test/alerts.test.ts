import assert from "node:assert/strict";
import { test } from "node:test";
import type { Signal } from "@telltale/detectors";
import { AlertEngine, DEFAULT_ENGINE_OPTIONS, MemoryAlertStore, type AlertSink } from "../src/alerts.ts";
import { alertUrl, telegramText } from "../src/notify.ts";
import type { AlertRecord } from "../src/store.ts";

const T = 1_790_000_000_000;
const M = 60_000;

const signal = (i: number, over: Partial<Signal> = {}): Signal => ({
  kind: "mark-divergence",
  coin: "xyz:ABC",
  dex: "xyz",
  severity: "warning",
  at: T + i * M,
  title: "Mark price 3.4% from the oracle",
  detail: "The mark price has been at least 305 bps from the oracle for 3 minutes.",
  evidence: { gapBps: 340 },
  ...over,
});

function setup(publish = true, store = new MemoryAlertStore()) {
  const sent: AlertRecord[] = [];
  const sink: AlertSink = { name: "test", send: async (a) => void sent.push({ ...a }) };
  let now = T;
  const logs: string[] = [];
  const engine = new AlertEngine(store, [sink], { ...DEFAULT_ENGINE_OPTIONS, publish, log: (l) => logs.push(l), now: () => now });
  return { engine, store, sent, logs, tick: (i: number) => (now = T + i * M) };
}
const checked = new Set(["xyz:ABC", "xyz:DEF"]);

test("a condition that holds for several minutes is one alert, closed once it clears", () => {
  const { engine, store, sent, tick } = setup();
  for (let i = 0; i < 5; i++) {
    tick(i);
    engine.onMinute(T + i * M, [signal(i)], checked);
  }
  for (let i = 5; i < 8; i++) engine.onMinute(T + i * M, [], checked);
  assert.equal(store.alerts.length, 1);
  const [a] = store.alerts;
  assert.equal(a!.minutes, 5);
  assert.equal(a!.resolvedAt, T + 7 * M, "closes after three quiet minutes");
  assert.equal(sent.length, 1);
});

test("an alert doesn't close during minutes the market wasn't checked", () => {
  const { engine, store } = setup();
  engine.onMinute(T, [signal(0)], checked);
  for (let i = 1; i < 6; i++) engine.onMinute(T + i * M, [], new Set());
  assert.equal(store.alerts[0]!.resolvedAt, null);
});

test("the cooldown keeps a recurring condition quiet unless it gets worse", () => {
  const { engine, store, sent } = setup();
  engine.onMinute(T, [signal(0)], checked);
  for (let i = 1; i <= 3; i++) engine.onMinute(T + i * M, [], checked);
  engine.onMinute(T + 30 * M, [signal(30)], checked);
  assert.equal(store.alerts.length, 1, "same severity within 12 hours");
  engine.onMinute(T + 31 * M, [signal(31, { severity: "critical" })], checked);
  assert.equal(store.alerts.length, 2, "worse than before");
  engine.onMinute(T + 13 * 60 * M, [signal(13 * 60)], checked);
  assert.equal(store.alerts.length, 2, "the critical alert is still open");
  assert.equal(sent.length, 2);
});

test("an alert that escalated cools down at its new severity", () => {
  const { engine, store } = setup();
  engine.onMinute(T, [signal(0, { severity: "info" })], checked);
  engine.onMinute(T + M, [signal(1, { severity: "warning" })], checked);
  for (let i = 2; i <= 4; i++) engine.onMinute(T + i * M, [], checked);
  engine.onMinute(T + 23 * M, [signal(23, { severity: "warning" })], checked);
  assert.equal(store.alerts.length, 1, "a second warning 23 minutes later stays quiet");
});

test("an open alert that escalates is sent once, at its new severity", () => {
  const { engine, sent, store } = setup();
  engine.onMinute(T, [signal(0, { severity: "info" })], checked);
  assert.equal(sent.length, 0, "information stays on the site");
  engine.onMinute(T + M, [signal(1, { severity: "critical" })], checked);
  engine.onMinute(T + 2 * M, [signal(2, { severity: "critical", title: "Mark price 12% from the oracle" })], checked);
  engine.onMinute(T + 3 * M, [signal(3, { severity: "warning", title: "Mark price 3.1% from the oracle" })], checked);
  assert.deepEqual(sent.map((a) => a.severity), ["critical"]);
  const [a] = store.alerts;
  assert.equal(`${a!.severity}: ${a!.title}`, "critical: Mark price 12% from the oracle", "keeps the text of its worst moment");
  assert.equal(a!.minutes, 4);
});

test("the shadow run records alerts without sending them", () => {
  const { engine, store, sent } = setup(false);
  engine.onMinute(T, [signal(0, { severity: "critical" })], checked);
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0]!.publishedAt, null);
  assert.equal(sent.length, 0);
});

test("events open and close at once, and a burst is held back past the per-minute limit", () => {
  const { engine, store, sent, logs } = setup();
  const coins = ["A", "B", "C", "D", "E"];
  for (const c of coins) engine.onEvent(signal(0, { kind: "pulled-wall", coin: c }));
  assert.equal(store.alerts.length, 5);
  assert.ok(store.alerts.every((a) => a.resolvedAt === T));
  assert.equal(sent.length, 3);
  assert.equal(logs.filter((l) => l.includes("send limit")).length, 2);
  assert.equal(store.alerts.filter((a) => a.publishedAt === null).length, 2, "the rest stay on the site");
});

test("a restart carries on the open alerts and the cooldowns", () => {
  const first = setup();
  first.engine.onMinute(T, [signal(0)], checked);
  first.engine.onEvent(signal(0, { kind: "pulled-wall", coin: "xyz:DEF" }));
  const second = setup(true, first.store);
  second.engine.onMinute(T + M, [signal(1)], checked);
  second.engine.onEvent(signal(2, { kind: "pulled-wall", coin: "xyz:DEF" }));
  assert.equal(first.store.alerts.length, 2);
  assert.equal(first.store.alerts[0]!.minutes, 2);
});

test("Telegram messages escape HTML and link to the market or DEX", () => {
  const a: AlertRecord = { ...signal(0), coin: "xyz:A<B>", id: 1, startedAt: T, updatedAt: T, resolvedAt: null, minutes: 1, publishedAt: null };
  assert.equal(
    telegramText(a),
    "<b>Warning · xyz:A&lt;B&gt;</b>\nMark price 3.4% from the oracle\nThe mark price has been at least 305 bps from the oracle for 3 minutes.\nhttps://telltale.markets/markets/xyz%3AA%3CB%3E",
  );
  assert.equal(alertUrl({ coin: null, dex: "" }), "https://telltale.markets/dexes/core");
});
