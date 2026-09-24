import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActiveAssetCtxData, L2Book, PerpAssetCtx, Trade } from "@telltale/hl";
import { MINUTE, MinuteAggregator, minuteOf } from "../src/bars.ts";
import { wsFixture } from "./fixtures.ts";

const M0 = minuteOf(1_790_000_000_000);
const T0 = M0 + 40_000; // 40 s into the minute, so +30 s lands in the next one
const ctx = (oraclePx: string, extra: Partial<PerpAssetCtx> = {}): PerpAssetCtx => ({
  ...(wsFixture("activeAssetCtx")[0]!.data as ActiveAssetCtxData).ctx,
  oraclePx,
  ...extra,
});
const only = (bars: ReturnType<MinuteAggregator["flush"]>, coin: string) => bars.find((b) => b.coin === coin)!;

test("counts oracle changes and the longest unchanged stretch", () => {
  const agg = new MinuteAggregator();
  agg.onAssetCtx("xyz:A", ctx("100"), T0, "stream");
  agg.onAssetCtx("xyz:A", ctx("100"), T0 + 1_000, "stream");
  agg.onAssetCtx("xyz:A", ctx("101"), T0 + 3_000, "stream");
  agg.onAssetCtx("xyz:A", ctx("101"), T0 + 4_000, "stream");
  agg.onAssetCtx("xyz:A", ctx("101"), T0 + 7_000, "stream");
  agg.onAssetCtx("xyz:A", ctx("101"), T0 + 10_000, "stream");
  const bar = only(agg.flush(M0 + MINUTE), "xyz:A");
  // The first observation isn't a change: we don't know when that price was set.
  assert.equal(bar.oracleChanges, 1);
  assert.equal(bar.oracleMaxGapMs, 7_000);
  assert.equal(bar.ctxUpdates, 6);
});

test("restarts oracle timing after a silence instead of counting the outage", () => {
  const agg = new MinuteAggregator();
  agg.onAssetCtx("xyz:A", ctx("100"), T0, "stream");
  agg.onAssetCtx("xyz:A", ctx("101"), T0 + 1_000, "stream");
  agg.onAssetCtx("xyz:A", ctx("102"), T0 + 12_000, "stream");
  agg.onAssetCtx("xyz:A", ctx("102"), T0 + 13_000, "stream");
  const bar = only(agg.flush(M0 + MINUTE), "xyz:A");
  assert.equal(bar.oracleChanges, 1);
  assert.equal(bar.oracleMaxGapMs, null, "no gap is measured across the 11 s silence");
});

test("only per-market streams produce oracle timing", () => {
  const agg = new MinuteAggregator();
  agg.onAssetCtx("BTC", ctx("100"), T0, "all");
  agg.onAssetCtx("BTC", ctx("101"), T0 + 14_000, "all");
  const bar = only(agg.flush(M0 + MINUTE), "BTC");
  assert.equal(bar.oracleChanges, null);
  assert.equal(bar.oracleMaxGapMs, null);
  assert.equal(bar.oraclePx, 101);
});

test("keeps the best source's values within a minute", () => {
  const agg = new MinuteAggregator();
  agg.onAssetCtx("xyz:A", ctx("100", { markPx: "1" }), T0, "rest");
  agg.onAssetCtx("xyz:A", ctx("100", { markPx: "2" }), T0 + 1, "stream");
  agg.onAssetCtx("xyz:A", ctx("100", { markPx: "3" }), T0 + 2, "all");
  const bar = only(agg.flush(M0 + MINUTE), "xyz:A");
  assert.equal(bar.ctxSource, "stream");
  assert.equal(bar.markPx, 2);
});

test("buckets by minute and flushes only finished minutes", () => {
  const agg = new MinuteAggregator();
  agg.onAssetCtx("A", ctx("1"), T0, "all");
  agg.onAssetCtx("A", ctx("2"), T0 + 30_000, "all");
  assert.deepEqual(agg.flush(T0 + 30_000).map((b) => b.ts), [M0]);
  assert.deepEqual(agg.flush(T0 + 30_000), []);
  assert.deepEqual(agg.flush(M0 + 2 * MINUTE).map((b) => [b.ts, b.oraclePx]), [[M0 + MINUTE, 2]]);
});

test("summarizes streamed books and tracks the thinnest snapshot", () => {
  const agg = new MinuteAggregator();
  const book = wsFixture("l2Book")[0]!.data as L2Book;
  const thin: L2Book = { ...book, levels: [book.levels[0].slice(0, 1), book.levels[1].slice(0, 1)] };
  agg.onBook(book, T0, "stream");
  agg.onBook(thin, T0 + 5_000, "stream");
  const bar = only(agg.flush(M0 + MINUTE), book.coin);
  assert.equal(bar.bookSource, "stream");
  assert.equal(bar.bookUpdates, 2);
  const thinDepth = Number(thin.levels[0][0]!.px) * Number(thin.levels[0][0]!.sz) + Number(thin.levels[1][0]!.px) * Number(thin.levels[1][0]!.sz);
  assert.ok(Math.abs(bar.minDepth2! - thinDepth) < 1e-6);
  assert.ok(bar.bidDepth2! > 0 && bar.spreadBps! >= 0);
});

test("a polled book never overwrites a streamed one in the same minute", () => {
  const agg = new MinuteAggregator();
  const book = wsFixture("l2Book")[0]!.data as L2Book;
  agg.onBook(book, T0, "stream");
  agg.onBook({ ...book, levels: [[], []] }, T0 + 1, "rest");
  const bar = only(agg.flush(M0 + MINUTE), book.coin);
  assert.equal(bar.bookSource, "stream");
  assert.ok(bar.bestBid !== null);
});

test("splits trade notional by taker side", () => {
  const agg = new MinuteAggregator();
  const trades = wsFixture("trades")[0]!.data as Trade[];
  agg.onTrades(trades, T0);
  const bar = only(agg.flush(M0 + MINUTE), trades[0]!.coin);
  const total = trades.reduce((s, t) => s + Number(t.px) * Number(t.sz), 0);
  assert.equal(bar.trades, trades.length);
  assert.ok(Math.abs(bar.buyNtl + bar.sellNtl - total) < 1e-6);
  assert.equal(bar.maxTradeNtl, Math.max(...trades.map((t) => Number(t.px) * Number(t.sz))));
});
