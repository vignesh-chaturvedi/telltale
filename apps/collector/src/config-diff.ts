// Turns two stored DEX config snapshots into the changes a trader would want to know about,
// and those changes into one alert. Lists of (market, value) pairs are compared market by
// market: a new market shifts every later position, and a positional diff would report dozens
// of changes where there was one.
import { severityRank, type Severity, type Signal } from "@telltale/detectors";

export interface ConfigChange {
  /** The market the change applies to; `null` for DEX-wide settings. */
  coin: string | null;
  field: string;
  before: string | null;
  after: string | null;
  /** One neutral sentence fragment, e.g. "xyz:KIOXIA open-interest cap $100M → $50M". */
  text: string;
  severity: Severity;
}

interface MarketConfig {
  coin: string;
  maxLeverage: number;
  isDelisted: boolean;
  onlyIsolated: boolean;
  marginMode: string | null;
  marginTableId: number | null;
  deployerFeeScale: string | null;
  growthMode: string | null;
  oiCapUsd: number | null;
  szDecimals: number;
}

interface DexConfig {
  fullName?: string;
  deployer?: string | null;
  oracleUpdater?: string | null;
  feeRecipient?: string | null;
  collateral?: string | null;
  collateralToken?: number;
  markets?: MarketConfig[];
  limits?: { maxTransferNtl?: string; oiSzCapPerPerp?: string } | null;
  raw?: {
    subDeployers?: [string, string[]][];
    assetToFundingMultiplier?: [string, string][];
    assetToFundingClamp?: [string, string][];
  } | null;
}

const short = (a: string | null | undefined): string => (!a ? "none" : a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const show = (v: unknown): string => (v === null || v === undefined ? "none" : String(v));
const usd = (n: number | null): string =>
  n === null ? "none" : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${+(n / 1e3).toFixed(0)}K` : `$${n}`;

/** Settings a trader should hear about promptly; everything else is information. */
const WARNING_FIELDS = new Set(["deployer", "oracleUpdater", "collateral", "delisted", "maxLeverage", "setOracle"]);

export function diffDexConfig(beforeBody: string, afterBody: string): ConfigChange[] {
  const a = JSON.parse(beforeBody) as DexConfig;
  const b = JSON.parse(afterBody) as DexConfig;
  const out: ConfigChange[] = [];
  const add = (coin: string | null, field: string, before: unknown, after: unknown, text: string) =>
    out.push({ coin, field, before: before === undefined ? null : show(before), after: after === undefined ? null : show(after), text, severity: WARNING_FIELDS.has(field) ? "warning" : "info" });

  if (a.deployer !== b.deployer) add(null, "deployer", a.deployer, b.deployer, `deployer ${short(a.deployer)} → ${short(b.deployer)}`);
  if (a.oracleUpdater !== b.oracleUpdater) add(null, "oracleUpdater", a.oracleUpdater, b.oracleUpdater, `oracle updater ${short(a.oracleUpdater)} → ${short(b.oracleUpdater)}`);
  if (a.feeRecipient !== b.feeRecipient) add(null, "feeRecipient", a.feeRecipient, b.feeRecipient, `fee recipient ${short(a.feeRecipient)} → ${short(b.feeRecipient)}`);
  if (a.collateralToken !== b.collateralToken) add(null, "collateral", a.collateral, b.collateral, `collateral ${show(a.collateral)} → ${show(b.collateral)}`);
  if (a.fullName !== b.fullName) add(null, "fullName", a.fullName, b.fullName, `name "${show(a.fullName)}" → "${show(b.fullName)}"`);
  if (a.limits?.maxTransferNtl !== b.limits?.maxTransferNtl && a.limits && b.limits) {
    add(null, "maxTransferNtl", a.limits.maxTransferNtl, b.limits.maxTransferNtl, `maximum transfer ${usd(Number(a.limits.maxTransferNtl))} → ${usd(Number(b.limits.maxTransferNtl))}`);
  }

  const before = new Map((a.markets ?? []).map((m) => [m.coin, m]));
  const after = new Map((b.markets ?? []).map((m) => [m.coin, m]));
  for (const [coin, m] of after) {
    const old = before.get(coin);
    if (!old) {
      // Registered but not yet trading; it's reported when it opens.
      if (!m.isDelisted) add(coin, "listed", null, coin, `opened ${coin} for trading (up to ${m.maxLeverage}x)`);
      continue;
    }
    if (old.isDelisted !== m.isDelisted) {
      // A first listing and a relisting look the same in the config, so both read as opening.
      add(coin, m.isDelisted ? "delisted" : "listed", old.isDelisted, m.isDelisted, m.isDelisted ? `delisted ${coin}` : `opened ${coin} for trading (up to ${m.maxLeverage}x)`);
    }
    // Setting up a market that isn't trading yet isn't news; it's reported when it opens.
    if (m.isDelisted) continue;
    if (old.maxLeverage !== m.maxLeverage) add(coin, "maxLeverage", old.maxLeverage, m.maxLeverage, `${coin} maximum leverage ${old.maxLeverage}x → ${m.maxLeverage}x`);
    if (old.oiCapUsd !== m.oiCapUsd) add(coin, "oiCapUsd", old.oiCapUsd, m.oiCapUsd, `${coin} open-interest cap ${usd(old.oiCapUsd)} → ${usd(m.oiCapUsd)}`);
    if (old.onlyIsolated !== m.onlyIsolated || old.marginMode !== m.marginMode) {
      const mode = (x: MarketConfig) => x.marginMode ?? (x.onlyIsolated ? "isolated only" : "cross allowed");
      add(coin, "marginMode", mode(old), mode(m), `${coin} margin mode ${mode(old)} → ${mode(m)}`);
    }
    if (old.marginTableId !== m.marginTableId) add(coin, "marginTableId", old.marginTableId, m.marginTableId, `${coin} margin table ${show(old.marginTableId)} → ${show(m.marginTableId)}`);
    if (old.deployerFeeScale !== m.deployerFeeScale) add(coin, "deployerFeeScale", old.deployerFeeScale, m.deployerFeeScale, `${coin} deployer fee scale ${show(old.deployerFeeScale)} → ${show(m.deployerFeeScale)}`);
    if (old.growthMode !== m.growthMode) add(coin, "growthMode", old.growthMode, m.growthMode, `${coin} growth mode ${show(old.growthMode)} → ${show(m.growthMode)}`);
  }
  for (const [coin, m] of before) if (!after.has(coin) && !m.isDelisted) add(coin, "removed", coin, null, `removed ${coin}`);

  for (const [field, label] of [["assetToFundingMultiplier", "funding multiplier"], ["assetToFundingClamp", "funding clamp"]] as const) {
    const x = new Map(a.raw?.[field] ?? []);
    const y = new Map(b.raw?.[field] ?? []);
    for (const coin of new Set([...x.keys(), ...y.keys()])) {
      // Settings for a new market, or one that isn't trading, arrive with its opening.
      const live = after.get(coin);
      if (!before.has(coin) || !live || live.isDelisted || x.get(coin) === y.get(coin)) continue;
      add(coin, field, x.get(coin), y.get(coin), `${coin} ${label} ${show(x.get(coin))} → ${show(y.get(coin))}`);
    }
  }

  const perms = (c: DexConfig) => new Map((c.raw?.subDeployers ?? []).map(([action, users]) => [action, new Set(users)]));
  const pa = perms(a);
  const pb = perms(b);
  for (const action of new Set([...pa.keys(), ...pb.keys()])) {
    const was = pa.get(action) ?? new Set<string>();
    const now = pb.get(action) ?? new Set<string>();
    const field = action === "setOracle" ? "setOracle" : "subDeployers";
    for (const user of now) if (!was.has(user)) add(null, field, null, user, `gave ${short(user)} permission to ${action}`);
    for (const user of was) if (!now.has(user)) add(null, field, user, null, `removed ${short(user)}'s permission to ${action}`);
  }
  return out;
}

/** One alert for everything a DEX changed in one refresh, or `null` if nothing did. */
export function deployerChangeSignal(dex: string, fullName: string, changes: readonly ConfigChange[], at: number): Signal | null {
  if (changes.length === 0) return null;
  const severity = changes.reduce<Severity>((s, c) => (severityRank(c.severity) > severityRank(s) ? c.severity : s), "info");
  const coins = new Set(changes.map((c) => c.coin));
  const coin = coins.size === 1 ? [...coins][0]! : null;
  const name = fullName || dex || "Hyperliquid";
  const list = changes.map((c) => c.text);
  const shown = list.length > 6 ? [...list.slice(0, 6), `and ${list.length - 6} more`] : list;
  return {
    kind: "deployer-change",
    coin,
    dex,
    severity,
    at,
    title: changes.length === 1 ? `${name}: ${changes[0]!.text}` : `${name} changed ${changes.length} settings`,
    detail: `${name} changed: ${shown.join("; ")}.`,
    evidence: { changes: JSON.stringify(changes.map(({ coin: c, field, before, after }) => ({ coin: c, field, before, after }))) },
  };
}
