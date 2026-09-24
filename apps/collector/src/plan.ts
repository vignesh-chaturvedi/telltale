import type { Subscription } from "@telltale/hl";
import { CORE_DEX, isLive, type Universe } from "./universe.ts";

export interface PlanOptions {
  /** Markets whose order book and trades are streamed; the rest are polled over REST. */
  bookStreams: number;
}

export interface SubscriptionPlan {
  subscriptions: Subscription[];
  /** Markets with a per-market context stream (oracle changes visible within ~1 s). */
  ctxStreamed: string[];
  /** Markets with streamed books and trades. */
  bookStreamed: string[];
  /** Markets whose books are polled over REST once per cycle instead. */
  bookPolled: string[];
}

/**
 * Chooses what to stream within the WebSocket budget.
 *
 * - One `allDexsAssetCtxs` stream gives every market's context about every 14 s.
 * - Markets on active HIP-3 DEXs also get `activeAssetCtx`, because their deployers run the
 *   oracle and we need to see each update.
 * - Books and trades are streamed for the thinnest markets by 24h volume, where manipulation
 *   is cheapest. The deepest core markets and all dormant DEXs are polled instead.
 */
export function planSubscriptions(universe: Universe, options: PlanOptions): SubscriptionPlan {
  const activeDexes = new Set(universe.dexes.filter((d) => d.active).map((d) => d.name));
  const live = universe.markets.filter(isLive);
  const volume = (coin: string) => Number(universe.ctxs.get(coin)?.dayNtlVlm ?? 0);

  const ctxStreamed = live.filter((m) => m.dex !== CORE_DEX && activeDexes.has(m.dex)).map((m) => m.coin);
  const candidates = live
    .filter((m) => activeDexes.has(m.dex))
    .map((m) => m.coin)
    .sort((a, b) => volume(a) - volume(b) || (a < b ? -1 : 1));
  const bookStreamed = candidates.slice(0, options.bookStreams);
  const streamedSet = new Set(bookStreamed);
  const bookPolled = live.map((m) => m.coin).filter((c) => !streamedSet.has(c));

  const subscriptions: Subscription[] = [
    { type: "allDexsAssetCtxs" },
    ...ctxStreamed.map((coin) => ({ type: "activeAssetCtx", coin })),
    ...bookStreamed.flatMap((coin) => [
      { type: "l2Book", coin },
      { type: "trades", coin },
    ]),
  ];
  return { subscriptions, ctxStreamed, bookStreamed, bookPolled };
}
