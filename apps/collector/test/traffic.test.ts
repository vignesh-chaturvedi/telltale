import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTraffic } from "../src/traffic.ts";

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const DAY1 = Date.UTC(2026, 9, 3, 12) / 1000;
const DAY2 = Date.UTC(2026, 9, 4, 9) / 1000;

function line(ts: number, uri: string, o: { ip?: string; ua?: string; referer?: string; status?: number; type?: string } = {}): string {
  const headers: Record<string, string[]> = { "User-Agent": [o.ua ?? SAFARI] };
  if (o.referer) headers.Referer = [o.referer];
  return JSON.stringify({
    ts,
    request: { method: "GET", uri, client_ip: o.ip ?? "203.0.113.7", headers },
    status: o.status ?? 200,
    resp_headers: { "Content-Type": [o.type ?? (uri.startsWith("/api/badge/") ? "image/svg+xml" : uri.startsWith("/api/") ? "application/json" : "text/html; charset=utf-8")] },
  });
}

// What the app does once it runs in a browser: it calls the API from its own page.
const ranApp = (ts: number, o: { ip?: string; ua?: string } = {}) => line(ts + 1, "/api/health", { ...o, referer: "https://telltale.markets/" });

test("counts browsers' page loads per day, with visitors as distinct address-and-browser pairs", () => {
  const t = summarizeTraffic([
    line(DAY1, "/", { referer: "https://t.co/abc" }),
    ranApp(DAY1),
    line(DAY1 + 60, "/markets/xyz%3AGOLD"),
    line(DAY1 + 120, "/replays/popcat-2025-11", { ua: CHROME }),
    ranApp(DAY1 + 120, { ua: CHROME }),
    line(DAY1 + 180, "/", { ip: "198.51.100.4", referer: "https://t.co/xyz" }),
    ranApp(DAY1 + 180, { ip: "198.51.100.4" }),
    line(DAY2, "/?ref=x", { referer: "https://www.github.com/vignesh-chaturvedi/telltale" }),
    ranApp(DAY2),
    "not json",
  ]);
  assert.deepEqual(t.days, [
    { day: "2026-10-03", visitors: 3, pageLoads: 4, badgeLoads: 0, apiCalls: 0 },
    { day: "2026-10-04", visitors: 1, pageLoads: 1, badgeLoads: 0, apiCalls: 0 },
  ]);
  assert.deepEqual(t.referrers, [["t.co", 2], ["github.com", 1]]);
});

test("leaves out bots, scanners guessing paths, assets, errors, and browsers that never ran the app", () => {
  const t = summarizeTraffic([
    line(DAY1, "/", { ip: "192.0.2.1", referer: "https://t.co/abc" }),
    line(DAY1, "/", { ua: "Twitterbot/1.0" }),
    line(DAY1, "/", { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
    line(DAY1, "/", { ua: "curl/8.5.0" }),
    line(DAY1, "/wp-admin/install.php?step=1"),
    line(DAY1, "/.env"),
    line(DAY1, "/assets/index-1234.js", { type: "text/javascript" }),
    line(DAY1, "/markets/NOPE", { status: 404, type: "application/json" }),
  ]);
  assert.deepEqual(t.days, [{ day: "2026-10-03", visitors: 0, pageLoads: 0, badgeLoads: 0, apiCalls: 0 }]);
  assert.deepEqual(t.referrers, []);
});

test("counts badge loads with the sites showing them, and API calls from outside the site", () => {
  const t = summarizeTraffic([
    line(DAY1, "/api/badge/BTC.svg", { referer: "https://github.com/someone/vault" }),
    line(DAY1, "/api/badge/BTC.svg", { referer: "https://telltale.markets/markets/BTC" }),
    line(DAY1, "/api/board", { referer: "https://telltale.markets/" }),
    line(DAY1, "/api/board", { referer: "https://dashboard.example/" }),
    line(DAY1, "/api/markets/BTC"),
    line(DAY1, "/api/health"),
  ]);
  assert.deepEqual(t.days, [{ day: "2026-10-03", visitors: 0, pageLoads: 0, badgeLoads: 2, apiCalls: 2 }]);
  assert.deepEqual(t.badgeHosts, [["github.com", 1]]);
});
