// Downloads what a replay needs from two public, requester-pays S3 archives: Hyperliquid's own
// (per-minute asset contexts; full-precision books from 2025) and Hydromancer's Reservoir (books
// every minute from December 2025; every fill, including liquidations). Files already on disk are
// kept, so a replay downloads its data once.
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { datesOf, hoursOf, type Incident } from "./incidents.ts";

const HL = "s3://hyperliquid-archive";
const RESERVOIR = "s3://hydromancer-reservoir/by_dex/hyperliquid";

export interface Paths {
  dir: string;
  contexts: string[];
  books: string[];
  liquidations: string[];
}

export function pathsOf(i: Incident, root: string): Paths {
  const dir = join(root, i.id);
  return {
    dir,
    contexts: datesOf(i).map((d) => join(dir, `ctx-${d}.csv`)),
    books:
      i.books === "reservoir"
        ? datesOf(i).map((d) => join(dir, `book-${d}.parquet`))
        : hoursOf(i).map(([d, h]) => join(dir, `book-${d}-${String(h).padStart(2, "0")}.jsonl.lz4`)),
    liquidations: datesOf(i).map((d) => join(dir, `liquidations-${d}.parquet`)),
  };
}

/** Requester-pays copy. The requester (you) pays AWS's transfer, a few cents per incident. */
function copy(source: string, target: string): void {
  if (existsSync(target)) return;
  const partial = `${target}.partial`;
  execFileSync("aws", ["s3", "cp", source, partial, "--request-payer", "requester", "--only-show-errors"], { stdio: "inherit" });
  renameSync(partial, target);
}

/** Keeps one coin's rows of a day's asset contexts (about 36 MB a day for every coin). */
async function extractContexts(lz4File: string, coin: string, target: string): Promise<void> {
  const out = createWriteStream(`${target}.partial`);
  const child = spawn("lz4", ["-dc", lz4File]);
  let header = true;
  for await (const line of createInterface({ input: child.stdout })) {
    if (header || line.split(",", 2)[1] === coin) out.write(`${line}\n`);
    header = false;
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  renameSync(`${target}.partial`, target);
}

export async function download(i: Incident, root: string, log: (line: string) => void): Promise<Paths> {
  const p = pathsOf(i, root);
  mkdirSync(p.dir, { recursive: true });
  for (const [k, d] of datesOf(i).entries()) {
    const target = p.contexts[k]!;
    if (existsSync(target)) continue;
    const day = d.replaceAll("-", "");
    const archive = join(p.dir, `asset_ctxs-${day}.csv.lz4`);
    log(`asset contexts ${d}`);
    copy(`${HL}/asset_ctxs/${day}.csv.lz4`, archive);
    await extractContexts(archive, i.coin, target);
    rmSync(archive);
  }
  if (i.books === "reservoir") {
    datesOf(i).forEach((d, k) => {
      log(`order books ${d}`);
      copy(`${RESERVOIR}/orderbook/1m/perps/date=${d}/${i.coin}.parquet`, p.books[k]!);
    });
  } else {
    hoursOf(i).forEach(([d, h], k) => {
      log(`order books ${d} ${h}:00`);
      copy(`${HL}/market_data/${d}/${h}/l2Book/${i.coin}.lz4`, p.books[k]!);
    });
  }
  datesOf(i).forEach((d, k) => {
    log(`liquidations ${d}`);
    copy(`${RESERVOIR}/fills/perp/liquidations/date=${d}/fills.parquet`, p.liquidations[k]!);
  });
  return p;
}
