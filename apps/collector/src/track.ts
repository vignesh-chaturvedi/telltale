// The track record: what each warning was followed by. Once the hour after a warning (or critical
// alert) about a market is over, the largest move of the market's mid price in that hour is ranked
// against the same measure for the market's own hours over the 7 days before the alert. The same
// hour on each of the 3 days before is ranked the same way, as a control: it says how often a
// top-tenth hour turns up anyway at that time of day, when markets open or news is due.
import type { AlertKind, Severity } from "@telltale/detectors";
import type { TrackAlert, TrackKind, TrackRecord } from "./api-types.ts";

const MINUTE = 60_000;
const DAY = 1_440 * MINUTE;

export const TRACK = {
  /** The hour after an alert, in minutes. */
  hourMinutes: 60,
  /** Minutes of an hour that need a mid price for the hour to count. */
  minCoverage: 40,
  /** The start price may come from up to this many minutes before the start, if that minute is missing. */
  startSlackMinutes: 2,
  /** Days of the market's own hours to rank against. */
  baselineDays: 7,
  /** Minutes between the starts of baseline hours, so they overlap: 4 an hour. */
  strideMinutes: 15,
  /** Baseline hours needed for a rank: about a day's worth. */
  minBaseline: 96,
  /** Control hours: the same time of day, this many days earlier. */
  controlDays: [1, 2, 3],
  /** An hour at or above this rank is one of the market's most volatile tenth. */
  topRank: 0.9,
  /** Measured alerts listed in the record, newest first. */
  recent: 6,
} as const;

/** Mid prices by the start of their minute (epoch ms). */
export type MidSeries = ReadonlyMap<number, number>;

/** What happened in the hour after one alert. */
export interface Outcome {
  /** Largest move of the mid price from the alert's minute, in percent. */
  movePct: number;
  /** The median of the same measure over the market's baseline hours, in percent. */
  usualPct: number;
  /** Share of baseline hours with a smaller move, 0 to 1. */
  rank: number;
  baselineHours: number;
  /** Ranks of the control hours that could be measured. */
  controlRanks: number[];
}

/** The minutes `measureOutcome` reads for an alert started at `startedAt`. */
export function outcomeWindow(startedAt: number): { from: number; to: number } {
  const start = Math.floor(startedAt / MINUTE) * MINUTE;
  const back = (Math.max(...TRACK.controlDays) + TRACK.baselineDays) * DAY + TRACK.startSlackMinutes * MINUTE;
  return { from: start - back, to: start + TRACK.hourMinutes * MINUTE };
}

/** The largest move from the price at `start` over the next hour, as a fraction, or `null` when too little of it was recorded. */
export function hourMove(mids: MidSeries, start: number): number | null {
  let from: number | undefined;
  for (let k = 0; k <= TRACK.startSlackMinutes && from === undefined; k++) from = mids.get(start - k * MINUTE);
  if (!from) return null;
  let largest = 0;
  let seen = 0;
  for (let k = 1; k <= TRACK.hourMinutes; k++) {
    const px = mids.get(start + k * MINUTE);
    if (px === undefined) continue;
    seen++;
    largest = Math.max(largest, Math.abs(px / from - 1));
  }
  return seen >= TRACK.minCoverage ? largest : null;
}

/**
 * Ranks the hour from `start` against the market's hours over the baseline days before it. Moves
 * are cached by start minute, since the alert's and the controls' baselines share most hours.
 */
function hourRank(mids: MidSeries, start: number, cache: Map<number, number | null>): Omit<Outcome, "controlRanks"> | null {
  const move = (t: number) => {
    if (!cache.has(t)) cache.set(t, hourMove(mids, t));
    return cache.get(t)!;
  };
  const own = move(start);
  if (own === null) return null;
  const baseline: number[] = [];
  const first = start - TRACK.baselineDays * DAY;
  // Only hours that are over before this one starts, so nothing from after it leaks in.
  for (let t = start - TRACK.hourMinutes * MINUTE; t >= first; t -= TRACK.strideMinutes * MINUTE) {
    const m = move(t);
    if (m !== null) baseline.push(m);
  }
  if (baseline.length < TRACK.minBaseline) return null;
  baseline.sort((a, b) => a - b);
  return {
    movePct: own * 100,
    usualPct: baseline[Math.floor(baseline.length / 2)]! * 100,
    rank: baseline.filter((m) => m < own).length / baseline.length,
    baselineHours: baseline.length,
  };
}

/** Measures the hour after an alert, or returns `null` when the market's data can't support it. */
export function measureOutcome(mids: MidSeries, startedAt: number): Outcome | null {
  const start = Math.floor(startedAt / MINUTE) * MINUTE;
  const cache = new Map<number, number | null>();
  const own = hourRank(mids, start, cache);
  if (!own) return null;
  const controlRanks = TRACK.controlDays.flatMap((d) => {
    const r = hourRank(mids, start - d * DAY, cache);
    return r ? [r.rank] : [];
  });
  return { ...own, controlRanks };
}

/** One warning about a market, with its outcome if it has been measured. */
export interface TrackRow {
  id: number;
  kind: AlertKind;
  coin: string;
  severity: Severity;
  startedAt: number;
  title: string;
  /** `undefined` until the hour is over and measured; `null` when it couldn't be. */
  outcome: Outcome | null | undefined;
}

const tally = (rows: readonly TrackRow[]): Omit<TrackKind, "kind"> => {
  const measured = rows.flatMap((r) => (r.outcome ? [r.outcome] : []));
  const controls = measured.flatMap((o) => o.controlRanks);
  return {
    alerts: rows.length,
    measured: measured.length,
    followed: measured.filter((o) => o.rank >= TRACK.topRank).length,
    controlHours: controls.length,
    controlFollowed: controls.filter((r) => r >= TRACK.topRank).length,
  };
};

/** Totals, a breakdown by kind and the latest measured alerts. Rows can come in any order. */
export function summarizeTrack(rows: readonly TrackRow[], at: { generatedAt: number; liveSince: number | null; alertsSince: number }): TrackRecord {
  const byKind = new Map<AlertKind, TrackRow[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const kinds = [...byKind].map(([kind, list]) => ({ kind, ...tally(list) })).sort((a, b) => b.alerts - a.alerts || a.kind.localeCompare(b.kind));
  const recent: TrackAlert[] = rows
    .filter((r) => r.outcome)
    .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
    .slice(0, TRACK.recent)
    .map(({ id, kind, coin, severity, startedAt, title, outcome }) => ({ id, kind, coin, severity, startedAt, title, movePct: outcome!.movePct, usualPct: outcome!.usualPct, rank: outcome!.rank }));
  return {
    public: true,
    ...at,
    topRank: TRACK.topRank,
    totals: { ...tally(rows), pending: rows.filter((r) => r.outcome === undefined).length },
    kinds,
    recent,
  };
}
