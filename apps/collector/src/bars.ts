import { summarizeBook, toLevels } from "@telltale/detectors";
import type { L2Book, PerpAssetCtx, Trade } from "@telltale/hl";

/**
 * Where a value came from, best first: a per-market stream, the all-markets stream
 * (about every 14 s), or a REST poll.
 */
export type Source = "stream" | "all" | "rest";
const RANK: Record<Source, number> = { rest: 1, all: 2, stream: 3 };

export const MINUTE = 60_000;
export const minuteOf = (t: number): number => t - (t % MINUTE);

/**
 * A per-market stream normally pushes about once a second. A longer silence means we missed
 * data (reconnect, backpressure), so oracle timing restarts rather than counting the outage
 * as staleness.
 */
export const STREAM_CONTINUITY_MS = 5_000;

/** One market's activity during one minute. `null` means no data of that kind arrived. */
export interface MinuteBar {
  coin: string;
  /** Start of the minute, epoch ms. */
  ts: number;
  ctxSource: Source | null;
  ctxUpdates: number;
  oraclePx: number | null;
  markPx: number | null;
  midPx: number | null;
  openInterest: number | null;
  funding: number | null;
  premium: number | null;
  dayNtlVlm: number | null;
  /** Oracle price changes seen on the per-market stream; `null` when the market isn't streamed. */
  oracleChanges: number | null;
  /** Longest time the oracle price stayed unchanged, as observed during this minute. */
  oracleMaxGapMs: number | null;
  bookSource: Source | null;
  bookUpdates: number;
  bestBid: number | null;
  bestAsk: number | null;
  spreadBps: number | null;
  bidDepth1: number | null;
  askDepth1: number | null;
  bidDepth2: number | null;
  askDepth2: number | null;
  bidDepth5: number | null;
  askDepth5: number | null;
  /** Thinnest combined ±2% depth among the minute's snapshots. */
  minDepth2: number | null;
  largestLevelUsd: number | null;
  reachPct: number | null;
  trades: number;
  buyNtl: number;
  sellNtl: number;
  maxTradeNtl: number;
}

function emptyBar(coin: string, ts: number): MinuteBar {
  return {
    coin,
    ts,
    ctxSource: null,
    ctxUpdates: 0,
    oraclePx: null,
    markPx: null,
    midPx: null,
    openInterest: null,
    funding: null,
    premium: null,
    dayNtlVlm: null,
    oracleChanges: null,
    oracleMaxGapMs: null,
    bookSource: null,
    bookUpdates: 0,
    bestBid: null,
    bestAsk: null,
    spreadBps: null,
    bidDepth1: null,
    askDepth1: null,
    bidDepth2: null,
    askDepth2: null,
    bidDepth5: null,
    askDepth5: null,
    minDepth2: null,
    largestLevelUsd: null,
    reachPct: null,
    trades: 0,
    buyNtl: 0,
    sellNtl: 0,
    maxTradeNtl: 0,
  };
}

const num = (s: string | null | undefined): number | null => (s === null || s === undefined ? null : Number(s));

interface OracleTrack {
  px: string;
  lastSeenAt: number;
  /** When the price last changed; `null` until we've seen a change since the stream (re)started. */
  lastChangeAt: number | null;
}

/** Folds stream and REST data into one bar per market per minute. */
export class MinuteAggregator {
  private readonly buckets = new Map<number, Map<string, MinuteBar>>();
  private readonly oracle = new Map<string, OracleTrack>();

  private bar(coin: string, at: number): MinuteBar {
    const ts = minuteOf(at);
    let bucket = this.buckets.get(ts);
    if (!bucket) this.buckets.set(ts, (bucket = new Map()));
    let bar = bucket.get(coin);
    if (!bar) bucket.set(coin, (bar = emptyBar(coin, ts)));
    return bar;
  }

  onAssetCtx(coin: string, ctx: PerpAssetCtx, at: number, source: Source): void {
    const bar = this.bar(coin, at);
    bar.ctxUpdates++;
    if (source === "stream") this.trackOracle(bar, ctx.oraclePx, at);
    if (bar.ctxSource && RANK[bar.ctxSource] > RANK[source]) return;
    bar.ctxSource = source;
    bar.oraclePx = num(ctx.oraclePx);
    bar.markPx = num(ctx.markPx);
    bar.midPx = num(ctx.midPx);
    bar.openInterest = num(ctx.openInterest);
    bar.funding = num(ctx.funding);
    bar.premium = num(ctx.premium);
    bar.dayNtlVlm = num(ctx.dayNtlVlm);
  }

  private trackOracle(bar: MinuteBar, px: string, at: number): void {
    bar.oracleChanges ??= 0;
    const track = this.oracle.get(bar.coin);
    if (!track || at - track.lastSeenAt > STREAM_CONTINUITY_MS) {
      this.oracle.set(bar.coin, { px, lastSeenAt: at, lastChangeAt: null });
      return;
    }
    if (track.lastChangeAt !== null) bar.oracleMaxGapMs = Math.max(bar.oracleMaxGapMs ?? 0, at - track.lastChangeAt);
    if (px !== track.px) {
      bar.oracleChanges++;
      track.px = px;
      track.lastChangeAt = at;
    }
    track.lastSeenAt = at;
  }

  onBook(book: L2Book, at: number, source: Source): void {
    const bar = this.bar(book.coin, at);
    const s = summarizeBook(toLevels(book.levels[0]), toLevels(book.levels[1]));
    bar.bookUpdates++;
    const combined2 = s.bidDepth[2] + s.askDepth[2];
    if (s.mid !== null) bar.minDepth2 = Math.min(bar.minDepth2 ?? Infinity, combined2);
    if (bar.bookSource && RANK[bar.bookSource] > RANK[source]) return;
    bar.bookSource = source;
    bar.bestBid = s.bestBid;
    bar.bestAsk = s.bestAsk;
    bar.spreadBps = s.spreadBps;
    bar.bidDepth1 = s.bidDepth[1];
    bar.askDepth1 = s.askDepth[1];
    bar.bidDepth2 = s.bidDepth[2];
    bar.askDepth2 = s.askDepth[2];
    bar.bidDepth5 = s.bidDepth[5];
    bar.askDepth5 = s.askDepth[5];
    bar.largestLevelUsd = s.largestLevelUsd;
    bar.reachPct = s.reachPct;
  }

  onTrades(trades: readonly Trade[], at: number): void {
    for (const t of trades) {
      const bar = this.bar(t.coin, at);
      const ntl = Number(t.px) * Number(t.sz);
      bar.trades++;
      if (t.side === "B") bar.buyNtl += ntl;
      else bar.sellNtl += ntl;
      bar.maxTradeNtl = Math.max(bar.maxTradeNtl, ntl);
    }
  }

  /** Removes and returns the bars of every minute that started before `before`. */
  flush(before: number): MinuteBar[] {
    const out: MinuteBar[] = [];
    for (const [ts, bucket] of this.buckets) {
      if (ts >= minuteOf(before)) continue;
      out.push(...bucket.values());
      this.buckets.delete(ts);
    }
    return out;
  }
}
