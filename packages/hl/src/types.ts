// Shapes of the Hyperliquid API responses Telltale reads. Numbers arrive as decimal strings.

/** One entry of `perpDexs`. The first element of the response is `null` and stands for the core DEX. */
export interface PerpDex {
  name: string;
  fullName: string;
  deployer: string;
  oracleUpdater: string | null;
  feeRecipient: string | null;
  assetToStreamingOiCap: [string, string][];
  subDeployers: [string, string[]][];
  assetToFundingMultiplier: [string, string][];
  assetToFundingInterestRate: [string, string][];
  assetToFundingClamp: [string, string][];
}

/** One market in `meta.universe`. HIP-3 names carry the DEX prefix, e.g. `xyz:SP500`. */
export interface PerpUniverseEntry {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId?: number;
  onlyIsolated?: boolean;
  marginMode?: string;
  isDelisted?: boolean;
  growthMode?: string;
  deployerFeeScale?: string;
  lastFeeScaleChangeTime?: string;
}

export interface PerpMeta {
  universe: PerpUniverseEntry[];
  collateralToken: number;
  marginTables: unknown[];
}

export interface PerpAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
  impactPxs: [string, string] | null;
  dayBaseVlm: string;
}

export interface PerpDexLimits {
  totalOiCap: string;
  oiSzCapPerPerp: string;
  maxTransferNtl: string;
  coinToOiCap: [string, string][];
}

export interface BookLevel {
  px: string;
  sz: string;
  n: number;
}

/** `levels[0]` holds bids (best first), `levels[1]` asks (best first). At most 20 per side. */
export interface L2Book {
  coin: string;
  time: number;
  levels: [BookLevel[], BookLevel[]];
}

export interface Trade {
  coin: string;
  /** "B" when the taker bought, "A" when the taker sold. */
  side: "A" | "B";
  px: string;
  sz: string;
  time: number;
  hash: string;
  tid: number;
  users: [string, string];
}

/** Every WebSocket message has this envelope; the `data` type depends on the channel. */
export interface WsMessage {
  channel: string;
  data?: unknown;
}

export interface ActiveAssetCtxData {
  coin: string;
  ctx: PerpAssetCtx;
}

/** Contexts per DEX, keyed by DEX name ("" is core), in the same order as that DEX's `meta.universe`. */
export interface AllDexsAssetCtxsData {
  ctxs: [string, PerpAssetCtx[]][];
}
