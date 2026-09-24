import { createHash } from "node:crypto";
import type { AllDexsAssetCtxsData, InfoClient, PerpAssetCtx, PerpDex, PerpDexLimits, PerpUniverseEntry } from "@telltale/hl";

export const CORE_DEX = "";

export interface DexInfo {
  /** "" for the core DEX. */
  name: string;
  fullName: string;
  deployer: string | null;
  oracleUpdater: string | null;
  feeRecipient: string | null;
  collateralToken: number;
  /** Any 24h volume at load time. Core always counts as active. */
  active: boolean;
  /** HIP-3 only; `null` for core or when limits weren't refreshed this round. */
  limits: PerpDexLimits | null;
  /** The raw `perpDexs` entry (HIP-3 only), kept for config snapshots. */
  raw: PerpDex | null;
}

export interface MarketInfo {
  coin: string;
  dex: string;
  /** Position in the DEX's `meta.universe`; `allDexsAssetCtxs` uses the same order. */
  position: number;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number | null;
  onlyIsolated: boolean;
  marginMode: string | null;
  growthMode: string | null;
  deployerFeeScale: string | null;
  isDelisted: boolean;
  /** Open-interest cap in USD, when the DEX publishes one. */
  oiCapUsd: number | null;
}

export interface Universe {
  fetchedAt: number;
  dexes: DexInfo[];
  /** Every market, including delisted ones, in universe order per DEX. */
  markets: MarketInfo[];
  /** Coins per DEX in universe order, to decode `allDexsAssetCtxs`. */
  order: Map<string, string[]>;
  /** Contexts returned with the metadata. */
  ctxs: Map<string, PerpAssetCtx>;
}

export const isLive = (m: MarketInfo): boolean => !m.isDelisted;

export interface LoadOptions {
  /** Fetch `perpDexLimits` for every HIP-3 DEX (5 requests). Otherwise reuse `previous` limits. */
  withLimits: boolean;
  previous?: Universe;
  now?: () => number;
}

/** Fetches every DEX, its markets and contexts, and optionally its OI caps. */
export async function loadUniverse(info: InfoClient, options: LoadOptions): Promise<Universe> {
  const now = options.now ?? Date.now;
  const perpDexs = await info.perpDexs();
  const hip3 = perpDexs.filter((d): d is PerpDex => d !== null);
  const dexNames = [CORE_DEX, ...hip3.map((d) => d.name)];

  const metas = await Promise.all(dexNames.map((name) => info.metaAndAssetCtxs(name)));
  const limits = new Map<string, PerpDexLimits | null>();
  if (options.withLimits) {
    const fetched = await Promise.all(hip3.map((d) => info.perpDexLimits(d.name)));
    hip3.forEach((d, i) => limits.set(d.name, fetched[i]!));
  } else {
    for (const d of options.previous?.dexes ?? []) limits.set(d.name, d.limits);
  }

  const universe: Universe = { fetchedAt: now(), dexes: [], markets: [], order: new Map(), ctxs: new Map() };
  dexNames.forEach((name, i) => {
    const [meta, ctxs] = metas[i]!;
    const raw = name === CORE_DEX ? null : hip3.find((d) => d.name === name)!;
    const dexLimits = limits.get(name) ?? null;
    const caps = new Map(dexLimits?.coinToOiCap.map(([coin, cap]) => [coin, Number(cap)]) ?? []);
    const volume = ctxs.reduce((sum, c) => sum + Number(c.dayNtlVlm), 0);

    universe.dexes.push({
      name,
      fullName: raw?.fullName ?? "Hyperliquid",
      deployer: raw?.deployer ?? null,
      oracleUpdater: raw?.oracleUpdater ?? null,
      feeRecipient: raw?.feeRecipient ?? null,
      collateralToken: meta.collateralToken,
      active: name === CORE_DEX || volume > 0,
      limits: dexLimits,
      raw,
    });
    universe.order.set(name, meta.universe.map((u) => u.name));
    meta.universe.forEach((u, position) => {
      universe.markets.push(toMarket(u, name, position, caps.get(u.name) ?? null));
      const ctx = ctxs[position];
      if (ctx) universe.ctxs.set(u.name, ctx);
    });
  });
  return universe;
}

function toMarket(u: PerpUniverseEntry, dex: string, position: number, oiCapUsd: number | null): MarketInfo {
  return {
    coin: u.name,
    dex,
    position,
    szDecimals: u.szDecimals,
    maxLeverage: u.maxLeverage,
    marginTableId: u.marginTableId ?? null,
    onlyIsolated: u.onlyIsolated ?? false,
    marginMode: u.marginMode ?? null,
    growthMode: u.growthMode ?? null,
    deployerFeeScale: u.deployerFeeScale ?? null,
    isDelisted: u.isDelisted ?? false,
    oiCapUsd,
  };
}

/**
 * What a DEX's deployer controls, as canonical JSON. Two snapshots with the same hash mean
 * nothing a trader should know about has changed.
 */
export function dexConfig(universe: Universe, dex: string): { body: string; hash: string } {
  const info = universe.dexes.find((d) => d.name === dex);
  if (!info) throw new Error(`unknown dex "${dex}"`);
  const markets = universe.markets
    .filter((m) => m.dex === dex)
    .map(({ coin, szDecimals, maxLeverage, marginTableId, onlyIsolated, marginMode, growthMode, deployerFeeScale, isDelisted, oiCapUsd }) => ({
      coin,
      szDecimals,
      maxLeverage,
      marginTableId,
      onlyIsolated,
      marginMode,
      growthMode,
      deployerFeeScale,
      isDelisted,
      oiCapUsd,
    }));
  // `active` follows volume, and `assetToFundingInterestRate` is a live rate that some DEXs move
  // every minute. Neither is a deployer decision, so neither belongs in the fingerprint.
  const { active: _active, raw, ...config } = info;
  const rawConfig = raw && (({ assetToFundingInterestRate: _rate, ...rest }) => rest)(raw);
  const body = canonicalJson({ ...config, raw: rawConfig, markets });
  return { body, hash: createHash("sha256").update(body).digest("hex") };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** True when the set of live markets, or which DEXs are active, has changed. */
export function marketSetChanged(a: Universe, b: Universe): boolean {
  const key = (u: Universe) =>
    [...u.markets.filter(isLive).map((m) => m.coin), ...u.dexes.filter((d) => d.active).map((d) => `dex:${d.name}`)].sort().join(",");
  return key(a) !== key(b);
}

export interface DecodedCtxs {
  pairs: [coin: string, ctx: PerpAssetCtx][];
  /** DEXs whose context count didn't match the markets we know, a sign the universe is stale. */
  mismatched: string[];
}

/** Pairs each context in an `allDexsAssetCtxs` message with its coin, using universe order. */
export function decodeAllDexsCtxs(data: AllDexsAssetCtxsData, order: ReadonlyMap<string, readonly string[]>): DecodedCtxs {
  const out: DecodedCtxs = { pairs: [], mismatched: [] };
  for (const [dex, ctxs] of data.ctxs) {
    const coins = order.get(dex);
    if (!coins) {
      out.mismatched.push(dex);
      continue;
    }
    if (coins.length !== ctxs.length) out.mismatched.push(dex);
    const n = Math.min(coins.length, ctxs.length);
    for (let i = 0; i < n; i++) out.pairs.push([coins[i]!, ctxs[i]!]);
  }
  return out;
}
