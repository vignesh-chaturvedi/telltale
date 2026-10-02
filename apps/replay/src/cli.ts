// Replays past incidents: `pnpm replay [popcat-2025-11 | fartcoin-2026-04 ...]` (all by default).
// Downloads what's missing into data/replay/ (requester-pays S3, a few cents), runs the live
// detectors over it, and writes apps/web/public/replays/<id>.json for the website.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { download } from "./archive.ts";
import { INCIDENTS, incident } from "./incidents.ts";
import { runReplay } from "./replay.ts";
import type { ReplayResult, ReplaySummary } from "./types.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: "string", default: "data/replay" },
    out: { type: "string", default: "apps/web/public/replays" },
  },
});

const ids = positionals.length ? positionals : INCIDENTS.map((i) => i.id);
const log = (line: string) => console.log(`  ${line}`);
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);
mkdirSync(values.out, { recursive: true });

for (const id of ids) {
  const i = incident(id);
  if (!i) throw new Error(`Unknown incident ${id}. Known: ${INCIDENTS.map((x) => x.id).join(", ")}`);
  console.log(`${i.name}, ${i.date}`);
  const paths = await download(i, values.data, log);
  const started = performance.now();
  const r = await runReplay(i, paths);
  writeFileSync(join(values.out, `${i.id}.json`), `${JSON.stringify(r)}\n`);
  console.log(`  replayed ${r.minutes.length} minutes in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  crash: the steepest one-minute fall (${r.crashMovePct}%) began at ${hhmm(r.crashAt)} UTC`);
  console.log(
    r.firstWarning
      ? `  first warning: ${hhmm(r.firstWarning.startedAt)} UTC, ${r.leadMinutes} minutes before the crash: ${r.firstWarning.title}`
      : "  no warning before the crash",
  );
  for (const a of r.alerts) console.log(`    ${hhmm(a.startedAt)} ${a.severity.padEnd(8)} ${a.kind.padEnd(16)} ${a.first.title}`);
  for (const d of r.depthSensitivity) {
    const when = d.firstAt === null ? "never" : `${hhmm(d.firstAt)} UTC${d.leadMinutes === null ? ", after the crash" : `, ${d.leadMinutes} min ahead`}`;
    console.log(`  surge alert with ${String(d.multiple).padStart(2)}× the archived depth: ${when}`);
  }
  const liquidated = r.liquidations.reduce((s, l) => s + l.usd, 0);
  const backstop = r.liquidations.reduce((s, l) => s + l.backstopUsd, 0);
  console.log(`  liquidations in the window: $${(liquidated / 1e6).toFixed(1)}M, of which $${(backstop / 1e6).toFixed(1)}M taken over by the backstop`);
  console.log(`  pulled walls of $250K+ seen: ${r.pulledWalls.length}`);
  console.log(`  wrote ${join(values.out, `${i.id}.json`)}\n`);
}

// The list page reads one small index rather than every replay.
const summaries: ReplaySummary[] = readdirSync(values.out)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .map((f) => JSON.parse(readFileSync(join(values.out, f), "utf8")) as ReplayResult)
  .map((r) => ({ id: r.id, name: r.name, date: r.date, lossUsd: r.lossUsd, crashAt: r.crashAt, leadMinutes: r.leadMinutes, firstWarning: r.firstWarning?.first.title ?? null }))
  .sort((a, b) => b.crashAt - a.crashAt);
writeFileSync(join(values.out, "index.json"), `${JSON.stringify(summaries, null, 2)}\n`);
console.log(`index of ${summaries.length} replays written`);
