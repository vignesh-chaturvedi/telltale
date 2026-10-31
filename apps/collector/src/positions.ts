import type { ClearinghouseState, InfoClient } from "@telltale/hl";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** One open position, as of its account's last poll. */
export interface PositionRow {
  coin: string;
  address: string;
  dex: string;
  polledAt: number;
  /** Contracts; negative is short. */
  size: number;
  entryPx: number;
  /** Size at the mark price when polled, USD. */
  positionUsd: number;
  liquidationPx: number | null;
  leverage: number;
  cross: boolean;
  marginUsd: number;
}

/** One account's positions on one DEX. */
export interface AccountSnapshot {
  address: string;
  dex: string;
  polledAt: number;
  accountUsd: number;
  positionUsd: number;
  positions: PositionRow[];
  nextPoll: number;
}

export interface DueAccount {
  address: string;
  dex: string;
}

/**
 * How soon an account is read again, by the USD it holds on that DEX: large accounts move the
 * liquidation map most. A trade brings the next read forward (see `TRADE_REPOLL_MS`).
 */
export const REPOLL_TIERS: readonly [minUsd: number, ms: number][] = [
  [1e6, 10 * MINUTE],
  [1e5, 30 * MINUTE],
  [1, 2 * HOUR],
];
/** An account holding nothing is checked daily, and again soon after it trades. */
export const EMPTY_REPOLL_MS = 24 * HOUR;
/** A trade makes its account due this long after the trade... */
export const TRADE_REPOLL_MS = MINUTE;
/** ...but never sooner than this after the last read, so busy traders don't take the whole budget. */
export const MIN_REPOLL_MS = 10 * MINUTE;
/** A read that failed is retried after this long. */
export const FAILED_REPOLL_MS = HOUR;

export function repollDelay(positionUsd: number): number {
  return REPOLL_TIERS.find(([min]) => positionUsd >= min)?.[1] ?? EMPTY_REPOLL_MS;
}

const num = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Turns a `clearinghouseState` answer into rows to store. A `null` answer (unknown DEX) holds nothing. */
export function toSnapshot(address: string, dex: string, state: ClearinghouseState | null, polledAt: number): AccountSnapshot {
  const positions: PositionRow[] = [];
  for (const { position: p } of state?.assetPositions ?? []) {
    const size = num(p.szi);
    if (!size) continue;
    positions.push({
      coin: p.coin,
      address,
      dex,
      polledAt,
      size,
      entryPx: num(p.entryPx) ?? 0,
      positionUsd: Math.abs(num(p.positionValue) ?? 0),
      // A liquidation price at or below zero means the margin covers any price.
      liquidationPx: (num(p.liquidationPx) ?? 0) > 0 ? num(p.liquidationPx) : null,
      leverage: p.leverage?.value ?? 0,
      cross: p.leverage?.type !== "isolated",
      marginUsd: num(p.marginUsed) ?? 0,
    });
  }
  const positionUsd = positions.reduce((sum, p) => sum + p.positionUsd, 0);
  return {
    address,
    dex,
    polledAt,
    accountUsd: num(state?.marginSummary.accountValue) ?? 0,
    positionUsd,
    positions,
    nextPoll: polledAt + repollDelay(positionUsd),
  };
}

export interface PositionStore {
  dueAccounts(now: number, limit: number): DueAccount[];
  writeSnapshot(snapshot: AccountSnapshot): void;
  deferAccount(account: DueAccount, until: number): void;
}

export interface PollerOptions {
  info: Pick<InfoClient, "clearinghouseState">;
  store: PositionStore;
  /** Reads per minute; each costs 2 REST weight. */
  perMinute: number;
  log: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Reads the positions of accounts seen trading, biggest first, within a fixed share of the REST
 * budget. Hyperliquid has no call for every position in a market, so this is a sample: coverage
 * says how much of each market's open interest it found.
 */
export class PositionPoller {
  private readonly options: Required<PollerOptions>;
  private failures = 0;

  constructor(options: PollerOptions) {
    this.options = {
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
    };
  }

  /** Reads up to a minute's worth of due accounts, spaced evenly; returns how many it read. */
  async pollDue(stopped: () => boolean = () => false): Promise<number> {
    const { info, store, perMinute, log, now, sleep } = this.options;
    const spacing = MINUTE / perMinute;
    const due = store.dueAccounts(now(), perMinute);
    let read = 0;
    for (const account of due) {
      if (stopped()) break;
      const started = now();
      try {
        const state = await info.clearinghouseState(account.address, account.dex);
        store.writeSnapshot(toSnapshot(account.address, account.dex, state, now()));
        read++;
      } catch (err) {
        store.deferAccount(account, now() + FAILED_REPOLL_MS);
        if (++this.failures <= 5 || this.failures % 100 === 0) log(`warn: positions ${account.address} on ${account.dex || "core"}: ${(err as Error).message} (${this.failures} failures)`);
      }
      await sleep(Math.max(0, spacing - (now() - started)));
    }
    return read;
  }
}
