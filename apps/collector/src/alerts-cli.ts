// Reviews alerts: `pnpm alerts [--hours 24]` lists what was recorded, and `pnpm alerts --replay`
// runs the detectors over the stored minutes, as the collector would have, without sending
// anything. Pulled walls need live order books, so replays leave them out.
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { SEVERITIES, severityRank, type BarInput } from "@telltale/detectors";
import { MemoryAlertStore } from "./alerts.ts";
import { BAR_COLUMNS } from "./scoring.ts";
import { toAlert, type AlertRecord, type ConfigUpdate } from "./store.ts";
import { Watch } from "./watch.ts";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: process.env.TELLTALE_DB ?? "data/telltale.db" },
    hours: { type: "string" },
    replay: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
  },
});

const db = new DatabaseSync(values.db, { readOnly: true });
const hhmm = (t: number) => new Date(t).toISOString().slice(5, 16).replace("T", " ");

function summarize(alerts: readonly AlertRecord[], minutes: number, from: number, to: number, note: string): void {
  const days = minutes / 1440;
  console.log(`${note}: ${minutes.toLocaleString("en-US")} minutes (${(minutes / 60).toFixed(1)} h), ${hhmm(from)} → ${hhmm(to)} UTC\n`);
  const kinds = [...new Set(alerts.map((a) => a.kind))].sort();
  console.log(`${"Kind".padEnd(18)}${SEVERITIES.map((s) => s.padStart(10)).join("")}${"sent a day".padStart(13)}`);
  for (const k of kinds) {
    const of = alerts.filter((a) => a.kind === k);
    const loud = of.filter((a) => a.severity !== "info").length;
    console.log(`${k.padEnd(18)}${SEVERITIES.map((s) => String(of.filter((a) => a.severity === s).length).padStart(10)).join("")}${(loud / days).toFixed(1).padStart(13)}`);
  }
  const loud = alerts.filter((a) => a.severity !== "info");
  console.log(`\n${alerts.length} alerts, ${loud.length} of them warnings or worse: ${(loud.length / days).toFixed(1)} a day would be sent.\n`);
  const shown = values.all ? alerts : loud;
  if (shown.length) console.log(values.all ? "All alerts:" : "Warnings and worse (--all lists information too):");
  for (const a of [...shown].sort((x, y) => x.startedAt - y.startedAt)) {
    const lasted = a.resolvedAt === null ? "open" : a.minutes > 1 ? `${a.minutes} min` : "";
    const sent = a.publishedAt ? " sent" : "";
    console.log(`  ${hhmm(a.startedAt)}  ${a.severity.padEnd(8)} ${(a.coin ?? (a.dex || "core")).padEnd(16)} ${a.title}  ${lasted}${sent}`);
    if (values.all || severityRank(a.severity) >= 1) console.log(`${" ".repeat(20)}${a.detail}`);
  }
}

if (values.replay) {
  const span = db.prepare("SELECT min(ts) AS a, max(ts) AS b FROM minute_bars").get() as { a: number | null; b: number | null };
  if (span.b === null) throw new Error(`No minute bars in ${values.db}.`);
  const from = values.hours ? Math.max(span.a!, span.b - Number(values.hours) * 3_600_000) : span.a!;
  const store = new MemoryAlertStore();
  let now = from;
  const watch = new Watch({ alerts: store, sinks: [], publish: false, log: () => {}, now: () => now });
  watch.setMarkets(db.prepare("SELECT coin, dex, oi_cap_usd AS oiCapUsd FROM markets WHERE is_delisted = 0").all() as never);

  const snapshots = db.prepare("SELECT dex, ts, body FROM config_snapshots ORDER BY ts").all() as { dex: string; ts: number; body: string }[];
  const names = new Map((db.prepare("SELECT name, full_name AS fullName FROM dexes").all() as { name: string; fullName: string }[]).map((d) => [d.name, d.fullName]));
  const lastBody = new Map<string, string>();
  let next = 0;
  let minutes = 0;
  let minute: (BarInput & { coin: string })[] = [];
  const check = () => {
    if (!minute.length) return;
    now = minute[0]!.ts;
    for (; next < snapshots.length && snapshots[next]!.ts <= now + 60_000; next++) {
      const s = snapshots[next]!;
      const before = lastBody.get(s.dex) ?? null;
      lastBody.set(s.dex, s.body);
      if (s.ts >= from) watch.onConfigUpdates([{ dex: s.dex, fullName: names.get(s.dex) ?? s.dex, before, after: s.body } satisfies ConfigUpdate], s.ts);
    }
    watch.addBars(minute);
    watch.checkMinute(now);
    minutes++;
    minute = [];
  };
  for (const row of db.prepare(`SELECT coin, ${BAR_COLUMNS} FROM minute_bars WHERE ts >= ? ORDER BY ts`).iterate(from - 45 * 60_000)) {
    const bar = row as unknown as BarInput & { coin: string };
    if (minute.length && bar.ts !== minute[0]!.ts) check();
    minute.push(bar);
  }
  check();
  const shown = store.alerts.filter((a) => a.startedAt >= from);
  summarize(shown, minutes, from, span.b, "Replayed");
  console.log(`\n${watch.engine.stats.suppressed} repeats were held back by the 12-hour cooldown. Pulled walls need live books and aren't replayed.`);
} else {
  const hours = Number(values.hours ?? 24);
  const since = Date.now() - hours * 3_600_000;
  const rows = db.prepare("SELECT *, started_at AS startedAt, updated_at AS updatedAt, resolved_at AS resolvedAt, published_at AS publishedAt FROM alerts WHERE started_at >= ? ORDER BY started_at").all(since);
  const alerts = rows.map((r) => toAlert(r as Record<string, unknown>));
  const covered = db.prepare("SELECT count(DISTINCT ts) AS n, min(ts) AS a, max(ts) AS b FROM minute_bars WHERE ts >= ?").get(since) as { n: number; a: number; b: number };
  summarize(alerts, Math.max(1, covered.n), covered.a ?? since, covered.b ?? Date.now(), "Recorded");
  const walls = db
    .prepare("SELECT kind, count(*) AS n, sum(peak_usd) AS usd FROM book_events WHERE ts >= ? GROUP BY kind ORDER BY kind")
    .all(since) as { kind: string; n: number; usd: number }[];
  if (walls.length) console.log(`\nOrder-book walls: ${walls.map((w) => `${w.n} ${w.kind}`).join(", ")}.`);
}
