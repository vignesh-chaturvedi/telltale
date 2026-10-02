// Runs an incident through the same Watch the live collector uses: minute bars into the minute
// detectors, order-book snapshots into the wall tracker, everything through the alert engine.
// Then it measures how long before the crash the first warning came, or says that none did.
import { ALERT_HISTORY_MINUTES, detectMinute, summarizeBook, toLevels, type BarInput } from "@telltale/detectors";
import { MemoryAlertStore } from "@telltale/collector/alerts";
import { Watch } from "@telltale/collector/watch";
import type { Paths } from "./archive.ts";
import type { Incident } from "./incidents.ts";
import { readBooks, readContexts, readLiquidations, type ContextRow, type Snapshot } from "./load.ts";
import type { ReplayAlert, ReplayResult } from "./types.ts";

/** The live collector sees a streamed book about every 5 s; Hyperliquid's archive has about two a second. */
const SAMPLE_MS = 5_000;

/** One minute bar from the archived context and that minute's book snapshots. */
export function barOf(row: ContextRow, snapshots: readonly Snapshot[]): BarInput {
  const summaries = snapshots.map((s) => summarizeBook(toLevels(s.book.levels[0]), toLevels(s.book.levels[1])));
  const last = summaries.at(-1);
  const spreadBps = row.impactBid !== null && row.impactAsk !== null && row.midPx ? ((row.impactAsk - row.impactBid) / row.midPx) * 10_000 : null;
  return {
    ts: row.ts,
    oraclePx: row.oraclePx,
    markPx: row.markPx,
    midPx: row.midPx,
    openInterest: row.openInterest,
    dayNtlVlm: row.dayNtlVlm,
    spreadBps,
    // Oracle update timing isn't archived.
    oracleChanges: null,
    oracleMaxGapMs: null,
    bidDepth1: last ? last.bidDepth[1] : null,
    askDepth1: last ? last.askDepth[1] : null,
    bidDepth2: last ? last.bidDepth[2] : null,
    askDepth2: last ? last.askDepth[2] : null,
    bidDepth5: last ? last.bidDepth[5] : null,
    askDepth5: last ? last.askDepth[5] : null,
    minDepth2: summaries.length ? Math.min(...summaries.map((s) => s.bidDepth[2] + s.askDepth[2])) : null,
    reachPct: last ? last.reachPct : null,
  };
}

/** The start of the steepest one-minute fall in the mark price, and how far it fell. */
export function crashOf(rows: readonly ContextRow[]): { at: number; movePct: number } {
  let best = { at: rows[0]?.ts ?? 0, movePct: 0 };
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1]!;
    const b = rows[k]!;
    if (b.ts - a.ts !== 60_000) continue;
    const move = (b.markPx / a.markPx - 1) * 100;
    if (move < best.movePct) best = { at: a.ts, movePct: move };
  }
  return best;
}

/**
 * When the open-interest surge alert first fires with the book's depth scaled by each multiple.
 * Archived books show only the 20 best levels, so the real book was deeper; this shows how much
 * the timing depends on that.
 */
export function depthSensitivity(bars: readonly BarInput[], crashAt: number, multiples: readonly number[] = [1, 5, 10, 20]): ReplayResult["depthSensitivity"] {
  return multiples.map((multiple) => {
    const scaled = bars.map((b) => ({
      ...b,
      bidDepth2: b.bidDepth2 === null ? null : b.bidDepth2 * multiple,
      askDepth2: b.askDepth2 === null ? null : b.askDepth2 * multiple,
    }));
    let firstAt: number | null = null;
    for (let k = 0; k < scaled.length && firstAt === null; k++) {
      const window = scaled.slice(Math.max(0, k - ALERT_HISTORY_MINUTES + 1), k + 1);
      const surge = detectMinute({ coin: "", dex: "", oiCapUsd: null, bars: window, peers: [] }).find((s) => s.kind === "oi-surge");
      if (surge) firstAt = surge.at;
    }
    return { multiple, firstAt, leadMinutes: firstAt !== null && firstAt <= crashAt ? Math.round((crashAt - firstAt) / 60_000) : null };
  });
}

/** The first warning (or worse) before the crash, and how many minutes ahead of it. */
export function leadOf(alerts: readonly ReplayAlert[], crashAt: number): { first: ReplayAlert | null; minutes: number | null } {
  const first = alerts.filter((a) => a.severity !== "info" && a.startedAt <= crashAt).sort((a, b) => a.startedAt - b.startedAt)[0] ?? null;
  return { first, minutes: first ? Math.round((crashAt - first.startedAt) / 60_000) : null };
}

function limitsOf(i: Incident): string[] {
  const shared = [
    "Both archives keep only the 20 best price levels on each side, about ±0.2% of the price, so book depth here is a lower bound. The live collector groups prices so it sees past ±2%. Conditions that need a thin book (depth collapse, the open-interest surge) are judged on this partial view.",
    "Oracle update timing isn't archived, so the stale-oracle alert can't run. The other-deployer and open-interest-cap alerts don't apply to core markets.",
  ];
  return i.books === "reservoir"
    ? [...shared, "Reservoir keeps one book snapshot a minute, so a wall has to stand at least two minutes to be seen; the live collector sees one about every 5 seconds."]
    : [...shared, "Books are replayed one snapshot every 5 seconds, as the live collector sees them. A wall more than about 0.2% from the price, like the reported $20M order near $0.21, isn't in the archive."];
}

export async function runReplay(i: Incident, paths: Paths): Promise<ReplayResult> {
  const rows = readContexts(paths).filter((r) => r.ts >= i.from && r.ts < i.to);
  const store = new MemoryAlertStore();
  let now = i.from;
  const watch = new Watch({ alerts: store, sinks: [], publish: false, log: () => {}, now: () => now });
  watch.setMarkets([{ coin: i.coin, dex: "", oiCapUsd: null }]);

  const books = readBooks(i, paths)[Symbol.asyncIterator]();
  let next = await books.next();
  let lastFed = -Infinity;
  let last: Snapshot | null = null;
  const series: ReplayResult["minutes"] = [];
  const bars: BarInput[] = [];
  // Each alert as it first fired; the store keeps updating an open alert to its worst moment.
  const firsts = new Map<number, ReplayAlert["first"]>();
  const noteFirsts = () => {
    for (const a of store.alerts) if (!firsts.has(a.id)) firsts.set(a.id, { title: a.title, detail: a.detail, evidence: a.evidence });
  };
  for (const row of rows) {
    const minute: Snapshot[] = [];
    while (!next.done && next.value.at < row.ts + 60_000) {
      const s = next.value;
      if (s.at >= i.from) {
        if (s.at - lastFed >= SAMPLE_MS) {
          now = s.at;
          watch.onBook(s.book, s.at);
          noteFirsts();
          lastFed = s.at;
        }
        if (s.at >= row.ts) minute.push(s);
        last = s;
      }
      next = await books.next();
    }
    now = row.ts;
    const bar = barOf(row, minute.length ? minute : last ? [last] : []);
    watch.addBars([{ coin: i.coin, ...bar }]);
    watch.checkMinute(row.ts);
    noteFirsts();
    bars.push(bar);
    const depth = bar.bidDepth2 === null || bar.askDepth2 === null ? null : Math.round(bar.bidDepth2 + bar.askDepth2);
    series.push({ t: row.ts, mark: row.markPx, oracle: row.oraclePx, oiUsd: Math.round(row.openInterest * row.markPx), depth2Usd: depth });
  }

  const alerts: ReplayAlert[] = store.alerts.map(({ id, kind, severity, startedAt, resolvedAt, minutes, title, detail, evidence }) => ({
    kind,
    severity,
    startedAt,
    resolvedAt,
    minutes,
    title,
    detail,
    evidence,
    first: firsts.get(id)!,
  }));
  const crash = crashOf(rows);
  const lead = leadOf(alerts, crash.at);
  const walls = watch.takeBookEvents().filter((e) => e.kind === "pulled");
  return {
    id: i.id,
    coin: i.coin,
    name: i.name,
    date: i.date,
    summary: i.summary,
    sources: i.sources,
    lossUsd: i.lossUsd,
    books: i.books,
    from: i.from,
    to: i.to,
    crashAt: crash.at,
    crashMovePct: Math.round(crash.movePct * 10) / 10,
    firstWarning: lead.first,
    leadMinutes: lead.minutes,
    minutes: series,
    liquidations: await readLiquidations(i, paths),
    alerts,
    depthSensitivity: depthSensitivity(bars, crash.at),
    pulledWalls: walls.map(({ side, px, peakUsd, sideDepthUsd, firstSeen, at, typicalUsd }) => ({ side, px, peakUsd, sideDepthUsd, firstSeen, at, typicalUsd })),
    limits: limitsOf(i),
    generatedAt: Date.now(),
  };
}
