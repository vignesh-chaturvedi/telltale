// Counts real visits from Caddy's JSON access log: page loads by browsers on the site's own
// routes, visitors as distinct address-and-browser pairs per UTC day, where they came from, and
// who loads the badges and the API. A page load only counts when the same browser then ran the
// app (it called the API from the site's pages): crawlers that fake a browser's name rarely run
// JavaScript. Addresses are only compared, never printed or stored.

export interface DayTraffic {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  visitors: number;
  pageLoads: number;
  badgeLoads: number;
  /** API requests that didn't come from the site's own pages, health checks excluded. */
  apiCalls: number;
}

export interface TrafficSummary {
  days: DayTraffic[];
  /** Hosts that sent page loads, most first. */
  referrers: [host: string, loads: number][];
  /** Hosts whose pages loaded a badge, most first. */
  badgeHosts: [host: string, loads: number][];
}

// The site's client-side routes; anything else that gets the app shell is a scanner guessing paths.
const PAGE = /^\/(?:$|markets\/[^/]+$|dexes\/[^/]+$|alerts$|replays$|replays\/[^/]+$|methodology$|developers$)/;
const BOT = /bot|crawl|spider|slurp|preview|scan|fetch|curl|wget|python|go-http|java\/|okhttp|axios|node|headless|monitor|uptime|facebookexternalhit|embedly|whatsapp/i;

interface Entry {
  ts: number;
  request: { method: string; uri: string; client_ip?: string; remote_ip?: string; headers?: Record<string, string[]> };
  status: number;
  resp_headers?: Record<string, string[]>;
}

const header = (h: Record<string, string[]> | undefined, name: string) => h?.[name]?.[0] ?? "";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function summarizeTraffic(lines: Iterable<string>, siteHost = "telltale.markets"): TrafficSummary {
  const days = new Map<string, { loads: { who: string; from: string | null }[]; ranApp: Set<string>; badgeLoads: number; apiCalls: number }>();
  const referrers = new Map<string, number>();
  const badgeHosts = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const line of lines) {
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    if (!e.request || typeof e.ts !== "number" || e.request.method !== "GET" || e.status >= 400) continue;
    const path = e.request.uri.split("?")[0]!;
    const ua = header(e.request.headers, "User-Agent");
    if (!ua.startsWith("Mozilla/") || BOT.test(ua)) continue;
    const day = new Date(e.ts * 1000).toISOString().slice(0, 10);
    let d = days.get(day);
    if (!d) days.set(day, (d = { loads: [], ranApp: new Set(), badgeLoads: 0, apiCalls: 0 }));
    const from = hostOf(header(e.request.headers, "Referer"));
    const ownPage = from === siteHost;
    const who = `${e.request.client_ip ?? e.request.remote_ip}|${ua}`;

    if (path.startsWith("/api/badge/")) {
      d.badgeLoads++;
      if (from && !ownPage) bump(badgeHosts, from);
    } else if (path.startsWith("/api/")) {
      if (ownPage) d.ranApp.add(who);
      else if (path !== "/api/health") d.apiCalls++;
    } else if (PAGE.test(path) && header(e.resp_headers, "Content-Type").startsWith("text/html")) {
      d.loads.push({ who, from: from && !ownPage ? from : null });
    }
  }

  const out: DayTraffic[] = [];
  for (const [day, d] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const real = d.loads.filter((l) => d.ranApp.has(l.who));
    for (const l of real) if (l.from) bump(referrers, l.from);
    out.push({ day, visitors: new Set(real.map((l) => l.who)).size, pageLoads: real.length, badgeLoads: d.badgeLoads, apiCalls: d.apiCalls });
  }
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  return {
    days: out,
    referrers: sorted(referrers),
    badgeHosts: sorted(badgeHosts),
  };
}
