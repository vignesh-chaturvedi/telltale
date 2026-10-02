// Everything that turns market data into alerts, behind one object: recent bars for the minute
// detectors, the wall tracker for order books, config diffs, and the alert engine. The collector
// feeds it live data; the replay command feeds it stored minutes, so both run the same code.
import {
  ALERT_HISTORY_MINUTES,
  DEFAULT_ALERT_RULES,
  WallTracker,
  detectMinute,
  pulledWallSignal,
  toLevels,
  type AlertRules,
  type BarInput,
  type Signal,
  type WallEvent,
} from "@telltale/detectors";
import type { L2Book, Trade } from "@telltale/hl";
import { AlertEngine, DEFAULT_ENGINE_OPTIONS, type AlertSink } from "./alerts.ts";
import { deployerChangeSignal, diffDexConfig } from "./config-diff.ts";
import { tickerOf } from "./scoring.ts";
import type { AlertStore, ConfigUpdate } from "./store.ts";

/** Walls smaller than this aren't stored: from $100K up they came to about 14 MB a day in the shadow run. */
export const BOOK_EVENT_MIN_USD = 250_000;

export interface WatchedMarket {
  coin: string;
  dex: string;
  oiCapUsd: number | null;
}

export interface WatchOptions {
  alerts: AlertStore;
  sinks: readonly AlertSink[];
  publish: boolean;
  log: (line: string) => void;
  now?: () => number;
  rules?: AlertRules;
}

export class Watch {
  readonly engine: AlertEngine;
  private readonly history = new Map<string, BarInput[]>();
  private markets = new Map<string, WatchedMarket>();
  private peers = new Map<string, string[]>();
  private readonly walls = new WallTracker();
  private bookEvents: WallEvent[] = [];
  private readonly rules: AlertRules;

  constructor(options: WatchOptions) {
    this.rules = options.rules ?? DEFAULT_ALERT_RULES;
    this.engine = new AlertEngine(options.alerts, options.sinks, {
      ...DEFAULT_ENGINE_OPTIONS,
      publish: options.publish,
      log: options.log,
      now: options.now ?? Date.now,
    });
  }

  /** The live markets to check. HIP-3 markets sharing a ticker are checked against each other. */
  setMarkets(markets: readonly WatchedMarket[]): void {
    for (const coin of this.markets.keys()) {
      if (markets.some((m) => m.coin === coin)) continue;
      this.history.delete(coin);
      this.walls.forget(coin);
    }
    this.markets = new Map(markets.map((m) => [m.coin, m]));
    const byTicker = new Map<string, string[]>();
    for (const m of markets) if (m.dex !== "") byTicker.set(tickerOf(m.coin), [...(byTicker.get(tickerOf(m.coin)) ?? []), m.coin]);
    this.peers = new Map(markets.map((m) => [m.coin, m.dex === "" ? [] : (byTicker.get(tickerOf(m.coin)) ?? []).filter((c) => c !== m.coin)]));
  }

  /** Adds finished minute bars, in time order. */
  addBars(bars: readonly (BarInput & { coin: string })[]): void {
    for (const b of bars) {
      if (!this.markets.has(b.coin)) continue;
      let list = this.history.get(b.coin);
      if (!list) this.history.set(b.coin, (list = []));
      if (list.length && list.at(-1)!.ts >= b.ts) continue;
      list.push(b);
      if (list.length > ALERT_HISTORY_MINUTES) list.splice(0, list.length - ALERT_HISTORY_MINUTES);
    }
  }

  /** Runs the minute detectors for every market with a bar for the minute starting at `ts`. */
  checkMinute(ts: number): Signal[] {
    const signals: Signal[] = [];
    const checked = new Set<string>();
    for (const [coin, m] of this.markets) {
      const bars = this.history.get(coin);
      if (!bars || bars.at(-1)!.ts !== ts) continue;
      checked.add(coin);
      const peers = (this.peers.get(coin) ?? []).map((p) => ({ coin: p, bars: this.history.get(p) ?? [] }));
      signals.push(...detectMinute({ coin, dex: m.dex, oiCapUsd: m.oiCapUsd, bars, peers }, this.rules));
    }
    this.engine.onMinute(ts, signals, checked);
    return signals;
  }

  onBook(book: L2Book, at: number): void {
    const m = this.markets.get(book.coin);
    if (!m || !book.levels) return;
    for (const e of this.walls.onBook(book.coin, toLevels(book.levels[0]), toLevels(book.levels[1]), at)) {
      // Large levels come and go constantly; keep how the bigger walls ended, as evidence.
      if (e.kind !== "appeared" && e.peakUsd >= BOOK_EVENT_MIN_USD) this.bookEvents.push(e);
      const s = pulledWallSignal(e, m.dex);
      if (s) this.engine.onEvent(s);
    }
  }

  onTrades(trades: readonly Trade[]): void {
    for (const t of trades) this.walls.onTrade(t.coin, t.side, Number(t.px), Number(t.px) * Number(t.sz));
  }

  /** Reports what each DEX changed since its previous stored config. */
  onConfigUpdates(updates: readonly ConfigUpdate[], at: number): void {
    for (const u of updates) {
      if (u.before === null) continue;
      const s = deployerChangeSignal(u.dex, u.fullName, diffDexConfig(u.before, u.after), at);
      if (s) this.engine.onEvent(s);
    }
  }

  /** Walls that appeared or ended since the last call, for the book_events table. */
  takeBookEvents(): WallEvent[] {
    const out = this.bookEvents;
    this.bookEvents = [];
    return out;
  }
}
