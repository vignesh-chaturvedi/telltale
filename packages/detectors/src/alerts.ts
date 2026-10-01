// Alert detectors. Each one looks at a market's recent minute bars and says whether a condition
// holds at the latest minute. Deciding when that becomes an alert (episodes, cooldowns, where it
// is sent) is the caller's job, so the live collector and the incident replays share this code.
//
// Wording stays neutral: alerts describe what the data shows, never anyone's intent.
import type { BarInput, PeerInput } from "./metrics.ts";
import { median } from "./stats.ts";
import { bps, duration, pct, price, usd } from "./text.ts";

export type AlertKind =
  | "mark-divergence"
  | "stale-oracle"
  | "peer-divergence"
  | "depth-collapse"
  | "oi-surge"
  | "oi-cap"
  | "pulled-wall"
  | "deployer-change";

/** `info` stays on the site; `warning` and `critical` are also sent to the alert channels. */
export type Severity = "info" | "warning" | "critical";
export const SEVERITIES: readonly Severity[] = ["info", "warning", "critical"];
export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);

/** A condition that holds for one market (or DEX) at one moment. */
export interface Signal {
  kind: AlertKind;
  /** `null` when the signal is about a whole DEX. */
  coin: string | null;
  /** "" for core. */
  dex: string;
  severity: Severity;
  /** Epoch ms: the start of the minute checked, or the moment of the event. */
  at: number;
  /** One short line, e.g. "Mark price 3.4% from the oracle". */
  title: string;
  /** One or two sentences with the numbers behind it. */
  detail: string;
  /** The numbers behind it, for the alert log and webhooks. */
  evidence: Record<string, number | string | null>;
}

export interface AlertRules {
  markDivergence: { minutes: number; bps: Record<Severity, number> };
  staleOracle: { minutes: number; frozenMs: number; bps: Record<"info" | "warning", number> };
  peerDivergence: { minutes: number; bps: Record<"info" | "warning", number>; sameUnit: number };
  depthCollapse: {
    minutes: number;
    /** Minutes skipped between the baseline and the checked window, so a fall in progress isn't its own baseline. */
    gapMinutes: number;
    baselineMinutes: number;
    /** Depth must stay below this share of the baseline for every checked minute... */
    ratio: Record<"info" | "warning", number>;
    /** ...and leave less than this share of open interest; a fall that leaves plenty of depth isn't reported. */
    maxDepthToOi: Record<"info" | "warning", number>;
    minBaselineUsd: number;
    minOiUsd: number;
    /** Open interest must stay at or above this share of where it was, or positions are unwinding. */
    oiHold: number;
  };
  oiSurge: { minutes: number; rise: number; minAddUsd: number; maxDepthToOi: number };
  oiCap: { share: number };
}

/**
 * Starting thresholds. Replayed over 21 hours of September 2026 data they raise about 9 warnings
 * a day across all 329 markets, plus about 25 information alerts that stay on the site. The
 * shadow run before launch tunes them further.
 */
export const DEFAULT_ALERT_RULES: AlertRules = {
  markDivergence: { minutes: 3, bps: { info: 200, warning: 300, critical: 1000 } },
  staleOracle: { minutes: 3, frozenMs: 60_000, bps: { info: 100, warning: 200 } },
  peerDivergence: { minutes: 3, bps: { info: 100, warning: 200 }, sameUnit: 0.2 },
  depthCollapse: {
    minutes: 5,
    gapMinutes: 5,
    baselineMinutes: 30,
    ratio: { info: 0.4, warning: 0.25 },
    maxDepthToOi: { info: 0.03, warning: 0.02 },
    minBaselineUsd: 100_000,
    minOiUsd: 500_000,
    oiHold: 0.9,
  },
  oiSurge: { minutes: 15, rise: 0.25, minAddUsd: 250_000, maxDepthToOi: 0.05 },
  oiCap: { share: 0.9 },
};

/** Minutes of history the minute detectors need; pass at least this many bars. */
export const ALERT_HISTORY_MINUTES = 45;

export interface AlertContext {
  coin: string;
  dex: string;
  oiCapUsd: number | null;
  /** Recent minute bars, oldest first. The last one is the minute being checked. */
  bars: readonly BarInput[];
  /** HIP-3 markets with the same ticker on other DEXs, with their recent bars. */
  peers: readonly PeerInput[];
}

const MINUTE = 60_000;

/** The last `n` bars, or `null` unless they are `n` consecutive minutes. */
function lastMinutes(bars: readonly BarInput[], n: number): BarInput[] | null {
  if (bars.length < n) return null;
  const out = bars.slice(-n);
  for (let i = 1; i < out.length; i++) if (out[i]!.ts - out[i - 1]!.ts !== MINUTE) return null;
  return out;
}

const gapBps = (a: number | null, b: number | null): number | null => (a === null || b === null || b <= 0 ? null : (Math.abs(a - b) / b) * 10_000);
const depth2 = (b: BarInput): number | null => (b.bidDepth2 === null || b.askDepth2 === null ? null : b.bidDepth2 + b.askDepth2);
const oiUsd = (b: BarInput): number | null => (b.openInterest === null || b.markPx === null ? null : b.openInterest * b.markPx);

/** The highest severity whose threshold every value meets, if any. */
function levelOf<S extends Severity>(values: readonly (number | null)[], thresholds: Record<S, number>): S | null {
  if (values.some((v) => v === null)) return null;
  const least = Math.min(...(values as number[]));
  let best: S | null = null;
  for (const [s, t] of Object.entries(thresholds) as [S, number][]) {
    if (least >= t && (best === null || severityRank(s) > severityRank(best))) best = s;
  }
  return best;
}

function markDivergence(ctx: AlertContext, rules: AlertRules): Signal | null {
  const { minutes, bps: thresholds } = rules.markDivergence;
  const bars = lastMinutes(ctx.bars, minutes);
  if (!bars) return null;
  const gaps = bars.map((b) => gapBps(b.markPx, b.oraclePx));
  const severity = levelOf(gaps, thresholds);
  if (!severity) return null;
  const now = bars.at(-1)!;
  const gap = gaps.at(-1)!;
  return {
    kind: "mark-divergence",
    coin: ctx.coin,
    dex: ctx.dex,
    severity,
    at: now.ts,
    title: `Mark price ${pct(gap / 10_000)} from the oracle`,
    detail:
      `The mark price has been at least ${bps(Math.min(...(gaps as number[])))} from the oracle for ${minutes} minutes ` +
      `(mark ${price(now.markPx!)}, oracle ${price(now.oraclePx!)}). Liquidations use the mark price.`,
    evidence: { gapBps: round(gap), markPx: now.markPx, oraclePx: now.oraclePx, minutes },
  };
}

function staleOracle(ctx: AlertContext, rules: AlertRules): Signal | null {
  const { minutes, frozenMs, bps: thresholds } = rules.staleOracle;
  const bars = lastMinutes(ctx.bars, minutes);
  // Only markets with a per-market stream report how long the oracle stayed unchanged.
  if (!bars || bars.some((b) => b.oracleMaxGapMs === null || b.oracleMaxGapMs < frozenMs)) return null;
  const gaps = bars.map((b) => gapBps(b.midPx, b.oraclePx));
  const severity = levelOf(gaps, thresholds);
  if (!severity) return null;
  const now = bars.at(-1)!;
  const frozen = now.oracleMaxGapMs!;
  const gap = gaps.at(-1)!;
  return {
    kind: "stale-oracle",
    coin: ctx.coin,
    dex: ctx.dex,
    severity,
    at: now.ts,
    title: `Oracle unchanged for ${duration(frozen)} with the market ${pct(gap / 10_000)} away`,
    detail:
      `The oracle price has stayed at ${price(now.oraclePx!)} for ${duration(frozen)} while the mid price moved to ${price(now.midPx!)}, ` +
      `${bps(gap)} away. That can be normal when the underlying market is closed.`,
    evidence: { frozenMs: frozen, gapBps: round(gap), oraclePx: now.oraclePx, midPx: now.midPx },
  };
}

function peerDivergence(ctx: AlertContext, rules: AlertRules): Signal | null {
  const { minutes, bps: thresholds, sameUnit } = rules.peerDivergence;
  const bars = lastMinutes(ctx.bars, minutes);
  if (!bars) return null;
  let worst: { coin: string; severity: "info" | "warning"; gap: number; px: number } | null = null;
  for (const peer of ctx.peers) {
    // One alert per pair: only the market whose name sorts first reports it.
    if (peer.coin < ctx.coin) continue;
    const theirs = new Map(peer.bars.map((b) => [b.ts, b.oraclePx]));
    const gaps = bars.map((b) => {
      const other = theirs.get(b.ts) ?? null;
      // A peer quoting a different unit (a share split, a basket) isn't a disagreement.
      if (b.oraclePx === null || other === null || other <= 0 || Math.abs(b.oraclePx / other - 1) > sameUnit) return null;
      return gapBps(b.oraclePx, other);
    });
    const severity = levelOf(gaps, thresholds);
    if (severity && (!worst || gaps.at(-1)! > worst.gap)) worst = { coin: peer.coin, severity, gap: gaps.at(-1)!, px: theirs.get(bars.at(-1)!.ts)! };
  }
  if (!worst) return null;
  const now = bars.at(-1)!;
  return {
    kind: "peer-divergence",
    coin: ctx.coin,
    dex: ctx.dex,
    severity: worst.severity,
    at: now.ts,
    title: `Oracle ${pct(worst.gap / 10_000)} from ${worst.coin}`,
    detail:
      `${ctx.coin} and ${worst.coin} list the same asset, and their oracles have been at least ${bps(thresholds[worst.severity])} apart ` +
      `for ${minutes} minutes (${price(now.oraclePx!)} against ${price(worst.px)}).`,
    evidence: { peer: worst.coin, gapBps: round(worst.gap), oraclePx: now.oraclePx, peerOraclePx: worst.px },
  };
}

function depthCollapse(ctx: AlertContext, rules: AlertRules): Signal | null {
  const r = rules.depthCollapse;
  const span = r.baselineMinutes + r.gapMinutes + r.minutes;
  const bars = lastMinutes(ctx.bars, span);
  if (!bars) return null;
  const baseline = median(bars.slice(0, r.baselineMinutes).map(depth2));
  const before = bars[r.baselineMinutes + r.gapMinutes - 1]!;
  const window = bars.slice(-r.minutes);
  const now = window.at(-1)!;
  const depths = window.map(depth2);
  const oiNow = oiUsd(now);
  if (baseline === null || baseline < r.minBaselineUsd || oiNow === null || oiNow < r.minOiUsd) return null;
  if (depths.some((d) => d === null)) return null;
  if (now.openInterest === null || before.openInterest === null || now.openInterest < r.oiHold * before.openInterest) return null;
  // The deepest minute decides: every checked minute must be past the level's limits.
  const deepest = Math.max(...(depths as number[]));
  const meets = (s: "info" | "warning") => deepest < r.ratio[s] * baseline && deepest / oiNow < r.maxDepthToOi[s];
  const severity = meets("warning") ? "warning" : meets("info") ? "info" : null;
  if (!severity) return null;
  const current = depths.at(-1)!;
  return {
    kind: "depth-collapse",
    coin: ctx.coin,
    dex: ctx.dex,
    severity,
    at: now.ts,
    title: `Order book within ±2% down ${pct(1 - current / baseline)}`,
    detail:
      `The USD resting within ±2% of mid fell from ${usd(baseline)} to ${usd(current)} and has stayed below ${pct(r.ratio[severity])} of that ` +
      `for ${r.minutes} minutes, while open interest held at ${usd(oiNow)}. What's left is ${pct(current / oiNow)} of open interest.`,
    evidence: { baselineUsd: Math.round(baseline), depthUsd: Math.round(current), oiUsd: Math.round(oiNow) },
  };
}

function oiSurge(ctx: AlertContext, rules: AlertRules): Signal | null {
  const r = rules.oiSurge;
  const bars = lastMinutes(ctx.bars, r.minutes + 1);
  if (!bars) return null;
  const from = oiUsd(bars[0]!);
  const now = bars.at(-1)!;
  const to = oiUsd(now);
  const d = depth2(now);
  if (from === null || to === null || d === null || from <= 0) return null;
  if (to < from * (1 + r.rise) || to - from < r.minAddUsd || d / to >= r.maxDepthToOi) return null;
  return {
    kind: "oi-surge",
    coin: ctx.coin,
    dex: ctx.dex,
    severity: "warning",
    at: now.ts,
    title: `Open interest up ${pct(to / from - 1)} in ${r.minutes} minutes`,
    detail:
      `Open interest rose from ${usd(from)} to ${usd(to)} in ${r.minutes} minutes, in a market with ${usd(d)} ` +
      `within ±2% of mid (${pct(d / to)} of open interest).`,
    evidence: { fromUsd: Math.round(from), toUsd: Math.round(to), depthUsd: Math.round(d) },
  };
}

function oiCap(ctx: AlertContext, rules: AlertRules): Signal | null {
  const now = ctx.bars.at(-1);
  const oi = now ? oiUsd(now) : null;
  if (!now || oi === null || !ctx.oiCapUsd || oi < rules.oiCap.share * ctx.oiCapUsd) return null;
  return {
    kind: "oi-cap",
    coin: ctx.coin,
    dex: ctx.dex,
    severity: "info",
    at: now.ts,
    title: `Open interest at ${pct(oi / ctx.oiCapUsd)} of its cap`,
    detail: `Open interest is ${usd(oi)} against a cap of ${usd(ctx.oiCapUsd)}. New positions may be refused once the cap is reached.`,
    evidence: { oiUsd: Math.round(oi), capUsd: ctx.oiCapUsd },
  };
}

const MINUTE_DETECTORS = [markDivergence, staleOracle, peerDivergence, depthCollapse, oiSurge, oiCap];

/** Every minute detector's signal for the latest bar of one market. */
export function detectMinute(ctx: AlertContext, rules: AlertRules = DEFAULT_ALERT_RULES): Signal[] {
  if (ctx.bars.length === 0) return [];
  return MINUTE_DETECTORS.map((d) => d(ctx, rules)).filter((s): s is Signal => s !== null);
}

const round = (n: number): number => Math.round(n * 10) / 10;
