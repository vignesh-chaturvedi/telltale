// Turns detector signals into alerts: one alert per episode, a cooldown so a market that stays in
// trouble doesn't repeat itself, and limits on how much is sent out. Everything is recorded; only
// warnings and above are sent to the alert channels, and only when publishing is switched on.
import { severityRank, type Signal } from "@telltale/detectors";
import type { AlertRecord, AlertStore } from "./store.ts";

/** Somewhere alerts are sent: a Telegram channel, a webhook. */
export interface AlertSink {
  name: string;
  send(alert: AlertRecord): Promise<void>;
}

export interface AlertEngineOptions {
  /** After an alert starts, the same kind for the same market stays quiet this long unless it gets more severe. */
  cooldownMs: number;
  /** An open minute alert closes after this many checked minutes without its condition. */
  resolveAfterMinutes: number;
  /** Send warnings and above to the sinks; when false, alerts are only recorded (the shadow run). */
  publish: boolean;
  maxPublishPerMinute: number;
  maxPublishPerDay: number;
  log: (line: string) => void;
  now: () => number;
}

export const DEFAULT_ENGINE_OPTIONS: Omit<AlertEngineOptions, "publish" | "log"> = {
  cooldownMs: 12 * 60 * 60_000,
  resolveAfterMinutes: 3,
  maxPublishPerMinute: 3,
  maxPublishPerDay: 20,
  now: Date.now,
};

/** Kinds that describe a moment rather than a condition: recorded as opened and closed at once. */
const EVENT_KINDS = new Set<Signal["kind"]>(["pulled-wall", "deployer-change"]);

const keyOf = (s: { kind: string; coin: string | null; dex: string }) => `${s.kind}|${s.coin ?? `dex:${s.dex}`}`;

export interface EngineStats {
  opened: number;
  suppressed: number;
  published: number;
  heldBack: number;
}

export class AlertEngine {
  private readonly open = new Map<string, AlertRecord & { quiet: number }>();
  /** The latest alert started for each key, for the cooldown. */
  private readonly recent = new Map<string, { at: number; severity: Signal["severity"] }>();
  private readonly sent: number[] = [];
  readonly stats: EngineStats = { opened: 0, suppressed: 0, published: 0, heldBack: 0 };
  private readonly store: AlertStore;
  private readonly sinks: readonly AlertSink[];
  private readonly options: AlertEngineOptions;

  constructor(store: AlertStore, sinks: readonly AlertSink[], options: AlertEngineOptions) {
    this.store = store;
    this.sinks = sinks;
    this.options = options;
    // Carry on across restarts: reopen what was open, and remember what's cooling down.
    for (const a of store.loadAlerts(options.now() - options.cooldownMs)) {
      this.recent.set(keyOf(a), { at: a.startedAt, severity: a.severity });
      if (a.resolvedAt === null) this.open.set(keyOf(a), { ...a, quiet: 0 });
    }
  }

  /**
   * Signals from the minute detectors for the minute starting at `ts`. `checked` lists the markets
   * that had data that minute: an open alert only closes after minutes in which it was checked.
   */
  onMinute(ts: number, signals: readonly Signal[], checked: ReadonlySet<string>): void {
    const seen = new Set<string>();
    for (const s of signals) {
      const key = keyOf(s);
      seen.add(key);
      const current = this.open.get(key);
      if (current) {
        const rank = severityRank(s.severity) - severityRank(current.severity);
        Object.assign(current, { updatedAt: s.at, minutes: current.minutes + 1, quiet: 0 });
        // The text follows the alert's worst moment, so it always matches the severity shown.
        if (rank >= 0) Object.assign(current, { severity: s.severity, title: s.title, detail: s.detail, evidence: s.evidence });
        this.store.updateAlert(current);
        if (rank > 0) this.publish(current);
        continue;
      }
      this.start(s, null);
    }
    for (const [key, a] of this.open) {
      if (seen.has(key) || EVENT_KINDS.has(a.kind) || !checked.has(a.coin ?? "")) continue;
      if (++a.quiet < this.options.resolveAfterMinutes) continue;
      a.resolvedAt = ts;
      this.store.updateAlert(a);
      this.open.delete(key);
    }
  }

  /** A one-off event (a pulled wall, a config change). */
  onEvent(s: Signal): void {
    this.start(s, s.at);
  }

  private start(s: Signal, resolvedAt: number | null): void {
    const key = keyOf(s);
    const last = this.recent.get(key);
    if (last && s.at - last.at < this.options.cooldownMs && severityRank(s.severity) <= severityRank(last.severity)) {
      this.stats.suppressed++;
      return;
    }
    const record: Omit<AlertRecord, "id"> = {
      kind: s.kind,
      coin: s.coin,
      dex: s.dex,
      severity: s.severity,
      startedAt: s.at,
      updatedAt: s.at,
      resolvedAt,
      minutes: 1,
      title: s.title,
      detail: s.detail,
      evidence: s.evidence,
      publishedAt: null,
    };
    const alert = { ...record, id: this.store.insertAlert(record), quiet: 0 };
    this.stats.opened++;
    this.recent.set(key, { at: s.at, severity: s.severity });
    if (resolvedAt === null) this.open.set(key, alert);
    this.publish(alert);
    this.options.log(`alert ${alert.severity} ${alert.coin ?? (alert.dex || "core")}: ${alert.title}${alert.publishedAt ? " (sent)" : ""}`);
  }

  private publish(a: AlertRecord): void {
    if (!this.options.publish || a.severity === "info" || a.publishedAt !== null || this.sinks.length === 0) return;
    const now = this.options.now();
    while (this.sent.length && now - this.sent[0]! > 86_400_000) this.sent.shift();
    const lastMinute = this.sent.filter((t) => now - t < 60_000).length;
    if (lastMinute >= this.options.maxPublishPerMinute || this.sent.length >= this.options.maxPublishPerDay) {
      this.stats.heldBack++;
      this.options.log(`alerts: send limit reached, kept on the site only: ${a.coin ?? a.dex} ${a.title}`);
      return;
    }
    this.sent.push(now);
    a.publishedAt = now;
    this.store.updateAlert(a);
    this.stats.published++;
    for (const sink of this.sinks) {
      sink.send(a).catch((err: Error) => this.options.log(`warn: alert to ${sink.name} failed: ${err.message}`));
    }
  }
}

/** Keeps alerts in memory, for replays and tests. */
export class MemoryAlertStore implements AlertStore {
  readonly alerts: AlertRecord[] = [];

  insertAlert(alert: Omit<AlertRecord, "id">): number {
    const id = this.alerts.length + 1;
    this.alerts.push({ ...alert, id });
    return id;
  }

  updateAlert(alert: AlertRecord): void {
    const { quiet: _quiet, ...plain } = alert as AlertRecord & { quiet?: number };
    this.alerts[alert.id - 1] = { ...plain };
  }

  loadAlerts(since: number): AlertRecord[] {
    return this.alerts.filter((a) => a.resolvedAt === null || a.startedAt >= since);
  }
}
