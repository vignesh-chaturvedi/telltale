// Reports traction: `pnpm traffic [--logs /var/log/caddy] [--db path]`. Visits come from Caddy's
// access logs, subscribers from Telegram (when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set)
// and alerts sent from the database. On the server the logs are readable by root only:
//   sudo node --env-file=/etc/telltale.env /opt/telltale/apps/collector/src/traffic-cli.ts --db /var/lib/telltale/telltale.db
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { summarizeTraffic } from "./traffic.ts";

const { values } = parseArgs({
  options: {
    logs: { type: "string", default: "/var/log/caddy" },
    db: { type: "string", default: process.env.TELLTALE_DB ?? "data/telltale.db" },
  },
});

function* logLines(dir: string): Generator<string> {
  // telltale.log plus Caddy's rolled files, telltale-<time>.log.gz.
  for (const f of readdirSync(dir).filter((f) => /^telltale.*\.log(\.gz)?$/.test(f)).sort()) {
    const raw = readFileSync(join(dir, f));
    yield* (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8").split("\n");
  }
}

if (existsSync(values.logs)) {
  const t = summarizeTraffic(logLines(values.logs));
  console.log(`Visits (browsers only, scanners and bots left out)\n`);
  console.log(`${"Day".padEnd(12)}${"Visitors".padStart(9)}${"Page loads".padStart(12)}${"Badge loads".padStart(13)}${"API calls".padStart(11)}`);
  for (const d of t.days) {
    console.log(`${d.day.padEnd(12)}${String(d.visitors).padStart(9)}${String(d.pageLoads).padStart(12)}${String(d.badgeLoads).padStart(13)}${String(d.apiCalls).padStart(11)}`);
  }
  const list = (pairs: [string, number][]) => (pairs.length ? pairs.slice(0, 10).map(([h, n]) => `${h} ${n}`).join(", ") : "none yet");
  console.log(`\nReferrers: ${list(t.referrers)}`);
  console.log(`Badges shown on: ${list(t.badgeHosts)}`);
  console.log(`"API calls" are requests from outside the site's own pages, health checks excluded.`);
} else {
  console.log(`No access logs at ${values.logs}; skipping visits.`);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
if (token && chat) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chat)}`, { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as { ok: boolean; result?: number };
    // The count includes the bot itself.
    console.log(`\nTelegram ${chat}: ${body.ok ? `${body.result} members` : `couldn't read the count (HTTP ${res.status})`}`);
  } catch {
    console.log(`\nTelegram ${chat}: couldn't reach Telegram.`);
  }
}

if (existsSync(values.db)) {
  const db = new DatabaseSync(values.db, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT date(published_at / 1000, 'unixepoch') AS day, severity, count(*) AS n
         FROM alerts WHERE published_at IS NOT NULL GROUP BY day, severity ORDER BY day`,
      )
      .all() as { day: string; severity: string; n: number }[];
    const total = rows.reduce((s, r) => s + r.n, 0);
    console.log(`\nAlerts sent: ${total}`);
    const byDay = Map.groupBy(rows, (r) => r.day);
    for (const [day, rs] of byDay) console.log(`  ${day}  ${rs.map((r) => `${r.n} ${r.severity}`).join(", ")}`);
  } catch {
    console.log("\nNo alerts table yet.");
  } finally {
    db.close();
  }
}
