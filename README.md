# Telltale

Live safety ratings for every market on Hyperliquid.

Telltale grades every live Hyperliquid perpetual market, core and HIP-3, from A (Strong) to E (Fragile) on published metrics: order-book depth against open interest, the cost to move the price to liquidation levels, the gap between the market and its oracle, agreement between deployers listing the same asset, and 50%+ daily moves. Every grade comes with the numbers behind it. Alerts report, as they happen, the conditions behind past losses on Hyperliquid: the mark price pulling away from the oracle, an oracle frozen while its market moves, order books thinning out, walls pulled before the price reaches them, and deployer changes.

Status: in development for the Hyperliquid track of Colosseum's Crypto World's Fair (Sep 14 – Oct 12, 2026).

## Layout

- `packages/detectors`: metrics and detectors as pure functions, with no dependencies
- `packages/hl`: read-only Hyperliquid API clients and types
- `apps/collector`: the live data pipeline, grading and the JSON API
- `apps/web`: the website (Vite, React, Tailwind), served by the API server in production
- `apps/replay`: replays of past incidents from public archives, through the live detectors
- `deploy`: server setup, systemd units and the Caddy config

## Requirements

Node 24 or later (it runs TypeScript directly) and pnpm.

## Running the collector

```bash
pnpm install
pnpm collect            # streams mainnet into data/telltale.db; Ctrl-C stops it cleanly
pnpm collect:status     # coverage per minute, WebSocket gaps and storage growth
```

`pnpm collect --testnet` uses testnet, `--db <path>` picks another database file, and `--minutes <n>` stops after a fixed time. Minute bars take about 95 MB a day. They're kept for 14 days (`--keep-days <n>`); every hour, older ones are rolled into 15-minute bars, so after two weeks the database levels off at about 1.3 GB and grows by roughly 6 MB a day.

The collector uses only the public Hyperliquid API and stays inside its per-IP limits. It sends about 750 WebSocket subscriptions over 4 connections and uses about 300 REST weight a minute. Every live market gets one row per minute with oracle, mark, open interest, funding, impact spread, order-book depth within 1%, 2% and 5% of mid, and trade flow. HIP-3 markets also get oracle update timing. Daily candles for the last 31 days are refreshed every 6 hours.

## Grading markets

```bash
pnpm score                      # every DEX and market, weakest first, over the last 60 minutes
pnpm score --coin xyz:SP500     # one market's metrics, grade and reasons
pnpm score --dex xyz --window 120
pnpm score --json               # the full scorecard, for other tools
```

Each market gets a grade from A (Strong) to E (Fragile), built from depth against open interest, the cost to move the price to liquidation levels, the gap between the mid price and the oracle, agreement with other deployers of the same ticker, and 50%+ daily moves. [docs/methodology.md](docs/methodology.md) defines every metric and threshold, and lists what the grades can't tell you.

## Alerts

The collector checks every market each minute, and every streamed order book as it arrives. [docs/methodology.md](docs/methodology.md#alerts) lists each alert and its thresholds.

```bash
pnpm alerts                   # alerts recorded in the last 24 hours (--hours 72, --all for information too)
pnpm alerts --replay          # run the detectors over the stored minutes and count what they'd raise
```

Alerts are always recorded. Two switches in the environment (`.env`, or `/etc/telltale.env` on the server) control the rest:

| Variable | Effect |
|---|---|
| `ALERTS_PUBLISH=1` | Send warnings and critical alerts to the channels below (off during the shadow run) |
| `ALERTS_PUBLIC=1` | Show alerts on the website and in the API |
| `ALERTS_PUBLIC_SINCE` | Show only alerts from this ISO date on, e.g. to keep a shadow run's alerts private |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Post to a Telegram channel |
| `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET` | POST each alert as JSON, signed with `X-Telltale-Signature: sha256=…` when a secret is set |

## Replays

```bash
pnpm replay                   # replay every incident; or name one: pnpm replay popcat-2025-11
```

Replays run past losses through the live detector code and write `apps/web/public/replays/<id>.json`, which the website shows at `/replays`. The data comes from Hyperliquid's public S3 archive and Hydromancer's Reservoir archive. Both are requester-pays: the AWS CLI must be configured, and you pay AWS a few cents of transfer per incident. Files are cached in `data/replay/`. Incidents are defined in `apps/replay/src/incidents.ts`.

## Website and API

```bash
pnpm serve              # JSON API and the built website on http://127.0.0.1:8740
pnpm web                # website with hot reload on http://localhost:5178, using the API above
pnpm build              # production build into apps/web/dist, which `pnpm serve` picks up
```

The API recomputes every grade once a minute:

| Endpoint | Returns |
|---|---|
| `GET /api/board` | Every market and DEX with its grade, reasons and key numbers |
| `GET /api/markets/:coin` | One market's metrics, grade breakdown and the last 24 hours in 5-minute steps |
| `GET /api/dexes/:slug` | One DEX and its markets (`core` for Hyperliquid's own) |
| `GET /api/alerts` | The latest alerts, newest first; `?severity=warning`, `coin`, `kind` and `limit` narrow it |
| `GET /api/health` | Age of the newest data; `ok` is false once it's over 3 minutes old |

## Deploying

Telltale runs on one small VM: the collector and the server as systemd services, with Caddy in front for HTTPS. On a fresh Ubuntu 24.04 server:

```bash
curl -fsSL https://raw.githubusercontent.com/vignesh-chaturvedi/telltale/main/deploy/setup.sh | bash
```

Then point the domain's `A` records (`@` and `www`) at the server's public IP; Caddy fetches certificates on its own. After that, `TELLTALE_HOST=ubuntu@<ip> deploy/deploy.sh` ships whatever is on `main`.

## Development

```bash
pnpm typecheck
pnpm test               # unit tests against recorded API responses
pnpm fixtures:record    # re-record those responses from mainnet
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
