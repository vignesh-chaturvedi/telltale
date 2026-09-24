import assert from "node:assert/strict";
import { test } from "node:test";
import { InfoClient, InfoError, infoWeight } from "../src/info.ts";
import { TokenBucket, type Clock } from "../src/limiter.ts";

const noWait: Clock = { now: () => 0, sleep: async () => {} };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("weights follow the official table", () => {
  assert.equal(infoWeight({ type: "l2Book", coin: "BTC" }), 2);
  assert.equal(infoWeight({ type: "allMids" }), 2);
  assert.equal(infoWeight({ type: "userRole", user: "0x0" }), 60);
  assert.equal(infoWeight({ type: "metaAndAssetCtxs" }), 20);
  assert.equal(infoWeight({ type: "perpDexs" }), 20);
});

test("posts the request body to /info", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: [null] }]);
  const client = new InfoClient({ url: "https://api.example", fetch: impl, clock: noWait });
  assert.deepEqual(await client.perpDexs(), [null]);
  assert.deepEqual(calls, [{ url: "https://api.example/info", body: { type: "perpDexs" } }]);
});

test("omits the dex field for core metadata and sends it for HIP-3", async () => {
  const { impl, calls } = fakeFetch([
    { status: 200, body: [{}, []] },
    { status: 200, body: [{}, []] },
  ]);
  const client = new InfoClient({ url: "https://api.example", fetch: impl, clock: noWait });
  await client.metaAndAssetCtxs();
  await client.metaAndAssetCtxs("xyz");
  assert.deepEqual(
    calls.map((c) => c.body),
    [{ type: "metaAndAssetCtxs" }, { type: "metaAndAssetCtxs", dex: "xyz" }],
  );
});

test("retries rate-limited and server errors, then succeeds", async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, body: "slow down" },
    { status: 502, body: "bad gateway" },
    { status: 200, body: { ok: true } },
  ]);
  const client = new InfoClient({ url: "https://api.example", fetch: impl, clock: noWait });
  assert.deepEqual(await client.request({ type: "exchangeStatus" }), { ok: true });
  assert.equal(calls.length, 3);
});

test("does not retry client errors", async () => {
  const { impl, calls } = fakeFetch([{ status: 422, body: "bad request" }]);
  const client = new InfoClient({ url: "https://api.example", fetch: impl, clock: noWait });
  await assert.rejects(client.l2Book("NOPE"), (err: unknown) => err instanceof InfoError && err.status === 422);
  assert.equal(calls.length, 1);
});

test("charges each attempt's weight to the shared limiter", async () => {
  const { impl } = fakeFetch([
    { status: 429, body: "" },
    { status: 200, body: {} },
  ]);
  const limiter = new TokenBucket({ perMinute: 1200, clock: noWait });
  const client = new InfoClient({ url: "https://api.example", fetch: impl, limiter, clock: noWait });
  await client.l2Book("BTC");
  assert.equal(limiter.taken, 4);
});
