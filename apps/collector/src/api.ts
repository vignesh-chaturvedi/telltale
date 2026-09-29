import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GRADES, type Grade } from "@telltale/detectors";
import type { Board, BoardDex, BoardMarket, DexDetail, Health, HistoryPoint, MarketDetail } from "./api-types.ts";
import { scoreDatabase, type ScoredMarket, type Scorecard } from "./scoring.ts";

export interface ApiOptions {
  dbPath: string;
  windowMinutes: number;
  /** Built website to serve for every non-API path; `null` serves the API only. */
  webRoot: string | null;
  /** Health reports not-ok when the newest data is older than this. */
  staleAfterSeconds?: number;
  now?: () => number;
}

const HISTORY_MS = 24 * 60 * 60_000;
const BUCKET_MS = 5 * 60_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export const dexSlug = (dex: string): string => dex || "core";

function toRow(m: ScoredMarket): BoardMarket {
  const x = m.metrics;
  return {
    coin: m.coin,
    dex: m.dex,
    grade: m.grade.grade,
    score: m.grade.score,
    oiUsd: x.oiUsd,
    volume24hUsd: x.volume24hUsd,
    depthToOi: x.depthToOi,
    liquidationMoveCostUsd: x.liquidationMoveCostUsd,
    liquidationBandPct: x.liquidationBandPct,
    moveCostIsLowerBound: x.moveCostIsLowerBound,
    oracleGapBps: x.oracleGapBps,
    peerGapBps: x.peerGapBps,
    bigMoveDays30: x.bigMoveDays30,
    spreadBps: x.spreadBps,
    bands: m.grade.bands,
    reasons: m.grade.reasons.map(({ metric, grade, label }) => ({ metric, grade, label })),
    ungradedNote: m.grade.grade === null ? (m.grade.notes[0] ?? null) : null,
  };
}

/**
 * Serves the ratings as JSON, and the built website for everything else. The scorecard is
 * computed on `refresh()` (about 200 ms) and kept in memory between refreshes.
 */
export class Api {
  private readonly options: Required<Omit<ApiOptions, "webRoot">> & { webRoot: string | null };
  private readonly db: DatabaseSync;
  private card: Scorecard | null = null;
  private board: Board | null = null;

  constructor(options: ApiOptions) {
    this.options = { staleAfterSeconds: 180, now: Date.now, ...options, webRoot: options.webRoot ? resolve(options.webRoot) : null };
    this.db = new DatabaseSync(options.dbPath, { readOnly: true });
  }

  refresh(): void {
    const card = scoreDatabase(this.db, { windowMinutes: this.options.windowMinutes, minCoverageMinutes: Math.min(20, this.options.windowMinutes) });
    const counts = Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>;
    for (const m of card.markets) if (m.grade.grade) counts[m.grade.grade]++;
    const generatedAt = this.options.now();
    const dexes: BoardDex[] = card.dexes.map((d) => ({ ...d, slug: dexSlug(d.dex) }));
    this.card = card;
    this.board = {
      generatedAt,
      windowMinutes: card.windowMinutes,
      from: card.from,
      to: card.to,
      dataAgeSeconds: this.dataAge(card.to, generatedAt),
      counts,
      dexes,
      markets: card.markets.map(toRow),
    };
  }

  close(): void {
    this.db.close();
  }

  handle = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return this.send(res, 405, { error: "Only GET and HEAD are supported." });
      const url = new URL(req.url ?? "/", "http://localhost");
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return this.send(res, 400, { error: "The URL isn't valid." });
      }
      if (path.startsWith("/api/")) return this.api(path, res);
      if (this.options.webRoot) return this.file(path, res);
      return this.send(res, 404, { error: "Not found." });
    } catch (err) {
      this.send(res, 500, { error: (err as Error).message });
    }
  };

  private api(path: string, res: ServerResponse): void {
    if (path === "/api/health") return this.send(res, 200, this.health(), "no-store");
    if (!this.card || !this.board) return this.send(res, 503, { error: "The scorecard hasn't been computed yet." });
    if (path === "/api/board") return this.send(res, 200, this.board);

    const market = path.match(/^\/api\/markets\/(.+)$/);
    if (market) {
      const detail = this.marketDetail(market[1]!);
      return detail ? this.send(res, 200, detail) : this.send(res, 404, { error: `No live market named ${market[1]}.` });
    }
    const dex = path.match(/^\/api\/dexes\/([^/]+)$/);
    if (dex) {
      const found = this.board.dexes.find((d) => d.slug === dex[1]);
      if (!found) return this.send(res, 404, { error: `No DEX named ${dex[1]}.` });
      const detail: DexDetail = {
        generatedAt: this.board.generatedAt,
        windowMinutes: this.board.windowMinutes,
        dex: found,
        markets: this.board.markets.filter((m) => m.dex === found.dex),
      };
      return this.send(res, 200, detail);
    }
    this.send(res, 404, { error: "Not found." });
  }

  private health(): Health {
    const latest = (this.db.prepare("SELECT max(ts) AS ts FROM minute_bars").get() as { ts: number | null }).ts;
    const now = this.options.now();
    const age = latest === null ? null : this.dataAge(latest, now);
    return {
      ok: age !== null && age <= this.options.staleAfterSeconds,
      now,
      latestMinute: latest,
      dataAgeSeconds: age,
      markets: this.card?.markets.length ?? 0,
    };
  }

  private marketDetail(coin: string): MarketDetail | null {
    const m = this.card!.markets.find((x) => x.coin === coin);
    if (!m) return null;
    const dex = this.board!.dexes.find((d) => d.dex === m.dex)!;
    const since = this.card!.to - HISTORY_MS;
    const history = this.db
      .prepare(
        `SELECT (ts / ${BUCKET_MS}) * ${BUCKET_MS} AS t, avg(mark_px) AS markPx, avg(oracle_px) AS oraclePx,
           max(abs(mid_px - oracle_px) / oracle_px * 10000) AS oracleGapBps, avg(bid_depth_2 + ask_depth_2) AS depth2Usd,
           avg(open_interest * mark_px) AS oiUsd
         FROM minute_bars WHERE coin = ? AND ts > ? GROUP BY t ORDER BY t`,
      )
      .all(coin, since) as unknown as HistoryPoint[];
    return {
      generatedAt: this.board!.generatedAt,
      windowMinutes: this.card!.windowMinutes,
      from: this.card!.from,
      to: this.card!.to,
      dataAgeSeconds: this.board!.dataAgeSeconds,
      coin: m.coin,
      dex: m.dex,
      dexSlug: dex.slug,
      dexName: dex.fullName,
      maxLeverage: m.maxLeverage,
      metrics: m.metrics,
      grade: m.grade,
      history,
    };
  }

  /** Seconds since the end of the given minute. */
  private dataAge(minute: number, now: number): number {
    return Math.max(0, Math.round((now - (minute + 60_000)) / 1000));
  }

  private send(res: ServerResponse, status: number, body: unknown, cache = "public, max-age=30"): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? cache : "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(json);
  }

  /** Serves a file from the built website; other paths get the app shell. */
  private file(path: string, res: ServerResponse): void {
    const root = this.options.webRoot!;
    let target = resolve(join(root, path));
    if (target !== root && !target.startsWith(root + sep)) return this.send(res, 404, { error: "Not found." });
    let stat = statSafe(target);
    if (stat?.isDirectory()) {
      target = join(target, "index.html");
      stat = statSafe(target);
    }
    // Client-side routes get the app shell. Market names can contain dots (xyz:BRK.B), so only
    // assets and known file types 404 when missing.
    if (!stat && !path.startsWith("/assets/") && !(extname(path).toLowerCase() in TYPES)) {
      target = join(root, "index.html");
      stat = statSafe(target);
    }
    if (!stat?.isFile()) return this.send(res, 404, { error: "Not found." });
    const hashed = path.startsWith("/assets/");
    res.writeHead(200, {
      "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    createReadStream(target).pipe(res);
  }
}

function statSafe(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
