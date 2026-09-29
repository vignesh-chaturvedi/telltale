import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Api } from "../src/api.ts";
import type { Board, DexDetail, Health, MarketDetail } from "../src/api-types.ts";
import { T, seededStore } from "./seed.ts";

let dir: string;
let server: Server;
let api: Api;
let base: string;
let now = T + 31 * 60_000;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "telltale-api-"));
  const store = await seededStore(join(dir, "t.db"));
  store.close();
  const web = join(dir, "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Telltale</title>");
  writeFileSync(join(web, "assets", "app-1234.js"), "console.log(1)");
  api = new Api({ dbPath: join(dir, "t.db"), windowMinutes: 30, webRoot: web, now: () => now });
  api.refresh();
  server = createServer(api.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  api.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async <T>(path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, headers: res.headers, body: (res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text()) as T };
};

test("the board lists every DEX and live market with grade counts", async () => {
  const { status, body, headers } = await get<Board>("/api/board");
  assert.equal(status, 200);
  assert.equal(headers.get("cache-control"), "public, max-age=30");
  assert.equal(body.windowMinutes, 30);
  // 21 fixture markets, 7 of them delisted, plus xyz:AVGO added by the seed.
  assert.equal(body.markets.length, 15);
  assert.equal(body.dexes.find((d) => d.dex === "")!.slug, "core");
  const btc = body.markets.find((m) => m.coin === "BTC")!;
  assert.ok(btc.grade !== null);
  assert.equal(btc.ungradedNote, null);
  const eth = body.markets.find((m) => m.coin === "ETH")!;
  assert.equal(eth.grade, null);
  assert.match(eth.ungradedNote!, /Only 5 minutes/);
  const total = Object.values(body.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, body.markets.filter((m) => m.grade !== null).length);
  // The last bar is minute 29, which ends at T + 30 min; "now" is a minute later.
  assert.equal(body.dataAgeSeconds, 60);
});

test("a market's detail includes its metrics, reasons and 24h history", async () => {
  const { status, body } = await get<MarketDetail>(`/api/markets/${encodeURIComponent("xyz:AVGO")}`);
  assert.equal(status, 200);
  assert.equal(body.dexSlug, "xyz");
  assert.deepEqual(body.metrics.peers, ["para:AVGO"]);
  const buckets = new Set(Array.from({ length: 30 }, (_, i) => Math.floor((T + i * 60_000) / 300_000))).size;
  assert.equal(body.history.length, buckets, "30 minutes grouped into 5-minute buckets");
  assert.equal(body.history[0]!.markPx, 100);
  assert.ok(Math.abs(body.history[0]!.oracleGapBps! - 5) < 1e-6);
});

test("unknown markets and DEXs are 404s with a message", async () => {
  const market = await get<{ error: string }>("/api/markets/NOPE");
  assert.equal(market.status, 404);
  assert.match(market.body.error, /No live market named NOPE/);
  assert.equal((await get("/api/markets/MATIC")).status, 404, "delisted markets aren't served");
  assert.equal((await get("/api/dexes/nope")).status, 404);
});

test("a DEX's detail lists only its markets", async () => {
  const { status, body } = await get<DexDetail>("/api/dexes/para");
  assert.equal(status, 200);
  assert.ok(body.markets.length > 0);
  assert.ok(body.markets.every((m) => m.dex === "para"));
  const core = await get<DexDetail>("/api/dexes/core");
  assert.ok(core.body.markets.every((m) => m.dex === ""));
});

test("health turns not-ok when the data goes stale", async () => {
  let h = await get<Health>("/api/health");
  assert.equal(h.body.ok, true);
  assert.equal(h.headers.get("cache-control"), "no-store");
  now += 10 * 60_000;
  h = await get<Health>("/api/health");
  assert.equal(h.body.ok, false);
  assert.equal(h.body.dataAgeSeconds, 660);
  now -= 10 * 60_000;
});

test("serves the website, with the app shell for client-side routes", async () => {
  const home = await get<string>("/");
  assert.equal(home.status, 200);
  assert.match(home.body, /<title>Telltale/);
  assert.equal(home.headers.get("cache-control"), "no-cache");
  const route = await get<string>("/markets/xyz:AVGO");
  assert.match(route.body, /<title>Telltale/);
  const dotted = await get<string>("/markets/xyz:BRK.B");
  assert.match(dotted.body, /<title>Telltale/, "a dot in a market name isn't a file extension");
  assert.equal((await get("/favicon.ico")).status, 404);
  const asset = await get<string>("/assets/app-1234.js");
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.match(asset.headers.get("content-type")!, /javascript/);
  assert.equal((await get("/assets/missing.js")).status, 404);
});

test("refuses paths outside the website folder and non-GET methods", async () => {
  const escape = await fetch(`${base}/..%2F..%2Ft.db`);
  assert.equal(escape.status, 404);
  const post = await fetch(`${base}/api/board`, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal((await fetch(`${base}/api/markets/%E0%A4%A`)).status, 400);
});
