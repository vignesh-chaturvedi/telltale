export interface Network {
  name: "mainnet" | "testnet";
  api: string;
  ws: string;
}

export const MAINNET: Network = {
  name: "mainnet",
  api: "https://api.hyperliquid.xyz",
  ws: "wss://api.hyperliquid.xyz/ws",
};

export const TESTNET: Network = {
  name: "testnet",
  api: "https://api.hyperliquid-testnet.xyz",
  ws: "wss://api.hyperliquid-testnet.xyz/ws",
};

/**
 * Per-IP limits from the official "Rate limits and user limits" page. Budgets used by the
 * collector stay below these so a burst never trips them.
 */
export const LIMITS = {
  restWeightPerMinute: 1200,
  wsConnections: 10,
  wsNewConnectionsPerMinute: 30,
  wsSubscriptions: 1000,
  wsMessagesSentPerMinute: 2000,
} as const;
