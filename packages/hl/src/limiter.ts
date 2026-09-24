export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface TokenBucketOptions {
  /** Tokens added per minute. */
  perMinute: number;
  /** Most tokens that can be saved up. Defaults to a quarter of `perMinute`, which keeps bursts small. */
  burst?: number;
  clock?: Clock;
}

/**
 * A token bucket for request weights (REST) or message counts (WebSocket sends). Callers wait
 * in FIFO order, so one large request can't be starved by a stream of small ones.
 */
export class TokenBucket {
  readonly perMinute: number;
  readonly burst: number;
  private readonly clock: Clock;
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();
  /** Total tokens handed out since creation. */
  taken = 0;

  constructor(options: TokenBucketOptions) {
    this.perMinute = options.perMinute;
    this.burst = options.burst ?? Math.max(1, Math.floor(options.perMinute / 4));
    this.clock = options.clock ?? systemClock;
    this.tokens = this.burst;
    this.last = this.clock.now();
  }

  /** Resolves once `amount` tokens are available and taken. */
  take(amount: number): Promise<void> {
    if (amount > this.burst) throw new Error(`take(${amount}) exceeds the bucket size of ${this.burst}`);
    const turn = this.queue.then(() => this.waitFor(amount));
    this.queue = turn.catch(() => {});
    return turn;
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) * this.perMinute) / 60_000);
    this.last = now;
  }

  private async waitFor(amount: number): Promise<void> {
    this.refill();
    while (this.tokens < amount) {
      const missing = amount - this.tokens;
      await this.clock.sleep(Math.ceil((missing * 60_000) / this.perMinute));
      this.refill();
    }
    this.tokens -= amount;
    this.taken += amount;
  }
}
