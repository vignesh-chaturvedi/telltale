import { LIMITS } from "./networks.ts";
import type { WsMessage } from "./types.ts";

export interface Subscription {
  type: string;
  coin?: string;
  [key: string]: unknown;
}

/** Stable identity for a subscription, independent of key order. */
export function subscriptionKey(sub: Subscription): string {
  return JSON.stringify(Object.keys(sub).sort().map((k) => [k, sub[k]]));
}

/** The subset of the WebSocket API the pool uses, so tests can pass a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const OPEN = 1;

/** A stretch of time when one connection's subscriptions received no data. */
export interface WsGap {
  connection: number;
  startedAt: number;
  endedAt: number;
  subscriptions: number;
  reason: string;
}

export interface WsPoolOptions {
  url: string;
  onMessage: (msg: WsMessage, connection: number) => void;
  onGap?: (gap: WsGap) => void;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  maxConnections?: number;
  maxSubscriptions?: number;
  maxSubscriptionsPerConnection?: number;
  /** The server drops connections that are silent for 60 s, so we ping well before that. */
  pingIntervalMs?: number;
  /** Reconnect when nothing has arrived for this long, even if the socket looks open. */
  staleAfterMs?: number;
  /** Outgoing messages per second across all connections. */
  sendPerSecond?: number;
  createSocket?: WebSocketFactory;
  now?: () => number;
  random?: () => number;
}

export interface WsPoolStats {
  connections: number;
  open: number;
  subscriptions: number;
  received: number;
  sent: number;
  reconnects: number;
}

/**
 * Spreads subscriptions over several WebSocket connections within Hyperliquid's per-IP limits.
 * Each connection reconnects with backoff, resubscribes, and reports the outage as a gap.
 */
export class WsPool {
  readonly options: Required<Omit<WsPoolOptions, "onGap" | "onLog">> & Pick<WsPoolOptions, "onGap" | "onLog">;
  private readonly connections: WsConnection[] = [];
  private readonly sendQueue: { conn: WsConnection; payload: string }[] = [];
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  received = 0;
  sent = 0;
  reconnects = 0;

  constructor(options: WsPoolOptions) {
    this.options = {
      maxConnections: 8,
      maxSubscriptions: 900,
      maxSubscriptionsPerConnection: 200,
      pingIntervalMs: 50_000,
      staleAfterMs: 90_000,
      sendPerSecond: 25,
      createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
      now: () => Date.now(),
      random: Math.random,
      ...options,
    };
    if (this.options.maxConnections > LIMITS.wsConnections) throw new Error("maxConnections is above Hyperliquid's limit");
    if (this.options.maxSubscriptions > LIMITS.wsSubscriptions) throw new Error("maxSubscriptions is above Hyperliquid's limit");
  }

  get subscriptionCount(): number {
    return this.connections.reduce((n, c) => n + c.subs.size, 0);
  }

  has(sub: Subscription): boolean {
    const key = subscriptionKey(sub);
    return this.connections.some((c) => c.subs.has(key));
  }

  /** Adds subscriptions, opening connections as needed. Throws if the budget would be exceeded. */
  subscribe(subs: Subscription[]): void {
    const fresh = subs.filter((s) => !this.has(s));
    if (this.subscriptionCount + fresh.length > this.options.maxSubscriptions) {
      throw new Error(`subscription budget exceeded: ${this.subscriptionCount} + ${fresh.length} > ${this.options.maxSubscriptions}`);
    }
    for (const sub of fresh) this.pickConnection().add(sub);
  }

  unsubscribe(subs: Subscription[]): void {
    for (const sub of subs) {
      const key = subscriptionKey(sub);
      this.connections.find((c) => c.subs.has(key))?.remove(key);
    }
  }

  stats(): WsPoolStats {
    return {
      connections: this.connections.length,
      open: this.connections.filter((c) => c.isOpen).length,
      subscriptions: this.subscriptionCount,
      received: this.received,
      sent: this.sent,
      reconnects: this.reconnects,
    };
  }

  close(): void {
    this.closed = true;
    if (this.sendTimer) clearInterval(this.sendTimer);
    this.sendTimer = null;
    this.sendQueue.length = 0;
    for (const c of this.connections) c.close();
  }

  private pickConnection(): WsConnection {
    const { maxConnections, maxSubscriptionsPerConnection } = this.options;
    const open = this.connections.filter((c) => c.subs.size < maxSubscriptionsPerConnection);
    if (open.length > 0) return open.reduce((a, b) => (b.subs.size < a.subs.size ? b : a));
    if (this.connections.length >= maxConnections) throw new Error("all WebSocket connections are full");
    const conn = new WsConnection(this.connections.length, this);
    this.connections.push(conn);
    conn.connect();
    return conn;
  }

  /** @internal Queue a message; the queue drains at `sendPerSecond`. */
  enqueue(conn: WsConnection, payload: string): void {
    if (this.closed) return;
    this.sendQueue.push({ conn, payload });
    this.sendTimer ??= setInterval(() => this.drain(), 1000 / this.options.sendPerSecond);
  }

  /** @internal Forget queued messages for a connection that went down; it resubscribes on reconnect. */
  dropQueued(conn: WsConnection): void {
    for (let i = this.sendQueue.length - 1; i >= 0; i--) if (this.sendQueue[i]!.conn === conn) this.sendQueue.splice(i, 1);
  }

  private drain(): void {
    const item = this.sendQueue.shift();
    if (item) {
      if (item.conn.send(item.payload)) this.sent++;
    }
    if (this.sendQueue.length === 0 && this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }
}

class WsConnection {
  readonly id: number;
  readonly subs = new Map<string, Subscription>();
  private readonly pool: WsPool;
  private ws: WebSocketLike | null = null;
  private attempts = 0;
  private downSince: number | null = null;
  private downReason = "";
  private lastMessageAt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(id: number, pool: WsPool) {
    this.id = id;
    this.pool = pool;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === OPEN;
  }

  connect(): void {
    const { createSocket, url } = this.pool.options;
    const ws = createSocket(url);
    this.ws = ws;
    ws.onopen = () => this.handleOpen();
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = (ev) => this.handleClose(`closed ${ev.code}${ev.reason ? ` ${ev.reason}` : ""}`);
    ws.onerror = () => {};
  }

  add(sub: Subscription): void {
    const key = subscriptionKey(sub);
    this.subs.set(key, sub);
    if (this.isOpen) this.pool.enqueue(this, JSON.stringify({ method: "subscribe", subscription: sub }));
  }

  remove(key: string): void {
    const sub = this.subs.get(key);
    if (!sub) return;
    this.subs.delete(key);
    if (this.isOpen) this.pool.enqueue(this, JSON.stringify({ method: "unsubscribe", subscription: sub }));
  }

  /** Returns false if the socket isn't open; the message is then resent after reconnecting. */
  send(payload: string): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(payload);
    return true;
  }

  close(): void {
    this.closed = true;
    this.stopTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, "client closing");
    this.ws = null;
  }

  private handleOpen(): void {
    const { now, pingIntervalMs, staleAfterMs, onGap, onLog } = this.pool.options;
    const at = now();
    this.attempts = 0;
    this.lastMessageAt = at;
    if (this.downSince !== null) {
      onGap?.({ connection: this.id, startedAt: this.downSince, endedAt: at, subscriptions: this.subs.size, reason: this.downReason });
      onLog?.("info", `ws ${this.id}: reconnected after ${((at - this.downSince) / 1000).toFixed(1)}s (${this.downReason})`);
      this.downSince = null;
    }
    for (const sub of this.subs.values()) this.pool.enqueue(this, JSON.stringify({ method: "subscribe", subscription: sub }));
    this.pingTimer = setInterval(() => this.send(JSON.stringify({ method: "ping" })), pingIntervalMs);
    this.watchdogTimer = setInterval(() => {
      if (now() - this.lastMessageAt > staleAfterMs) this.ws?.close(4000, "no data");
    }, Math.min(10_000, staleAfterMs));
  }

  private handleMessage(data: unknown): void {
    this.lastMessageAt = this.pool.options.now();
    this.pool.received++;
    let msg: WsMessage;
    try {
      msg = JSON.parse(String(data)) as WsMessage;
    } catch {
      this.pool.options.onLog?.("warn", `ws ${this.id}: unparseable message`);
      return;
    }
    if (msg.channel === "pong" || msg.channel === "subscriptionResponse") return;
    if (msg.channel === "error") {
      this.pool.options.onLog?.("error", `ws ${this.id}: server error: ${String(msg.data)}`);
      return;
    }
    this.pool.options.onMessage(msg, this.id);
  }

  private handleClose(reason: string): void {
    this.stopTimers();
    this.ws = null;
    this.pool.dropQueued(this);
    if (this.closed) return;
    const { now, random, onLog } = this.pool.options;
    if (this.downSince === null) {
      this.downSince = now();
      this.downReason = reason;
    }
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) * (0.5 + random() / 2);
    this.attempts++;
    this.pool.reconnects++;
    onLog?.("warn", `ws ${this.id}: ${reason}; reconnecting in ${(delay / 1000).toFixed(1)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.pingTimer = null;
    this.watchdogTimer = null;
  }
}
