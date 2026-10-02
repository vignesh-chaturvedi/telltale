// Tracks unusually large order-book levels ("walls") from successive book snapshots, and reports
// how each one ended. A wall that disappears within minutes, mostly unfilled and before the price
// reaches it, is the pattern seen before the POPCAT loss in November 2025.
//
// Large levels come and go all the time: market makers re-quote as the price moves, and on the
// first live day about two thirds of vanished walls reappeared within 1% seconds later. So a wall
// counts as pulled only if it isn't replaced nearby, and an alert needs it to be far larger than
// the market's usual walls.
//
// It works on grouped books (prices bucketed to 3 significant figures), so a "level" is a price
// bucket and one wall may be several orders. Everything here is a pure function of the snapshots
// and trades fed in, in time order.
import type { Signal } from "./alerts.ts";
import { summarizeBook, type Level } from "./book.ts";
import { median } from "./stats.ts";
import { duration, pct, price, usd } from "./text.ts";

export type Side = "bid" | "ask";

export interface WallRules {
  /** Smallest level, in USD, that can count as a wall. */
  minUsd: number;
  /** A wall is this many times the median level on its side... */
  sizeVsTypical: number;
  /** ...or at least this share of its side's depth within ±2% of mid. */
  shareOfDepth: number;
  /** Walls further than this from mid, in percent, aren't tracked. */
  maxDistancePct: number;
  /** Snapshots a level must appear in before it counts, so one-snapshot flickers are ignored. */
  minSnapshots: number;
  /** A wall removed within this long counts as pulled; one that stood longer simply expired. */
  maxLifetimeMs: number;
  /** A wall filled beyond this share of its peak size was traded against, not pulled. */
  maxFilledShare: number;
  /** A level shrinking below this share of its peak counts as removed. */
  goneShare: number;
  /** A similar wall (at least `share` of the size, within `pct`% of the price) appearing this close in time means it moved. */
  moved: { withinMs: number; pct: number; share: number };
  /** A market's usual wall: the median of its walls that ended in this window, once there are enough. */
  typical: { windowMs: number; minSamples: number };
  /** A pulled wall is an alert only when it stood at least this long... */
  minLifetimeMs: number;
  /** ...and is this large: in USD, as a share of its side within ±2%, and against the market's usual wall. */
  warning: { usd: number; shareOfDepth: number; vsTypical: number };
  critical: { usd: number; shareOfDepth: number; vsTypical: number };
}

export const DEFAULT_WALL_RULES: WallRules = {
  minUsd: 50_000,
  sizeVsTypical: 5,
  shareOfDepth: 0.25,
  maxDistancePct: 2,
  minSnapshots: 2,
  maxLifetimeMs: 10 * 60_000,
  maxFilledShare: 0.1,
  goneShare: 0.2,
  moved: { withinMs: 15_000, pct: 1, share: 0.5 },
  typical: { windowMs: 2 * 60 * 60_000, minSamples: 10 },
  minLifetimeMs: 30_000,
  // Two thirds of the side means the wall is at least twice everything else resting within ±2%.
  // At 3× the usual wall the shadow run raised 27 alerts in 26 hours, mostly routine large walls;
  // 5× kept the 7 that stood out (up to 37×).
  warning: { usd: 250_000, shareOfDepth: 2 / 3, vsTypical: 5 },
  critical: { usd: 2_000_000, shareOfDepth: 0.8, vsTypical: 5 },
};

export type WallEnd = "pulled" | "moved" | "filled" | "expired";

export interface WallEvent {
  kind: "appeared" | WallEnd;
  coin: string;
  side: Side;
  px: number;
  /** When this event was seen. */
  at: number;
  firstSeen: number;
  /** When the wall was last seen standing. */
  lastSeen: number;
  peakUsd: number;
  /** The side's USD within ±2% of mid when the wall was at its largest. */
  sideDepthUsd: number;
  /** Traded notional at the wall's price while it stood. */
  filledUsd: number;
  snapshots: number;
  /** The market's usual wall when this one ended, or `null` without enough history. */
  typicalUsd: number | null;
}

interface Wall {
  side: Side;
  px: number;
  /** Width of the price bucket, for matching trades to the level. */
  step: number;
  firstSeen: number;
  lastSeen: number;
  peakUsd: number;
  sideDepthUsd: number;
  filledUsd: number;
  snapshots: number;
}

interface Market {
  walls: Map<string, Wall>;
  /** Walls that vanished unfilled, waiting to see whether they reappear nearby. */
  pending: { wall: Wall; at: number }[];
  /** Recently ended walls, for the market's usual size. */
  ended: { at: number; peakUsd: number }[];
}

const key = (side: Side, px: number) => `${side}@${px}`;

function bucketStep(levels: readonly Level[]): number {
  const diffs = levels.slice(1).map((l, i) => Math.abs(l.px - levels[i]!.px));
  return median(diffs.filter((d) => d > 0)) ?? 0;
}

export class WallTracker {
  private readonly markets = new Map<string, Market>();
  private readonly rules: WallRules;

  constructor(rules: WallRules = DEFAULT_WALL_RULES) {
    this.rules = rules;
  }

  /** Feeds one snapshot, best levels first, and returns the walls that appeared or ended. */
  onBook(coin: string, bids: readonly Level[], asks: readonly Level[], at: number): WallEvent[] {
    const s = summarizeBook(bids, asks);
    if (s.mid === null) return [];
    let m = this.markets.get(coin);
    if (!m) this.markets.set(coin, (m = { walls: new Map(), pending: [], ended: [] }));
    const events: WallEvent[] = [];
    for (const side of ["bid", "ask"] as const) {
      const levels = side === "bid" ? bids : asks;
      const depth = side === "bid" ? s.bidDepth[2] : s.askDepth[2];
      const here = new Map(levels.map((l) => [l.px, l.px * l.sz]));
      const deepest = levels.at(-1)!.px;

      for (const [k, wall] of m.walls) {
        if (wall.side !== side) continue;
        const now = here.get(wall.px) ?? 0;
        if (now >= this.rules.goneShare * wall.peakUsd) {
          wall.lastSeen = at;
          wall.snapshots++;
          if (now > wall.peakUsd) {
            wall.peakUsd = now;
            wall.sideDepthUsd = depth;
          }
          if (wall.snapshots === this.rules.minSnapshots) events.push(this.event("appeared", coin, wall, at, null));
          continue;
        }
        m.walls.delete(k);
        // Too brief to count, or it scrolled out of the visible book as the price moved away.
        if (wall.snapshots < this.rules.minSnapshots) continue;
        if (side === "bid" ? wall.px < deepest : wall.px > deepest) continue;
        const end = this.ending(wall, s.bestBid!, s.bestAsk!, at);
        if (end !== "pulled") events.push(this.finish(end, coin, m, wall, at));
        // A similar wall that went up just before this one came down: the quote was moved.
        else if (this.replacement(m, wall, at)) events.push(this.finish("moved", coin, m, wall, at));
        else m.pending.push({ wall, at });
      }

      const typical = median(levels.map((l) => l.px * l.sz)) ?? 0;
      const step = bucketStep(levels);
      for (const l of levels) {
        const value = l.px * l.sz;
        const distance = (Math.abs(l.px - s.mid) / s.mid) * 100;
        if (value < this.rules.minUsd || distance > this.rules.maxDistancePct) continue;
        if (value < this.rules.sizeVsTypical * typical && value < this.rules.shareOfDepth * depth) continue;
        const k = key(side, l.px);
        if (m.walls.has(k)) continue;
        m.walls.set(k, { side, px: l.px, step, firstSeen: at, lastSeen: at, peakUsd: value, sideDepthUsd: depth, filledUsd: 0, snapshots: 1 });
        if (this.rules.minSnapshots <= 1) events.push(this.event("appeared", coin, m.walls.get(k)!, at, null));
      }
    }

    // Settle vanished walls: moved if a similar one has gone up nearby, pulled once the wait is over.
    m.pending = m.pending.filter(({ wall, at: gone }) => {
      if (this.replacement(m, wall, gone)) events.push(this.finish("moved", coin, m, wall, at));
      else if (at - gone >= this.rules.moved.withinMs) events.push(this.finish("pulled", coin, m, wall, gone));
      else return true;
      return false;
    });
    return events;
  }

  /** Feeds one trade. `aggressor` is "B" when a buyer lifted asks and "A" when a seller hit bids. */
  onTrade(coin: string, aggressor: "B" | "A", px: number, notional: number): void {
    const m = this.markets.get(coin);
    if (!m) return;
    const side: Side = aggressor === "B" ? "ask" : "bid";
    for (const wall of m.walls.values()) {
      if (wall.side === side && Math.abs(px - wall.px) <= Math.max(wall.step, wall.px * 1e-9)) wall.filledUsd += notional;
    }
  }

  /** Drops a market's state, e.g. when it stops being streamed. */
  forget(coin: string): void {
    this.markets.delete(coin);
  }

  /** A wall on the same side, near the price and of similar size, that went up around when this one came down. */
  private replacement(m: Market, gone: Wall, at: number): boolean {
    const r = this.rules.moved;
    for (const w of m.walls.values()) {
      if (w === gone || w.side !== gone.side || Math.abs(w.firstSeen - at) > r.withinMs) continue;
      if ((Math.abs(w.px - gone.px) / gone.px) * 100 <= r.pct && w.peakUsd >= r.share * gone.peakUsd) return true;
    }
    return false;
  }

  private ending(wall: Wall, bestBid: number, bestAsk: number, at: number): WallEnd {
    // The other side came down (or up) to the level, so it was traded against, not pulled. The
    // wall's own side can't tell: pulling a wall at the top of the book also moves the best bid.
    const reached = wall.side === "bid" ? bestAsk <= wall.px + wall.step / 2 : bestBid >= wall.px - wall.step / 2;
    if (reached || wall.filledUsd > this.rules.maxFilledShare * wall.peakUsd) return "filled";
    return at - wall.firstSeen <= this.rules.maxLifetimeMs ? "pulled" : "expired";
  }

  /** Records an ended wall for the market's usual size, and reports it against what came before. */
  private finish(kind: WallEnd, coin: string, m: Market, wall: Wall, at: number): WallEvent {
    const { windowMs, minSamples } = this.rules.typical;
    m.ended = m.ended.filter((e) => at - e.at <= windowMs);
    const typical = m.ended.length >= minSamples ? median(m.ended.map((e) => e.peakUsd)) : null;
    m.ended.push({ at, peakUsd: wall.peakUsd });
    return this.event(kind, coin, wall, at, typical);
  }

  private event(kind: WallEvent["kind"], coin: string, wall: Wall, at: number, typicalUsd: number | null): WallEvent {
    return {
      kind,
      coin,
      side: wall.side,
      px: wall.px,
      at,
      firstSeen: wall.firstSeen,
      lastSeen: wall.lastSeen,
      peakUsd: Math.round(wall.peakUsd),
      sideDepthUsd: Math.round(wall.sideDepthUsd),
      filledUsd: Math.round(wall.filledUsd),
      snapshots: wall.snapshots,
      typicalUsd: typicalUsd === null ? null : Math.round(typicalUsd),
    };
  }
}

/**
 * The alert for a pulled wall, or `null`. Only exceptional walls qualify: large, most of their
 * side of the book, several times the market's usual wall, and standing long enough to matter.
 */
export function pulledWallSignal(e: WallEvent, dex: string, rules: WallRules = DEFAULT_WALL_RULES): Signal | null {
  if (e.kind !== "pulled" || e.typicalUsd === null || e.typicalUsd <= 0) return null;
  const lifetime = e.at - e.firstSeen;
  if (lifetime < rules.minLifetimeMs) return null;
  const share = e.sideDepthUsd > 0 ? e.peakUsd / e.sideDepthUsd : 1;
  const times = e.peakUsd / e.typicalUsd;
  const meets = (t: { usd: number; shareOfDepth: number; vsTypical: number }) => e.peakUsd >= t.usd && share >= t.shareOfDepth && times >= t.vsTypical;
  const severity = meets(rules.critical) ? "critical" : meets(rules.warning) ? "warning" : null;
  if (!severity) return null;
  return {
    kind: "pulled-wall",
    coin: e.coin,
    dex,
    severity,
    at: e.at,
    title: `A ${usd(e.peakUsd)} ${e.side} wall was pulled after ${duration(lifetime)}`,
    detail:
      `A ${e.side} of ${usd(e.peakUsd)} at ${price(e.px)}, ${pct(Math.min(share, 1))} of the ${e.side} side within ±2% of mid and ` +
      `${times.toFixed(0)}× this market's usual large order, was removed after ${duration(lifetime)} with ${usd(e.filledUsd)} filled, ` +
      `before the price reached it.`,
    evidence: {
      side: e.side,
      px: e.px,
      peakUsd: e.peakUsd,
      sideDepthUsd: e.sideDepthUsd,
      typicalUsd: e.typicalUsd,
      filledUsd: e.filledUsd,
      lifetimeMs: lifetime,
    },
  };
}
