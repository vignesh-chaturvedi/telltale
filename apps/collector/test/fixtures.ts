import { readFileSync } from "node:fs";
import type { InfoClient, WsMessage } from "@telltale/hl";

const dir = new URL("./fixtures/", import.meta.url);

export function fixture<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, dir), "utf8")) as T;
}

export const wsFixture = (channel: string): WsMessage[] => fixture<WsMessage[]>(`ws/${channel}.json`);

/**
 * An InfoClient that serves the recorded responses: core plus the xyz, para and flx DEXs,
 * each trimmed to a few markets. `edit` can change a response before it is returned.
 */
export function fixtureInfo(edit: (type: string, dex: string, body: unknown) => unknown = (_t, _d, b) => b): InfoClient {
  const serve = (type: string, dex: string, path: string) => Promise.resolve(edit(type, dex, fixture(path)));
  return {
    perpDexs: () => serve("perpDexs", "", "rest/perpDexs.json"),
    metaAndAssetCtxs: (dex = "") => serve("metaAndAssetCtxs", dex, `rest/meta-${dex || "core"}.json`),
    perpDexLimits: (dex: string) => serve("perpDexLimits", dex, `rest/limits-${dex}.json`),
    l2Book: () => serve("l2Book", "", "rest/l2Book-xyz_SP500.json"),
  } as unknown as InfoClient;
}
