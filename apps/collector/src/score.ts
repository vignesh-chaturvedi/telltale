// Prints the ratings board: `pnpm score [--window 60] [--dex xyz] [--coin xyz:SP500] [--json]`.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { GRADE_NAMES, type Grade } from "@telltale/detectors";
import { scoreDatabase, type ScoredMarket } from "./scoring.ts";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: process.env.TELLTALE_DB ?? "data/telltale.db" },
    window: { type: "string", default: "60" },
    dex: { type: "string" },
    coin: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!existsSync(values.db)) {
  console.log(`No database at ${values.db}. Start the collector with \`pnpm collect\` first.`);
  process.exit(1);
}
const db = new DatabaseSync(values.db, { readOnly: true });
const card = scoreDatabase(db, { windowMinutes: Number(values.window), minCoverageMinutes: Math.min(20, Number(values.window)) });
db.close();


const usd = (n: number | null): string =>
  n === null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
const fixed = (n: number | null, digits = 0, suffix = ""): string => (n === null ? "—" : `${n.toFixed(digits)}${suffix}`);
const g = (grade: Grade | null | undefined): string => grade ?? "–";
const time = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

// Output is written without process.exit(), which would cut off a large --json write to a pipe.
if (values.json) {
  process.stdout.write(`${JSON.stringify(card, null, 2)}\n`);
} else if (values.coin) {
  const m = card.markets.find((x) => x.coin === values.coin);
  if (m) printMarket(m);
  else {
    console.log(`No live market named ${values.coin}.`);
    process.exitCode = 1;
  }
} else {
  printBoard();
}

function printBoard(): void {
  console.log(`Telltale ratings · ${time(card.from)} → ${time(card.to + 60_000)} UTC (${card.windowMinutes} min)\n`);
  console.log("DEX     Grade          Markets  Open interest  A/B/C/D/E        Why");
  for (const d of card.dexes.filter((x) => !values.dex || x.dex === values.dex)) {
    const name = (d.dex || "core").padEnd(7);
    const grade = d.grade ? `${d.grade} ${GRADE_NAMES[d.grade]}`.padEnd(14) : (d.status === "dormant" ? "dormant" : "–").padEnd(14);
    const counts = `${d.counts.A}/${d.counts.B}/${d.counts.C}/${d.counts.D}/${d.counts.E}`.padEnd(16);
    console.log(`${name} ${grade} ${`${d.graded}/${d.markets}`.padStart(7)}  ${usd(d.oiUsd).padStart(13)}  ${counts} ${d.reasons.join(" ")}`);
  }

  const shown = card.markets.filter((m) => !values.dex || m.dex === values.dex);
  const order = (m: ScoredMarket) => (m.grade.score === null ? 99 : m.grade.score);
  console.log(`\nMarkets, weakest first (${shown.length})`);
  console.log("Market          Grade  Score  Depth/OI  Move cost       Oracle gap  Peer gap  50% days  OI       Main reason");
  for (const m of [...shown].sort((a, b) => order(a) - order(b))) {
    const x = m.metrics;
    console.log(
      [
        m.coin.padEnd(15),
        g(m.grade.grade).padEnd(5),
        fixed(m.grade.score, 2).padStart(5),
        (x.depthToOi === null ? "—" : `${(x.depthToOi * 100).toFixed(1)}%`).padStart(8),
        `${usd(x.liquidationMoveCostUsd)}${x.moveCostIsLowerBound ? "+" : ""} @${x.liquidationBandPct}%`.padEnd(14),
        fixed(x.oracleGapBps, 0, " bps").padStart(10),
        fixed(x.peerGapBps, 0, " bps").padStart(9),
        fixed(x.bigMoveDays30).padStart(8),
        usd(x.oiUsd).padStart(8),
        "",
        m.grade.reasons[0]?.label ?? (m.grade.grade === null ? m.grade.notes[0] ?? "" : ""),
      ].join(" "),
    );
  }
}

function printMarket(m: ScoredMarket): void {
  const x = m.metrics;
  console.log(`${m.coin} · ${g(m.grade.grade)}${m.grade.grade ? ` (${GRADE_NAMES[m.grade.grade]})` : ""} · score ${fixed(m.grade.score, 2)}`);
  console.log(`Window ${time(card.from)} → ${time(card.to + 60_000)} UTC, ${x.coverageMinutes} minutes with data\n`);
  const rows: [string, string][] = [
    ["Open interest", usd(x.oiUsd)],
    ["24h volume", usd(x.volume24hUsd)],
    ["Max leverage", `${m.maxLeverage}x (liquidation ~${x.liquidationDistancePct.toFixed(1)}% away)`],
    ["Depth within ±2%", `${usd(x.depth2Usd)} (thinnest ${usd(x.thinnestDepth2Usd)})`],
    ["Depth / OI", x.depthToOi === null ? "—" : `${(x.depthToOi * 100).toFixed(1)}%  [${g(m.grade.bands.depthToOi)}]`],
    ["Cost to move", `${usd(x.liquidationMoveCostUsd)}${x.moveCostIsLowerBound ? " or more" : ""} for ${x.liquidationBandPct}%  [${g(m.grade.bands.liquidationMoveCost)}]`],
    ["Oracle gap p95", `${fixed(x.oracleGapBps, 1, " bps")}  [${g(m.grade.bands.oracleGap)}]`],
    ["Peer oracle gap", x.peers.length ? `${fixed(x.peerGapBps, 1, " bps")} vs ${x.peers.join(", ")}  [${g(m.grade.bands.peerGap)}]` : "no other deployer lists it"],
    ["50%+ days (30d)", `${fixed(x.bigMoveDays30)}  [${g(m.grade.bands.bigMoves)}]`],
    ["Daily volatility", fixed(x.dailyVolPct, 1, "%")],
    ["Impact spread", fixed(x.spreadBps, 1, " bps")],
    ["Oracle unchanged", x.oracleUnchangedP95Sec === null ? "not streamed" : `p95 ${x.oracleUnchangedP95Sec.toFixed(0)} s; over 10 s in ${((x.oracleUnchangedOver10sShare ?? 0) * 100).toFixed(0)}% of minutes`],
    ["OI cap use", x.oiCapUse === null ? "—" : `${(x.oiCapUse * 100).toFixed(1)}%`],
  ];
  for (const [k, v] of rows) console.log(`${k.padEnd(18)} ${v}`);
  if (m.grade.reasons.length) {
    console.log("\nWhy");
    for (const r of m.grade.reasons) console.log(`  ${r.grade}  ${r.label}: ${r.text}`);
  }
  if (m.grade.notes.length) {
    console.log("\nNotes");
    for (const n of m.grade.notes) console.log(`  ${n}`);
  }
}
