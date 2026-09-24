// Reports what the collector has stored: `pnpm collect:status [--db path] [--minutes n]`.
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: process.env.TELLTALE_DB ?? "data/telltale.db" },
    minutes: { type: "string", default: "10" },
  },
});

if (!existsSync(values.db)) {
  console.log(`No database at ${values.db}. Start the collector with \`pnpm collect\` first.`);
  process.exit(1);
}
const db = new DatabaseSync(values.db, { readOnly: true });
const one = <T>(sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args) as T;
const all = <T>(sql: string, ...args: (number | string)[]) => db.prepare(sql).all(...args) as T[];
const size = (p: string) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};

const live = one<{ n: number }>("SELECT count(*) AS n FROM markets WHERE is_delisted = 0").n;
const span = one<{ first: number | null; last: number | null; bars: number }>(
  "SELECT min(ts) AS first, max(ts) AS last, count(*) AS bars FROM minute_bars",
);
if (span.last === null || span.first === null) {
  console.log(`No bars yet in ${values.db}.`);
  process.exit(0);
}
const bytes = size(values.db) + size(`${values.db}-wal`);
const hours = (span.last - span.first + 60_000) / 3_600_000;
const mb = bytes / 1e6;
// Bars are what grows; the rest (markets, config snapshots) is roughly fixed.
let barBytes: number | null = null;
try {
  barBytes = one<{ b: number }>("SELECT sum(pgsize) AS b FROM dbstat WHERE name IN ('minute_bars', 'minute_bars_ts')").b;
} catch {
  // dbstat isn't compiled into every SQLite build.
}

console.log(`Database  ${values.db}  ${mb.toFixed(1)} MB`);
console.log(
  `Covered   ${new Date(span.first).toISOString()} → ${new Date(span.last + 60_000).toISOString()} (${hours.toFixed(2)} h, ${span.bars} bars)`,
);
const growth = ((barBytes ?? bytes) / 1e6 / hours) * 24;
console.log(`Growth    ${growth.toFixed(0)} MB/day at the current rate${barBytes === null ? " (whole file)" : " (minute bars and their index)"}`);
console.log(`Markets   ${live} live\n`);

const window = Number(values.minutes);
const since = span.last - (window - 1) * 60_000;
const perMinute = all<{ ts: number; bars: number; ctx: number; stream_ctx: number; book: number; stream_book: number; trades: number }>(
  `SELECT ts, count(*) AS bars,
     sum(ctx_source IS NOT NULL) AS ctx, sum(ctx_source = 'stream') AS stream_ctx,
     sum(book_source IS NOT NULL) AS book, sum(book_source = 'stream') AS stream_book, sum(trades) AS trades
   FROM minute_bars WHERE ts >= ? GROUP BY ts ORDER BY ts`,
  since,
);
console.log("Minute (UTC)  bars    ctx   streamed-ctx  book   streamed-book  trades");
for (const r of perMinute) {
  const pct = ((r.bars / live) * 100).toFixed(0).padStart(3);
  console.log(
    `${new Date(r.ts).toISOString().slice(11, 16)}         ${String(r.bars).padStart(4)} ${pct}%  ${String(r.ctx).padStart(4)}  ${String(r.stream_ctx).padStart(8)}      ${String(r.book).padStart(4)}  ${String(r.stream_book).padStart(9)}      ${String(r.trades).padStart(6)}`,
  );
}

const missing = all<{ coin: string }>(
  `SELECT coin FROM markets WHERE is_delisted = 0
   AND coin NOT IN (SELECT coin FROM minute_bars WHERE ts >= ? AND book_source IS NOT NULL) ORDER BY coin`,
  since,
);
console.log(`\nLive markets without any book in the last ${window} min: ${missing.length}`);
if (missing.length) console.log(`  ${missing.slice(0, 30).map((m) => m.coin).join(", ")}${missing.length > 30 ? ", …" : ""}`);

const gaps = all<{ connection: number; started_at: number; ended_at: number; subscriptions: number; reason: string }>(
  "SELECT * FROM ws_gaps ORDER BY started_at DESC LIMIT 10",
);
const gapCount = one<{ n: number; secs: number | null }>("SELECT count(*) AS n, sum(ended_at - started_at) / 1000.0 AS secs FROM ws_gaps");
console.log(`\nWebSocket gaps: ${gapCount.n}${gapCount.n ? `, ${gapCount.secs!.toFixed(1)} s in total` : ""}`);
for (const g of gaps) {
  console.log(
    `  ${new Date(g.started_at).toISOString().slice(11, 19)} ws ${g.connection}: ${((g.ended_at - g.started_at) / 1000).toFixed(1)} s, ${g.subscriptions} subs (${g.reason})`,
  );
}

const h = one<{ ws_open: number; ws_connections: number; subscriptions: number; ws_received: number; rest_weight: number } | undefined>(
  "SELECT * FROM health ORDER BY ts DESC LIMIT 1",
);
if (h) {
  console.log(
    `\nLast minute: ws ${h.ws_open}/${h.ws_connections} open, ${h.subscriptions} subscriptions, ${h.ws_received} messages, REST weight ${h.rest_weight}/min`,
  );
}
const changes = all<{ dex: string; n: number }>("SELECT dex, count(*) AS n FROM config_snapshots GROUP BY dex HAVING n > 1");
if (changes.length) console.log(`Config changes seen: ${changes.map((c) => `${c.dex || "core"} ×${c.n - 1}`).join(", ")}`);
db.close();
