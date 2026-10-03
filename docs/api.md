# Telltale API

Everything on [telltale.markets](https://telltale.markets) comes from a small read-only JSON API. Exchanges, vaults, wallets and dashboards can use it to show a market's grade next to the market, or to react to alerts.

- **Base URL:** `https://telltale.markets`. A self-hosted copy (`pnpm serve`) serves the same API.
- **No key, no sign-up.** Every endpoint is a `GET`.
- **Any site can call it from the browser.** Responses carry `Access-Control-Allow-Origin: *`.
- **Fresh every minute.** Grades cover the last 60 minutes and are recomputed every minute. Responses are cached for 30 seconds, so polling more than once a minute gets you nothing new.
- **Times** are epoch milliseconds, in UTC. **Money** is in USD. **Gaps** are in basis points (1 bp = 0.01%).

## Market names

Core markets use their ticker: `BTC`, `HYPE`. Markets listed by other deployers (HIP-3) are prefixed with the deployer's DEX name: `xyz:GOLD`, `para:TOTAL2`. In a URL, encode the colon as `%3A`: `/api/markets/xyz%3AGOLD`.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `/api/board` | Every market's grade and headline numbers, plus each DEX's summary |
| `/api/markets/{coin}` | One market: every metric, the grade with its reasons, 24 hours of history, recent alerts |
| `/api/dexes/{slug}` | One DEX and its markets. The slug is the DEX name, or `core` for Hyperliquid's own markets |
| `/api/alerts` | Recent alerts, newest first |
| `/api/badge/{coin}.svg` | The market's grade as an image to embed |
| `/api/health` | Whether the data is fresh |

### `GET /api/board`

```json
{
  "generatedAt": 1790988000000,
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
| `metrics` | Every measured number, including the ungraded ones: `depth2Usd`, `thinnestDepth2Usd`, `liquidationDistancePct`, `dailyVolPct`, `oiCapUse`, `oracleUnchangedOver10sShare`, `peers`, `coverageMinutes` |
| `grade` | The grade, `score`, `bands`, `reasons` (each with a sentence of `text`) and `notes` (context that isn't graded, such as an oracle that stays still while its underlying market is closed) |
| `history` | Five-minute steps over 24 hours: `markPx`, `oraclePx`, largest `oracleGapBps`, `depth2Usd`, `oiUsd` |
| `alerts` | The market's 10 latest alerts |
| `maxLeverage`, `dexName`, `dexSlug` | Market settings and the deployer |

Unknown or delisted markets return `404`.

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

Errors are JSON, `{ "error": "No live market named NOPE." }`, with the usual status codes: `400` for a malformed URL, `404` for an unknown market, DEX or path, `405` for anything but `GET` and `HEAD`, and `503` for the few seconds after a restart before the first scorecard is ready.

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
