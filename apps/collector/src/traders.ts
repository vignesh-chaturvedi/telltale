import type { Trade } from "@telltale/hl";

/** What one address traded in one market since the last flush. */
export interface TraderActivity {
  address: string;
  coin: string;
  dex: string;
  lastSeen: number;
  trades: number;
  tradedUsd: number;
}

/** "xyz:SP500" is on the xyz DEX; a coin without a prefix is on core (""). */
export const dexOfCoin = (coin: string): string => {
  const colon = coin.indexOf(":");
  return colon < 0 ? "" : coin.slice(0, colon);
};

/**
 * Tallies who traded which market from the trades stream, so the position poller knows whose
 * accounts to read. Both sides of a trade count: `users` is [buyer, seller].
 */
export class TraderTally {
  private activity = new Map<string, TraderActivity>();

  onTrades(trades: readonly Trade[]): void {
    for (const t of trades) {
      if (!Array.isArray(t.users)) continue;
      const usd = Number(t.px) * Number(t.sz);
      for (const user of t.users) {
        const address = user.toLowerCase();
        const key = `${t.coin} ${address}`;
        const a = this.activity.get(key);
        if (a) {
          a.trades++;
          a.tradedUsd += usd;
          a.lastSeen = Math.max(a.lastSeen, t.time);
        } else {
          this.activity.set(key, { address, coin: t.coin, dex: dexOfCoin(t.coin), lastSeen: t.time, trades: 1, tradedUsd: usd });
        }
      }
    }
  }

  /** Returns everything tallied since the last call and starts over. */
  take(): TraderActivity[] {
    const out = [...this.activity.values()];
    this.activity.clear();
    return out;
  }
}
