# Telltale API

Everything on [telltale.markets](https://telltale.markets) comes from a small read-only JSON API. Exchanges, vaults, wallets and dashboards can use it to show a market's grade next to the market, or to react to alerts.

- **Base URL:** `https://telltale.markets`. A self-hosted copy (`pnpm serve`) serves the same API.
- **No key, no sign-up.** Every endpoint is a `GET`.
- **Any site can call it from the browser.** Responses carry `Access-Control-Allow-Origin: *`.
- **Fresh every minute.** Grades cover the last 60 minutes and are recomputed every minute. Responses are cached for 30 seconds, so polling more than once a minute gets you nothing new.
- **Times** are epoch milliseconds, in UTC. **Money** is in USD. **Gaps** are in basis points (1 bp = 0.01%).
- **Versioned rules.** The board, market, DEX, history and wallet responses carry `methodologyVersion`, the version of [the methodology](https://telltale.markets/methodology) their numbers follow. It goes up whenever a rule changes.

## Market names

Core markets use their ticker: `BTC`, `HYPE`. Markets listed by other deployers (HIP-3) are prefixed with the deployer's DEX name: `xyz:GOLD`, `para:TOTAL2`. In a URL, encode the colon as `%3A`: `/api/markets/xyz%3AGOLD`.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `/api/board` | Every market's grade and headline numbers, plus each DEX's summary |
| `/api/markets/{coin}` | One market: every metric, the grade with its reasons, 24 hours of history, recent alerts |
| `/api/markets/{coin}/history` | Every check step by step over 24 hours, 7 days or 30 days, with each one's usual range |
| `/api/wallets/{address}` | One wallet's open positions, read live from Hyperliquid, each with its market's grade and the book in the way of its liquidation |
| `/api/dexes/{slug}` | One DEX and its markets. The slug is the DEX name, or `core` for Hyperliquid's own markets |
| `/api/alerts` | Recent alerts, newest first |
| `/api/track-record` | Every public warning, and how volatile the hour after it was |
| `/api/badge/{coin}.svg` | The market's grade as an image to embed |
| `/api/health` | Whether the data is fresh |

### `GET /api/board`

```json
{
  "generatedAt": 1790988000000,
  "methodologyVersion": "1",
  "windowMinutes": 60,
  "from": 1790984400000,
  "to": 1790987940000,
  "dataAgeSeconds": 20,
  "counts": { "A": 81, "B": 222, "C": 23, "D": 3, "E": 1 },
  "dexes": [
    {
      "dex": "xyz",
      "slug": "xyz",
      "fullName": "XYZ",
      "collateral": "USDC",
      "status": "active",
      "markets": 110,
      "graded": 110,
      "oiUsd": 3796339407.13,
      "counts": { "A": 34, "B": 71, "C": 5, "D": 0, "E": 0 },
      "grade": "A",
      "score": 3.52,
      "reasons": [],
      "notes": ["Collateral: USDC."]
    }
  ],
  "markets": [
    {
      "coin": "xyz:GOLD",
      "dex": "xyz",
      "grade": "A",
      "score": 3.67,
      "oiUsd": 278194046.63,
      "volume24hUsd": 69466800,
      "depthToOi": 0.0861,
      "liquidationMoveCostUsd": 10909168,
      "liquidationBandPct": 2,
      "moveCostIsLowerBound": false,
      "oracleGapBps": 0.6,
      "peerGapBps": null,
      "bigMoveDays30": 0,
      "spreadBps": 0.24,
      "bands": { "depthToOi": "B", "liquidationMoveCost": "A", "oracleGap": "A", "bigMoves": "A" },
      "reasons": [],
      "ungradedNote": null
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `grade` | `A` (strong) to `E` (fragile), or `null` when there isn't enough data yet; `ungradedNote` says why |
| `score` | The weighted score behind the grade, 0 to 4 |
| `depthToOi` | USD resting within ±2% of the mid price, as a share of open interest |
| `liquidationMoveCostUsd` | Orders needed on the thinner side to move the price `liquidationBandPct`%, about as far as a maximum-leverage position can move before liquidation. When `moveCostIsLowerBound` is true, the visible book didn't reach that far, so the real cost is higher |
| `oracleGapBps` | How far the mid price was from the oracle price (95th percentile) |
| `peerGapBps` | How far the oracle was from other deployers' oracles for the same asset (95th percentile); `null` when no one else lists it |
| `bigMoveDays30` | Days in the last 30 whose high or low was more than 50% from the open |
| `bands` | The grade each metric earned on its own |
| `reasons` | Metrics graded C or worse, worst first, with a short label |

[The methodology](https://telltale.markets/methodology) explains each metric, its weight and the band edges.

### `GET /api/markets/{coin}`

Everything on the board row, plus:

| Field | Meaning |
| --- | --- |
| `metrics` | Every measured number, including the ungraded ones: `markPx`, `depth2Usd`, `sideDepthUsd` (each side's median depth within 1%, 2% and 5%), `thinnestDepth2Usd`, `liquidationDistancePct`, `dailyVolPct`, `oiCapUse`, `oracleUnchangedOver10sShare`, `peers`, `coverageMinutes`, and the experimental `adjustedMoveCostUsd` with the `pullRate` behind it (`rate`, the share of large walls' USD pulled over 14 days, and `walls`, how many ended; `null` under 20) |
| `grade` | The grade, `score`, `bands`, `reasons` (each with a sentence of `text`) and `notes` (context that isn't graded, such as an oracle that stays still while its underlying market is closed) |
| `history` | Five-minute steps over 24 hours: `markPx`, `oraclePx`, largest `oracleGapBps`, `depth2Usd`, `oiUsd`. For every check and longer ranges, use `/history` below |
| `alerts` | The market's 10 latest alerts |
| `positions` | Experimental, not graded: the positions sample described below. `null` until the collector has read any accounts |
| `maxLeverage`, `dexName`, `dexSlug` | Market settings and the deployer |

Unknown or delisted markets return `404`.

### `GET /api/markets/{coin}/history`

Every check step by step, measured the way the grade measures it but over each step instead of the last 60 minutes. `range` is `24h` (5-minute steps, the default), `7d` (hourly steps, so each point is that hour's own grade input) or `30d` (4-hour steps).

```json
{
  "methodologyVersion": "1",
  "coin": "xyz:SP500",
  "range": "7d",
  "stepMinutes": 60,
  "from": 1792850400000,
  "to": 1793451600000,
  "liquidationBandPct": 1,
  "peers": [],
  "minuteBarsFrom": null,
  "points": [
    { "t": 1792850400000, "markPx": 6875.7, "oraclePx": 6873.1, "oiUsd": 501200000, "depth2Usd": 25400000, "depthToOi": 0.050678,
      "moveCostUsd": 5710000, "adjustedMoveCostUsd": 5320000, "oracleGapBps": 4.1, "peerGapBps": null, "spreadBps": 2.3, "funding": 0.0000125 }
  ],
  "summary": { "moveCostUsd": { "p10": 2390000, "p50": 4000000, "p90": 6920000, "latest": 2440000 } },
  "dailyMoves": [{ "day": 1790812800000, "movePct": 1.2 }]
}
```

| Field | Meaning |
| --- | --- |
| `points` | One per step from `from` to `to`, with nulls where there's no data. Depth, cost to liquidation and spread are the step's medians, the oracle and peer gaps its 95th percentile, and prices, open interest and `funding` (the hourly rate) its last minute |
| `moveCostUsd` | Orders on the thinner side within `liquidationBandPct`, the same band the grade uses |
| `adjustedMoveCostUsd` | Experimental: the same with large walls counted at one minus the market's current pull rate. `null` without a pull rate, and before walls were recorded |
| `summary` | For each metric in `points` except prices: the 10th, 50th and 90th percentile of the steps, and the latest step |
| `minuteBarsFrom` | Minute bars are kept for 14 days. Steps before this time are built from 15-minute bars, whose depth and spread are averages. `null` when the whole range has minute bars |
| `dailyMoves` | The last 30 finished days' largest move from the open, in %, whatever the range: what the big-moves check counts |

A history is cached until the scorecard's next refresh, once a minute.

#### `positions`

Telltale reads the positions of accounts it sees trading, largest first; see [Positions](https://telltale.markets/methodology#positions-experimental) in the methodology. Only reads from the last `freshHours` hours count.

| Field | Meaning |
| --- | --- |
| `coverage` | Tracked longs plus shorts (`longUsd + shortUsd`) against twice the open interest, at most 1 |
| `topShare` | The 10 largest positions' share of all open positions; a lower bound when coverage is below 1 |
| `accounts`, `longAccounts`, `shortAccounts` | Accounts with a position in the sample |
| `traders24h` | Distinct accounts that traded the market in the last 24 hours |
| `largest` | The 10 largest positions: `address`, `side`, `positionUsd`, `liquidationPx`, `distancePct` (how far the mark must move to liquidate it) and `leverage` |
| `ladder` | 20 rungs of 1% from the mark: `longUsd` and `shortUsd` liquidating between `fromPct` and `toPct`, with account counts. `beyondUsd` is further than 20%, `unliquidatableUsd` has no liquidation price |
| `worstPush` | For `long` and `short`: the distance within 5% (`pct`) where the tracked positions liquidated (`liquidatedUsd`) are largest against the book in the way (`costUsd`), and their `ratio`; `null` when nothing liquidates within 5% |
| `nearestCluster` | For `long` and `short`: the closest 1% rung with $1M+ of liquidations, its `usd`, `accounts` and `costUsd` to reach its far edge (`null` past 5%) |
| `oldestPolledAt`, `newestPolledAt` | When the oldest and newest positions in the sample were read |

### `GET /api/wallets/{address}`

The address is `0x` and 40 hex digits. Each DEX is asked for the wallet's positions, so the answer is live; it's cached for 30 seconds per address, and the positions aren't stored.

```json
{
  "address": "0x…",
  "dexes": [{ "dex": "xyz", "slug": "xyz", "name": "XYZ", "accountUsd": 5000, "positionUsd": 76000 }],
  "positions": [
    {
      "coin": "xyz:SP500", "dex": "xyz", "side": "long", "size": 10, "positionUsd": 76000,
      "entryPx": 7550, "markPx": 7600, "liquidationPx": 7220, "distancePct": 5, "leverage": 20, "cross": true,
      "unrealizedPnlUsd": 500, "grade": "B", "graded": true, "pushCostUsd": 9500000, "liquidatedFirstUsd": 1200000
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `dexes` | Each DEX where the wallet has money or positions. `accountUsd` is Hyperliquid's perp account value there; for a unified account it leaves out the spot balances that also back the positions |
| `distancePct` | How far the mark must move to liquidate the position, %; `null` when the margin covers any price. Liquidation prices are Hyperliquid's own, so they count a unified account's spot balances |
| `pushCostUsd` | The book in the way of the liquidation price: bids for a long, asks for a short, from the market's median depth within 1%, 2% and 5%. `null` past 5%, or for a market Telltale doesn't grade |
| `liquidatedFirstUsd` | Other tracked positions on the same side that liquidate before this one, adding to a push |
| `grade`, `graded` | The market's grade; `graded` is false for a market Telltale doesn't know |

### `GET /api/alerts`

| Parameter | Effect |
| --- | --- |
| `severity=warning` | Warnings and critical alerts only. `severity=critical` keeps only critical ones |
| `coin=xyz:GOLD` | One market |
| `kind=pulled-wall` | One kind of alert |
| `limit=50` | How many, up to 200 (default 100) |

```json
{
  "public": true,
  "alerts": [
    {
      "id": 214,
      "kind": "pulled-wall",
      "coin": "xyz:GME",
      "dex": "xyz",
      "severity": "critical",
      "startedAt": 1790987335376,
      "updatedAt": 1790987335376,
      "resolvedAt": 1790987335376,
      "minutes": 1,
      "title": "A $3.1M bid wall was pulled after 54 s",
      "detail": "A bid of $3.1M at 25.100, 94% of the bid side within ±2% of mid and 19× this market's usual large order, was removed after 54 s with $2K filled, before the price reached it.",
      "evidence": { "side": "bid", "px": 25.1, "peakUsd": 3060380, "sideDepthUsd": 3270264, "typicalUsd": 164175, "filledUsd": 2486, "lifetimeMs": 53888 },
      "publishedAt": 1790987351547
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `kind` | `mark-divergence`, `stale-oracle`, `peer-divergence`, `depth-collapse`, `oi-surge`, `oi-cap`, `pulled-wall` or `deployer-change` |
| `severity` | `info` (shown on the site only), `warning` or `critical` (also sent to Telegram and webhooks) |
| `coin` | `null` for alerts about a whole DEX, such as a deployer changing settings |
| `resolvedAt` | `null` while the condition still holds; an alert resolves after 3 quiet minutes |
| `evidence` | The numbers that triggered it; the fields depend on the kind |
| `publishedAt` | When it was sent to the alert channels, or `null` if it wasn't |

What triggers each kind, and at what threshold, is in [the methodology](https://telltale.markets/methodology#alerts).

### `GET /api/track-record`

Every warning and critical alert about one market since alerts went public, measured an hour after it started. How the measure works is in [the methodology](https://telltale.markets/methodology#track-record).

```json
{
  "public": true,
  "generatedAt": 1791538662854,
  "liveSince": 1790756917775,
  "alertsSince": 1790946147000,
  "topRank": 0.9,
  "totals": { "alerts": 79, "measured": 72, "followed": 24, "controlHours": 181, "controlFollowed": 19, "pending": 0 },
  "kinds": [
    { "kind": "pulled-wall", "alerts": 41, "measured": 41, "followed": 7, "controlHours": 104, "controlFollowed": 9 }
  ],
  "recent": [
    {
      "id": 363,
      "kind": "oi-surge",
      "coin": "xyz:SOFTBANK",
      "severity": "warning",
      "startedAt": 1791504420000,
      "title": "Open interest up 40% in 15 minutes",
      "movePct": 2.46,
      "usualPct": 0.3,
      "rank": 0.985
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `totals.alerts` | Warnings and critical alerts about one market since `alertsSince` |
| `totals.measured` | Those whose next hour could be ranked |
| `totals.followed` | Measured alerts whose next hour ranked at or above `topRank` among the market's hours over the 7 days before |
| `totals.controlHours`, `controlFollowed` | The same time of day on the 3 days before each measured alert, ranked the same way: how often a top hour turns up anyway |
| `totals.pending` | Alerts whose hour isn't over yet, or hasn't been measured |
| `kinds` | The same counts for each kind of alert, most frequent first |
| `recent` | The 6 latest measured alerts, hits and misses alike. `movePct` is the largest move from the alert's price within the hour, `usualPct` the market's median hour, `rank` the share of its hours that moved less |

Until alerts are public it returns `{ "public": false }`.

### `GET /api/badge/{coin}.svg`

A 20-pixel-high badge with the market's live grade, for a market page, a vault's docs or a README:

```html
<a href="https://telltale.markets/markets/xyz%3AGOLD">
  <img src="https://telltale.markets/api/badge/xyz%3AGOLD.svg" alt="Telltale grade for xyz:GOLD" height="20">
</a>
```

```markdown
[![Telltale grade for xyz:GOLD](https://telltale.markets/api/badge/xyz%3AGOLD.svg)](https://telltale.markets/markets/xyz%3AGOLD)
```

It reads "not graded" while a market has too little data, and "unknown market" (with a `404`) for a name Telltale doesn't know. It's cached for 5 minutes. Every market page on the site has a copy-paste snippet under "Embed this grade".

### `GET /api/health`

`{ "ok": true, "now": …, "latestMinute": …, "dataAgeSeconds": 20, "markets": 330, "alerts": true }`. `ok` turns `false` when the newest data is more than 3 minutes old.

## Errors

Errors are JSON, `{ "error": "No live market named NOPE." }`, with the usual status codes: `400` for a malformed URL, an unknown `range` or a malformed wallet address, `404` for an unknown market, DEX or path, `405` for anything but `GET` and `HEAD`, and `503` for the few seconds after a restart before the first scorecard is ready. Wallet lookups can also return `429` when several are already running (try again in a minute), `502` when Hyperliquid didn't answer, and `503` on a self-hosted copy that has them turned off (`WALLET_LOOKUPS=0`).

## Alert webhooks

When you run your own copy, set `ALERT_WEBHOOK_URL` and every warning and critical alert is `POST`ed there as JSON: the alert fields above plus `url`, its page on the site. Set `ALERT_WEBHOOK_SECRET` too, and each request carries `X-Telltale-Signature: sha256=<hex>`, an HMAC-SHA256 of the raw body. Check it before trusting the payload:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verified(rawBody: string, header: string | undefined, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return header !== undefined && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

The public Telegram channel, [t.me/telltalemarkets](https://t.me/telltalemarkets), gets the same alerts.
