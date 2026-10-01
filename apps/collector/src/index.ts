// Runs the collector: `pnpm collect [--testnet] [--db path] [--minutes n] [--keep-days 14]`.
import { parseArgs } from "node:util";
import { MAINNET, TESTNET } from "@telltale/hl";
import { Collector, DEFAULTS } from "./collector.ts";
import { sinksFromEnv } from "./notify.ts";

const { values } = parseArgs({
  options: {
    testnet: { type: "boolean", default: false },
    db: { type: "string", default: process.env.TELLTALE_DB ?? "data/telltale.db" },
    minutes: { type: "string" },
    "book-streams": { type: "string", default: String(DEFAULTS.bookStreams) },
    "keep-days": { type: "string", default: String(DEFAULTS.keepMinuteDays) },
  },
});

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

const collector = new Collector({
  ...DEFAULTS,
  network: values.testnet ? TESTNET : MAINNET,
  dbPath: values.db,
  bookStreams: Number(values["book-streams"]),
  keepMinuteDays: Number(values["keep-days"]),
  sinks: sinksFromEnv(),
  // Alerts are only sent once ALERTS_PUBLISH=1 is set, after the shadow run.
  publishAlerts: process.env.ALERTS_PUBLISH === "1",
  log,
});

let stopping = false;
const stop = async (why: string) => {
  if (stopping) return;
  stopping = true;
  log(`stopping (${why})`);
  await collector.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

await collector.start();
if (values.minutes) setTimeout(() => void stop(`ran ${values.minutes} min`), Number(values.minutes) * 60_000);
