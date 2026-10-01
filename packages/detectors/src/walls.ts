// Tracks unusually large order-book levels ("walls") from successive book snapshots, and reports
// how each one ended. A wall that disappears within minutes, mostly unfilled and before the price
// reaches it, is the pattern seen before the POPCAT loss in November 2025.
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
  /** Pulled walls at least this large and this share of their side are warnings; smaller ones are information. */
  warning: { usd: number; shareOfDepth: number };
  critical: { usd: number; shareOfDepth: number };
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
  warning: { usd: 250_000, shareOfDepth: 0.25 },
  critical: { usd: 2_000_000, shareOfDepth: 0.5 },
};

export type WallEnd = "pulled" | "filled" | "expired";

export interface WallEvent {
  kind: "appeared" | WallEnd;
  coin: string;
  side: Side;
  px: number;
  /** When this event was seen. */
  at: number;
  firstSeen: number;
  peakUsd: number;
  /** The side's USD within ±2% of mid when the wall was at its largest. */
  sideDepthUsd: number;
  /** Traded notional at the wall's price while it stood. */
  filledUsd: number;
  snapshots: number;
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

const key = (side: Side, px: number) => `${side}@${px}`;

function bucketStep(levels: readonly Level[]): number {
  const diffs = levels.slice(1).map((l, i) => Math.abs(l.px - levels[i]!.px));
  return median(diffs.filter((d) => d > 0)) ?? 0;
}

export class WallTracker {
  private readonly walls = new Map<string, Map<string, Wall>>();
  private readonly rules: WallRules;

  constructor(rules: WallRules = DEFAULT_WALL_RULES) {
    this.rules = rules;
  }

  /** Feeds one snapshot, best levels first, and returns the walls that appeared or ended. */
  onBook(coin: string, bids: readonly Level[], asks: readonly Level[], at: number): WallEvent[] {
    const s = summarizeBook(bids, asks);
    if (s.mid === null) return [];
    let tracked = this.walls.get(coin);
    if (!tracked) this.walls.set(coin, (tracked = new Map()));
    const events: WallEvent[] = [];
    for (const side of ["bid", "ask"] as const) {
      const levels = side === "bid" ? bids : asks;
      const depth = side === "bid" ? s.bidDepth[2] : s.askDepth[2];
      const here = new Map(levels.map((l) => [l.px, l.px * l.sz]));
      const deepest = levels.at(-1)!.px;

      for (const [k, wall] of tracked) {
        if (wall.side !== side) continue;
        const now = here.get(wall.px) ?? 0;
        if (now >= this.rules.goneShare * wall.peakUsd) {
          wall.lastSeen = at;
          wall.snapshots++;
          if (now > wall.peakUsd) {
            wall.peakUsd = now;
            wall.sideDepthUsd = depth;
          }
          if (wall.snapshots === this.rules.minSnapshots) events.push(this.event("appeared", coin, wall, at));
          continue;
        }
        tracked.delete(k);
        // Too brief to count, or it scrolled out of the visible book as the price moved away.
        if (wall.snapshots < this.rules.minSnapshots) continue;
        if (side === "bid" ? wall.px < deepest : wall.px > deepest) continue;
        events.push(this.event(this.ending(wall, s.bestBid!, s.bestAsk!, at), coin, wall, at));
      }

      const typical = median(levels.map((l) => l.px * l.sz)) ?? 0;
      const step = bucketStep(levels);
      for (const l of levels) {
        const value = l.px * l.sz;
        const distance = (Math.abs(l.px - s.mid) / s.mid) * 100;
        if (value < this.rules.minUsd || distance > this.rules.maxDistancePct) continue;
        if (value < this.rules.sizeVsTypical * typical && value < this.rules.shareOfDepth * depth) continue;
        const k = key(side, l.px);
        if (tracked.has(k)) continue;
        tracked.set(k, { side, px: l.px, step, firstSeen: at, lastSeen: at, peakUsd: value, sideDepthUsd: depth, filledUsd: 0, snapshots: 1 });
        if (this.rules.minSnapshots <= 1) events.push(this.event("appeared", coin, tracked.get(k)!, at));
      }
    }
    return events;
  }

  /** Feeds one trade. `aggressor` is "B" when a buyer lifted asks and "A" when a seller hit bids. */
  onTrade(coin: string, aggressor: "B" | "A", px: number, notional: number): void {
    const tracked = this.walls.get(coin);
    if (!tracked) return;
    const side: Side = aggressor === "B" ? "ask" : "bid";
    for (const wall of tracked.values()) {
      if (wall.side === side && Math.abs(px - wall.px) <= Math.max(wall.step, wall.px * 1e-9)) wall.filledUsd += notional;
    }
  }

  /** Drops a market's state, e.g. when it stops being streamed. */
  forget(coin: string): void {
    this.walls.delete(coin);
  }

  private ending(wall: Wall, bestBid: number, bestAsk: number, at: number): WallEnd {
    // The other side came down (or up) to the level, so it was traded against, not pulled. The
    // wall's own side can't tell: pulling a wall at the top of the book also moves the best bid.
    const reached = wall.side === "bid" ? bestAsk <= wall.px + wall.step / 2 : bestBid >= wall.px - wall.step / 2;
    if (reached || wall.filledUsd > this.rules.maxFilledShare * wall.peakUsd) return "filled";
    return at - wall.firstSeen <= this.rules.maxLifetimeMs ? "pulled" : "expired";
  }

  private event(kind: WallEvent["kind"], coin: string, wall: Wall, at: number): WallEvent {
    return {
      kind,
      coin,
      side: wall.side,
      px: wall.px,
      at,
      firstSeen: wall.firstSeen,
      peakUsd: Math.round(wall.peakUsd),
      sideDepthUsd: Math.round(wall.sideDepthUsd),
      filledUsd: Math.round(wall.filledUsd),
      snapshots: wall.snapshots,
    };
  }
}

/** The alert for a pulled wall, or `null` for other events. */
export function pulledWallSignal(e: WallEvent, dex: string, rules: WallRules = DEFAULT_WALL_RULES): Signal | null {
  if (e.kind !== "pulled") return null;
  const share = e.sideDepthUsd > 0 ? e.peakUsd / e.sideDepthUsd : 1;
  const meets = (t: { usd: number; shareOfDepth: number }) => e.peakUsd >= t.usd && share >= t.shareOfDepth;
  const severity = meets(rules.critical) ? "critical" : meets(rules.warning) ? "warning" : "info";
  const lifetime = e.at - e.firstSeen;
  return {
    kind: "pulled-wall",
    coin: e.coin,
    dex,
    severity,
    at: e.at,
    title: `A ${usd(e.peakUsd)} ${e.side} wall was pulled after ${duration(lifetime)}`,
    detail:
      `A ${e.side} of ${usd(e.peakUsd)} at ${price(e.px)}, ${pct(Math.min(share, 1))} of the ${e.side} side within ±2% of mid, ` +
      `was removed after ${duration(lifetime)} with ${usd(e.filledUsd)} filled, before the price reached it.`,
    evidence: { side: e.side, px: e.px, peakUsd: e.peakUsd, sideDepthUsd: e.sideDepthUsd, filledUsd: e.filledUsd, lifetimeMs: lifetime },
  };
}
