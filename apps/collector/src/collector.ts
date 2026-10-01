import {
  InfoClient,
  TokenBucket,
  WsPool,
  subscriptionKey,
  type ActiveAssetCtxData,
  type AllDexsAssetCtxsData,
  type L2Book,
  type Network,
  type Trade,
  type WsMessage,
} from "@telltale/hl";
import { ALERT_HISTORY_MINUTES } from "@telltale/detectors";
import type { AlertSink } from "./alerts.ts";
import { MINUTE, MinuteAggregator, minuteOf, type MinuteBar } from "./bars.ts";
import { BOOK_SIG_FIGS, planSubscriptions, type SubscriptionPlan } from "./plan.ts";
import { Store } from "./store.ts";
import { decodeAllDexsCtxs, isLive, loadUniverse, marketSetChanged, type Universe } from "./universe.ts";
import { Watch } from "./watch.ts";

export interface CollectorOptions {
  network: Network;
  dbPath: string;
  /** Markets with streamed books and trades (two subscriptions each). */
  bookStreams: number;
  /** REST weight budget per minute; Hyperliquid allows 1,200 per IP. */
  restWeightPerMinute: number;
  /** Refresh DEXs, markets and contexts this often. */
  universeEveryMs: number;
  /** Refresh OI caps on every Nth universe refresh. */
  limitsEvery: number;
  /** Days of minute bars to keep; older ones are rolled into 15-minute bars. */
  keepMinuteDays: number;
  /** Where warnings and critical alerts go, when `publishAlerts` is on. */
  sinks: readonly AlertSink[];
  /** Off for the shadow run: alerts are recorded but not sent. */
  publishAlerts: boolean;
  log: (line: string) => void;
}

const POLL_CYCLE_MS = 30_000;
/** Daily candles feed the 30-day checks; one request every 3 s keeps them within the REST budget. */
const CANDLE_DAYS = 31;
const CANDLE_SPACING_MS = 3_000;
const CANDLES_EVERY_MS = 6 * 60 * 60_000;
const RETENTION_EVERY_MS = 60 * 60_000;

export const DEFAULTS = {
  bookStreams: 300,
  restWeightPerMinute: 1000,
  universeEveryMs: 60_000,
  limitsEvery: 5,
  keepMinuteDays: 14,
  sinks: [],
  publishAlerts: false,
} satisfies Partial<CollectorOptions>;

/** Streams every live Hyperliquid market into minute bars in SQLite. */
export class Collector {
  private readonly options: CollectorOptions;
  private readonly info: InfoClient;
  private readonly limiter: TokenBucket;
  private readonly agg = new MinuteAggregator();
  private readonly store: Store;
  private readonly watch: Watch;
  private pool: WsPool | null = null;
  private universe: Universe | null = null;
  private plan: SubscriptionPlan | null = null;
  private dexOf = new Map<string, string[]>();
  private live = new Set<string>();
  private tokenNames = new Map<number, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private refreshes = 0;
  private pollIndex = 0;
  private stopped = false;
  private lastStats = { received: 0, restWeight: 0 };

  constructor(options: CollectorOptions) {
    this.options = options;
    this.limiter = new TokenBucket({ perMinute: options.restWeightPerMinute });
    this.info = new InfoClient({ url: options.network.api, limiter: this.limiter });
    this.store = new Store(options.dbPath);
    this.watch = new Watch({ alerts: this.store, sinks: options.sinks, publish: options.publishAlerts, log: options.log });
  }

  async start(): Promise<void> {
    const { log, network } = this.options;
    const spot = await this.info.spotMeta();
    this.tokenNames = new Map(spot.tokens.map((t) => [t.index, t.name]));
    this.universe = await loadUniverse(this.info, { withLimits: true, tokenNames: this.tokenNames });
    this.store.saveUniverse(this.universe);
    this.dexOf = this.universe.order;
    this.live = new Set(this.universe.markets.filter(isLive).map((m) => m.coin));
    this.plan = planSubscriptions(this.universe, { bookStreams: this.options.bookStreams });
    this.watchMarkets(this.universe);
    // Detectors look back up to 45 minutes; start from what's stored rather than from nothing.
    this.watch.addBars(this.store.recentBars(ALERT_HISTORY_MINUTES));

    this.pool = new WsPool({
      url: network.ws,
      onMessage: (msg) => this.route(msg),
      onGap: (gap) => this.store.writeGap(gap),
      onLog: (level, message) => log(`${level === "info" ? "" : `${level}: `}${message}`),
    });
    this.pool.subscribe(this.plan.subscriptions);

    const live = this.universe.markets.filter(isLive).length;
    log(
      `${network.name}: ${this.universe.dexes.length} DEXs, ${live} live markets. ` +
        `Streaming contexts for ${this.plan.ctxStreamed.length}, books for ${this.plan.bookStreamed.length}; ` +
        `polling ${this.plan.bookPolled.length} books. ${this.plan.subscriptions.length} subscriptions. ` +
        `Alerts ${this.options.publishAlerts ? `sent to ${this.options.sinks.map((s) => s.name).join(" and ") || "no channel"}` : "recorded only (shadow run)"}.`,
    );

    this.every("universe", this.options.universeEveryMs, () => this.refreshUniverse());
    this.every("candles", CANDLES_EVERY_MS, () => this.refreshCandles(), 10_000);
    this.every("retention", RETENTION_EVERY_MS, async () => this.applyRetention(), 5 * 60_000);
    void this.pollNextBook();
    this.scheduleFlush();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.pool?.close();
    this.flush(minuteOf(Date.now()));
    this.store.close();
  }

  private route(msg: WsMessage): void {
    const at = Date.now();
    switch (msg.channel) {
      case "activeAssetCtx": {
        const { coin, ctx } = msg.data as ActiveAssetCtxData;
        this.agg.onAssetCtx(coin, ctx, at, "stream");
        break;
      }
      case "allDexsAssetCtxs": {
        const { pairs, mismatched } = decodeAllDexsCtxs(msg.data as AllDexsAssetCtxsData, this.dexOf);
        for (const [coin, ctx] of pairs) if (this.live.has(coin)) this.agg.onAssetCtx(coin, ctx, at, "all");
        // A new or removed market shows up here before the next universe refresh picks it up.
        if (mismatched.length) this.options.log(`warn: context counts differ from known markets for ${mismatched.map((d) => d || "core").join(", ")}`);
        break;
      }
      case "l2Book":
        this.agg.onBook(msg.data as L2Book, at, "stream");
        this.watch.onBook(msg.data as L2Book, at);
        break;
      case "trades":
        this.agg.onTrades(msg.data as Trade[], at);
        this.watch.onTrades(msg.data as Trade[]);
        break;
    }
  }

  private async refreshUniverse(): Promise<void> {
    const previous = this.universe!;
    this.refreshes++;
    const next = await loadUniverse(this.info, {
      withLimits: this.refreshes % this.options.limitsEvery === 0,
      previous,
      tokenNames: this.tokenNames,
    });
    const at = Date.now();
    this.dexOf = next.order;
    this.live = new Set(next.markets.filter(isLive).map((m) => m.coin));
    for (const [coin, ctx] of next.ctxs) if (this.live.has(coin)) this.agg.onAssetCtx(coin, ctx, at, "rest");
    const changed = this.store.saveUniverse(next);
    if (changed.length) this.options.log(`config changed: ${changed.map((c) => c.dex || "core").join(", ")}`);
    this.watch.onConfigUpdates(changed, at);
    this.universe = next;
    this.watchMarkets(next);

    if (marketSetChanged(previous, next)) {
      const plan = planSubscriptions(next, { bookStreams: this.options.bookStreams });
      const keep = new Set(plan.subscriptions.map(subscriptionKey));
      const removed = this.plan!.subscriptions.filter((s) => !keep.has(subscriptionKey(s)));
      this.pool!.unsubscribe(removed);
      this.pool!.subscribe(plan.subscriptions);
      this.plan = plan;
      this.options.log(`market set changed: now ${plan.subscriptions.length} subscriptions (${removed.length} removed)`);
    }
  }

  /**
   * Polls one unstreamed book at a time. Each book is visited every 30 s: a once-a-minute cycle
   * drifts past minute boundaries and leaves some minutes without a snapshot.
   */
  private async pollNextBook(): Promise<void> {
    const coins = this.plan!.bookPolled;
    const started = Date.now();
    if (coins.length > 0) {
      const coin = coins[this.pollIndex++ % coins.length]!;
      try {
        const book = await this.info.l2Book(coin, BOOK_SIG_FIGS);
        if (book?.levels) {
          this.agg.onBook(book, Date.now(), "rest");
          this.watch.onBook(book, Date.now());
        }
      } catch (err) {
        this.options.log(`warn: l2Book ${coin}: ${(err as Error).message}`);
      }
    }
    const spacing = POLL_CYCLE_MS / Math.max(1, coins.length);
    const wait = Math.max(0, spacing - (Date.now() - started));
    if (!this.stopped) this.timers.set("poll", setTimeout(() => void this.pollNextBook(), wait));
  }

  private scheduleFlush(): void {
    const now = Date.now();
    // Flush 2 s after each minute ends, so late messages for that minute are still counted.
    const next = minuteOf(now) + MINUTE + 2_000;
    this.timers.set(
      "flush",
      setTimeout(() => {
        this.flush(minuteOf(Date.now()));
        if (!this.stopped) this.scheduleFlush();
      }, next - now),
    );
  }

  private flush(before: number): void {
    const bars = this.agg.flush(before);
    if (bars.length === 0) return;
    this.store.writeBars(bars);
    this.checkAlerts(bars);
    const stats = this.pool!.stats();
    const received = stats.received - this.lastStats.received;
    const restWeight = this.limiter.taken - this.lastStats.restWeight;
    this.lastStats = { received: stats.received, restWeight: this.limiter.taken };
    const ts = bars[0]!.ts;
    const health = {
      ts,
      wsOpen: stats.open,
      wsConnections: stats.connections,
      subscriptions: stats.subscriptions,
      wsReceived: received,
      restWeight,
      bars: bars.length,
      barsWithCtx: bars.filter((b) => b.ctxSource !== null).length,
      barsWithBook: bars.filter((b) => b.bookSource !== null).length,
      dbBytes: this.store.sizeBytes(),
    };
    this.store.writeHealth(health);
    const live = this.universe!.markets.filter(isLive).length;
    this.options.log(
      `${new Date(ts).toISOString().slice(11, 16)} bars ${bars.length}/${live} ctx ${health.barsWithCtx} book ${health.barsWithBook}` +
        ` | ws ${stats.open}/${stats.connections} subs ${stats.subscriptions} msgs ${received} | rest ${restWeight}/min` +
        ` | db ${(health.dbBytes / 1e6).toFixed(1)} MB`,
    );
  }

  private watchMarkets(universe: Universe): void {
    this.watch.setMarkets(universe.markets.filter(isLive).map(({ coin, dex, oiCapUsd }) => ({ coin, dex, oiCapUsd })));
  }

  /** Runs the minute detectors on the bars just written, a minute at a time, and stores wall events. */
  private checkAlerts(bars: readonly MinuteBar[]): void {
    try {
      for (const ts of [...new Set(bars.map((b) => b.ts))].sort((a, b) => a - b)) {
        this.watch.addBars(bars.filter((b) => b.ts === ts));
        this.watch.checkMinute(ts);
      }
      this.store.writeBookEvents(this.watch.takeBookEvents());
    } catch (err) {
      // Alerts must never stop data collection.
      this.options.log(`error: alerts: ${(err as Error).stack ?? (err as Error).message}`);
    }
  }

  /** Keeps disk use flat: minute bars past the retention window become 15-minute bars. */
  private applyRetention(): void {
    const { keepMinuteDays, log } = this.options;
    const { minuteBars, rolledBars } = this.store.rollUp(Date.now() - keepMinuteDays * 86_400_000);
    if (minuteBars) log(`retention: rolled ${minuteBars} minute bars older than ${keepMinuteDays} days into ${rolledBars} 15-minute bars`);
  }

  /** Fetches 31 daily candles for every live market, one market at a time. */
  private async refreshCandles(): Promise<void> {
    const coins = [...this.live];
    let failed = 0;
    for (const coin of coins) {
      if (this.stopped) return;
      const now = Date.now();
      try {
        this.store.writeCandles(coin, await this.info.candleSnapshot(coin, "1d", now - CANDLE_DAYS * 86_400_000, now));
      } catch (err) {
        failed++;
        if (failed <= 3) this.options.log(`warn: candles ${coin}: ${(err as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, CANDLE_SPACING_MS));
    }
    this.options.log(`daily candles refreshed for ${coins.length - failed}/${coins.length} markets`);
  }

  private every(name: string, ms: number, fn: () => Promise<void>, firstAfterMs = ms): void {
    const run = async () => {
      try {
        await fn();
      } catch (err) {
        this.options.log(`error: ${name}: ${(err as Error).message}`);
      }
      if (!this.stopped) this.timers.set(name, setTimeout(run, ms));
    };
    this.timers.set(name, setTimeout(run, firstAfterMs));
  }
}
