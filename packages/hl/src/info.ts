import { systemClock, type Clock, type TokenBucket } from "./limiter.ts";
import type { Candle, L2Book, PerpAssetCtx, PerpDex, PerpDexLimits, PerpMeta, SpotMeta } from "./types.ts";

export interface InfoRequest {
  type: string;
  [key: string]: unknown;
}

/**
 * REST weight of an `/info` request, from the official rate-limit table. `candleSnapshot` also
 * costs 1 per 60 candles returned; callers asking for many candles should budget for it.
 */
export function infoWeight(body: InfoRequest): number {
  switch (body.type) {
    case "l2Book":
    case "allMids":
    case "clearinghouseState":
    case "orderStatus":
    case "spotClearinghouseState":
    case "exchangeStatus":
      return 2;
    case "userRole":
      return 60;
    default:
      return 20;
  }
}

export class InfoError extends Error {
  readonly status: number;
  readonly requestType: string;

  constructor(requestType: string, status: number, body: string) {
    super(`info ${requestType}: HTTP ${status} ${body.slice(0, 200)}`);
    this.status = status;
    this.requestType = requestType;
  }
}

export interface InfoClientOptions {
  /** API base URL, e.g. `https://api.hyperliquid.xyz`. */
  url: string;
  /** Shared weight budget. Without one, requests are not throttled. */
  limiter?: TokenBucket;
  /** Attempts for rate-limited (429) and server-error (5xx) responses. */
  attempts?: number;
  fetch?: typeof fetch;
  clock?: Clock;
}

/** Read-only client for `POST /info`. */
export class InfoClient {
  private readonly url: string;
  private readonly limiter: TokenBucket | undefined;
  private readonly attempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;

  constructor(options: InfoClientOptions) {
    this.url = `${options.url}/info`;
    this.limiter = options.limiter;
    this.attempts = options.attempts ?? 3;
    this.fetchImpl = options.fetch ?? fetch;
    this.clock = options.clock ?? systemClock;
  }

  async request<T>(body: InfoRequest): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.limiter?.take(infoWeight(body));
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.attempts) throw new InfoError(body.type, res.status, text);
      await this.clock.sleep(1000 * 2 ** (attempt - 1));
    }
  }

  /** All HIP-3 DEXs. Element 0 is `null`, standing for the core DEX. */
  perpDexs(): Promise<(PerpDex | null)[]> {
    return this.request({ type: "perpDexs" });
  }

  /** Market metadata and live contexts for one DEX; omit `dex` (or pass "") for core. */
  metaAndAssetCtxs(dex = ""): Promise<[PerpMeta, PerpAssetCtx[]]> {
    return this.request(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" });
  }

  /** Open-interest caps for a HIP-3 DEX. */
  perpDexLimits(dex: string): Promise<PerpDexLimits> {
    return this.request({ type: "perpDexLimits", dex });
  }

  /**
   * Order book, at most 20 levels per side. `nSigFigs` (2–5) groups prices into coarser buckets
   * so the 20 levels reach further from mid; without it, deep markets show only a sliver.
   */
  l2Book(coin: string, nSigFigs?: 2 | 3 | 4 | 5): Promise<L2Book> {
    return this.request(nSigFigs ? { type: "l2Book", coin, nSigFigs } : { type: "l2Book", coin });
  }

  candleSnapshot(coin: string, interval: string, startTime: number, endTime: number): Promise<Candle[]> {
    return this.request({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } });
  }

  /** Spot tokens; a DEX's `collateralToken` is an index into `tokens`. */
  spotMeta(): Promise<SpotMeta> {
    return this.request({ type: "spotMeta" });
  }
}
