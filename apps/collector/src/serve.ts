// Serves the JSON API and the website: `pnpm serve [--port 8740] [--db path] [--web apps/web/dist]`.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { Api } from "./api.ts";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: process.env.TELLTALE_DB ?? "data/telltale.db" },
    port: { type: "string", default: process.env.PORT ?? "8740" },
    host: { type: "string", default: process.env.HOST ?? "127.0.0.1" },
    web: { type: "string", default: "apps/web/dist" },
    window: { type: "string", default: "60" },
  },
});

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
if (!existsSync(values.db)) {
  log(`No database at ${values.db}. Start the collector with \`pnpm collect\` first.`);
  process.exit(1);
}

// Files are looked up on each request, so a build made after startup is served without a restart.
const webRoot = values.web || null;
// Alerts appear on the site once ALERTS_PUBLIC=1 is set, after the shadow run.
const api = new Api({ dbPath: values.db, windowMinutes: Number(values.window), webRoot, alertsPublic: process.env.ALERTS_PUBLIC === "1" });
const refresh = () => {
  try {
    const started = performance.now();
    api.refresh();
    return performance.now() - started;
  } catch (err) {
    log(`error: scorecard refresh failed: ${(err as Error).message}`);
    return null;
  }
};
const ms = refresh();
const timer = setInterval(refresh, 60_000);

const server = createServer(api.handle);
server.listen(Number(values.port), values.host, () => {
  const site = !webRoot ? ", API only" : existsSync(webRoot) ? `, website from ${webRoot}` : `, website from ${webRoot} (not built yet: run \`pnpm build\`)`;
  log(`Serving on http://${values.host}:${values.port} (scorecard in ${ms?.toFixed(0) ?? "?"} ms${site})`);
});

const stop = () => {
  clearInterval(timer);
  server.close(() => {
    api.close();
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
