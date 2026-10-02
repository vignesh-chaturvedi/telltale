// Reads the downloaded archives into what the detectors take: per-minute asset contexts,
// order-book snapshots in time order, and liquidations per minute.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Watch } from "@telltale/collector/watch";
import type { Incident } from "./incidents.ts";
import type { Paths } from "./archive.ts";

export type Book = Parameters<Watch["onBook"]>[0];

export interface Snapshot {
  at: number;
  book: Book;
}

/** One minute of a market's context, as Hyperliquid archives it. */
export interface ContextRow {
  ts: number;
  oraclePx: number;
  markPx: number;
  midPx: number | null;
  openInterest: number;
  dayNtlVlm: number;
  impactBid: number | null;
  impactAsk: number | null;
}

const num = (s: string | undefined): number | null => (s === undefined || s === "" ? null : Number(s));

/** Parses asset-context CSVs (time,coin,funding,open_interest,…) already filtered to one coin. */
export function parseContexts(csv: string): ContextRow[] {
  const [head, ...lines] = csv.trim().split("\n");
  const col = Object.fromEntries(head!.split(",").map((c, i) => [c, i]));
  return lines.map((line) => {
    const f = line.split(",");
    const at = (c: string) => f[col[c]!];
    return {
      ts: Date.parse(at("time")!),
      oraclePx: Number(at("oracle_px")),
      markPx: Number(at("mark_px")),
      midPx: num(at("mid_px")),
      openInterest: Number(at("open_interest")),
      dayNtlVlm: Number(at("day_ntl_vlm")),
      impactBid: num(at("impact_bid_px")),
      impactAsk: num(at("impact_ask_px")),
    };
  });
}

export function readContexts(paths: Paths): ContextRow[] {
  return paths.contexts.flatMap((f) => parseContexts(readFileSync(f, "utf8"))).sort((a, b) => a.ts - b.ts);
}

async function connect() {
  return (await DuckDBInstance.create(":memory:")).connect();
}

const list = (files: readonly string[]) => `[${files.map((f) => `'${f.replaceAll("'", "''")}'`).join(", ")}]`;

/** Order-book snapshots in time order, from whichever archive covers the incident. */
export async function* readBooks(i: Incident, paths: Paths): AsyncGenerator<Snapshot> {
  if (i.books === "reservoir") {
    const db = await connect();
    const rows = (await db.runAndReadAll(`SELECT block_time_ms AS ms, bids, asks FROM read_parquet(${list(paths.books)}) ORDER BY ms`)).getRowObjectsJson();
    for (const r of rows as unknown as { ms: string; bids: Book["levels"][0]; asks: Book["levels"][1] }[]) {
      const at = Number(r.ms);
      yield { at, book: { coin: i.coin, time: at, levels: [r.bids, r.asks] } };
    }
    return;
  }
  // Hyperliquid's archive: one JSON line per l2Book message, about two a second.
  for (const file of paths.books) {
    const child = spawn("lz4", ["-dc", file]);
    for await (const line of createInterface({ input: child.stdout })) {
      if (!line) continue;
      const data = (JSON.parse(line) as { raw: { data: Book } }).raw.data;
      yield { at: data.time, book: data };
    }
  }
}

export interface LiquidationMinute {
  t: number;
  usd: number;
  /** Taken over by the liquidator vault (HLP) rather than sold into the book. */
  backstopUsd: number;
}

/** Liquidated notional per minute. Each liquidation is counted once, on the liquidated account's fill. */
export async function readLiquidations(i: Incident, paths: Paths): Promise<LiquidationMinute[]> {
  const db = await connect();
  const rows = (
    await db.runAndReadAll(
      `SELECT (epoch_ms(timestamp) // 60000) * 60000 AS t,
         sum(CAST(price AS DOUBLE) * CAST(size AS DOUBLE)) AS usd,
         sum(CASE WHEN liquidation_method = 'backstop' THEN CAST(price AS DOUBLE) * CAST(size AS DOUBLE) ELSE 0 END) AS backstop
       FROM read_parquet(${list(paths.liquidations)})
       WHERE coin = '${i.coin.replaceAll("'", "''")}' AND is_liquidation AND liquidation_mark_px IS NOT NULL
         AND epoch_ms(timestamp) BETWEEN ${i.from} AND ${i.to}
       GROUP BY t ORDER BY t`,
    )
  ).getRowObjectsJson() as unknown as { t: string; usd: number; backstop: number }[];
  return rows.map((r) => ({ t: Number(r.t), usd: Math.round(r.usd), backstopUsd: Math.round(r.backstop) }));
}
