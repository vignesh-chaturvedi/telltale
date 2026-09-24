// Records real API responses as small test fixtures: `pnpm fixtures:record`.
//
// Each DEX's universe is cut down to a handful of markets. The same positions are kept in the
// `allDexsAssetCtxs` sample, so the fixtures stay aligned the way the live API is.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InfoClient, MAINNET, type PerpDex, type WsMessage } from "@telltale/hl";

const out = join(import.meta.dirname, "../test/fixtures");
const info = new InfoClient({ url: MAINNET.api });
const DEXES = ["", "xyz", "para", "flx"];
const EXTRA: Record<string, (name: string, delisted: boolean) => boolean> = {
  "": (_name, delisted) => delisted,
  xyz: (name) => name === "xyz:SP500",
};
const KEEP_FIRST = 5;

const write = (path: string, data: unknown) => {
  mkdirSync(join(out, path, ".."), { recursive: true });
  writeFileSync(join(out, path), `${JSON.stringify(data, null, 1)}\n`);
};

// REST: pick positions per DEX, then trim every response to those markets.
const positions = new Map<string, number[]>();
const kept = new Set<string>();
for (const dex of DEXES) {
  const [meta, ctxs] = await info.metaAndAssetCtxs(dex);
  const extra = EXTRA[dex];
  const firstExtra = extra ? meta.universe.findIndex((u) => extra(u.name, u.isDelisted ?? false)) : -1;
  const pick = [...new Set([...meta.universe.keys()].slice(0, KEEP_FIRST).concat(firstExtra >= 0 ? [firstExtra] : []))].sort((a, b) => a - b);
  positions.set(dex, pick);
  pick.forEach((i) => kept.add(meta.universe[i]!.name));
  write(`rest/meta-${dex || "core"}.json`, [{ ...meta, marginTables: [], universe: pick.map((i) => meta.universe[i]) }, pick.map((i) => ctxs[i])]);
}
const keepPairs = <T extends [string, unknown]>(pairs: T[]) => pairs.filter(([coin]) => kept.has(coin));
const perpDexs = (await info.perpDexs()).filter((d): d is PerpDex | null => d === null || DEXES.includes(d.name)).map((d) =>
  d === null
    ? null
    : {
        ...d,
        assetToStreamingOiCap: keepPairs(d.assetToStreamingOiCap),
        assetToFundingMultiplier: keepPairs(d.assetToFundingMultiplier),
        assetToFundingInterestRate: keepPairs(d.assetToFundingInterestRate),
        assetToFundingClamp: keepPairs(d.assetToFundingClamp),
      },
);
write("rest/perpDexs.json", perpDexs);
for (const dex of DEXES.filter(Boolean)) {
  const limits = await info.perpDexLimits(dex);
  write(`rest/limits-${dex}.json`, { ...limits, coinToOiCap: keepPairs(limits.coinToOiCap) });
}
write("rest/l2Book-xyz_SP500.json", await info.l2Book("xyz:SP500"));

// WebSocket: one sample of each channel the collector handles.
const samples: Record<string, WsMessage[]> = {};
const want: Record<string, number> = { subscriptionResponse: 1, activeAssetCtx: 3, l2Book: 1, trades: 1, allDexsAssetCtxs: 1, pong: 1 };
const ws = new WebSocket(MAINNET.ws);
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`timed out; got ${Object.keys(samples).join(", ")}`)), 45_000);
  ws.onopen = () => {
    for (const subscription of [
      { type: "activeAssetCtx", coin: "xyz:SP500" },
      { type: "l2Book", coin: "xyz:SP500" },
      { type: "trades", coin: "BTC" },
      { type: "allDexsAssetCtxs" },
    ]) {
      ws.send(JSON.stringify({ method: "subscribe", subscription }));
    }
    ws.send(JSON.stringify({ method: "ping" }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as WsMessage;
    const list = (samples[msg.channel] ??= []);
    if (list.length < (want[msg.channel] ?? 0)) list.push(msg);
    if (Object.entries(want).every(([ch, n]) => (samples[ch]?.length ?? 0) >= n)) {
      clearTimeout(timeout);
      resolve();
    }
  };
});
ws.close();

const all = samples.allDexsAssetCtxs![0]!.data as { ctxs: [string, unknown[]][] };
all.ctxs = all.ctxs.filter(([dex]) => positions.has(dex)).map(([dex, ctxs]) => [dex, positions.get(dex)!.map((i) => ctxs[i])]);
for (const [channel, list] of Object.entries(samples)) write(`ws/${channel}.json`, list);
console.log(`Wrote fixtures for ${kept.size} markets to ${out}`);
