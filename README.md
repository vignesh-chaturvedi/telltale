# Telltale

[![CI](https://github.com/vignesh-chaturvedi/telltale/actions/workflows/ci.yml/badge.svg)](https://github.com/vignesh-chaturvedi/telltale/actions/workflows/ci.yml)

Live safety ratings for every market on Hyperliquid: **[telltale.markets](https://telltale.markets)**

Telltale grades every live Hyperliquid perpetual market, core and HIP-3, from A (Strong) to E (Fragile) on published metrics: order-book depth against open interest, the cost to move the price to liquidation levels, the gap between the market and its oracle, agreement between deployers listing the same asset, and 50%+ daily moves. Every grade comes with the numbers behind it. Alerts report, as they happen, the conditions behind past losses on Hyperliquid: the mark price pulling away from the oracle, an oracle frozen while its market moves, order books thinning out, walls pulled before the price reaches them, and deployer changes. Replays run those same detectors over past incidents to show whether they would have warned in time.

[Board](https://telltale.markets) · [Alerts on Telegram](https://t.me/telltalemarkets) · [Replays](https://telltale.markets/replays) · [Methodology](docs/methodology.md) · [API](docs/api.md) · [@telltalemarkets](https://x.com/telltalemarkets)

[![Telltale grade for BTC](https://telltale.markets/api/badge/BTC.svg)](https://telltale.markets/markets/BTC) [![Telltale grade for xyz:GOLD](https://telltale.markets/api/badge/xyz%3AGOLD.svg)](https://telltale.markets/markets/xyz%3AGOLD) [![Telltale grade for HYPE](https://telltale.markets/api/badge/HYPE.svg)](https://telltale.markets/markets/HYPE)

Live since September 30, 2026. Built for the Hyperliquid track of Colosseum's Crypto World's Fair (Sep 14 – Oct 12, 2026).

## Quickstart

You need Node 24 or later (it runs TypeScript directly) and pnpm 11 (`npm install -g pnpm`). No API keys: everything comes from Hyperliquid's public API.

```bash
git clone https://github.com/vignesh-chaturvedi/telltale.git
cd telltale
pnpm install
pnpm collect --minutes 5        # stream every live market into data/telltale.db for 5 minutes
pnpm score --window 3           # grade them all on the last 3 minutes, weakest first
pnpm build && pnpm serve --window 3
```

The last line serves the board and the API on http://127.0.0.1:8740. To keep them current, run `pnpm collect` without `--minutes` in another terminal. After an hour you can drop `--window`, and the grades use the live site's 60-minute window.

## Layout

- `packages/detectors`: metrics and detectors as pure functions, with no dependencies
- `packages/hl`: read-only Hyperliquid API clients and types
- `apps/collector`: the live data pipeline, grading and the JSON API
- `apps/web`: the website (Vite, React, Tailwind), served by the API server in production
- `apps/replay`: replays of past incidents from public archives, through the live detectors
- `deploy`: server setup, systemd units and the Caddy config

## Collector

```bash
pnpm install
pnpm collect            # streams mainnet into data/telltale.db; Ctrl-C stops it cleanly
pnpm collect:status     # coverage per minute, WebSocket gaps and storage growth
```

`pnpm collect --testnet` uses testnet, `--db <path>` picks another database file, and `--minutes <n>` stops after a fixed time. Minute bars take about 95 MB a day. They're kept for 14 days (`--keep-days <n>`); every hour, older ones are rolled into 15-minute bars, so after two weeks the database levels off at about 1.3 GB and grows by roughly 6 MB a day.

The collector uses only the public Hyperliquid API and stays inside its per-IP limits. It sends about 750 WebSocket subscriptions over 4 connections and uses about 360 REST weight a minute, against a limit of 1,200. Every live market gets one row per minute with oracle, mark, open interest, funding, impact spread, order-book depth within 1%, 2% and 5% of mid, and trade flow. HIP-3 markets also get oracle update timing. Daily candles for the last 31 days are refreshed every 6 hours.

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

The API is public and read-only, needs no key, and any site can call it from the browser. It recomputes every grade once a minute:

| Endpoint | Returns |
|---|---|
| `GET /api/board` | Every market and DEX with its grade, reasons and key numbers |
| `GET /api/markets/:coin` | One market's metrics, grade breakdown and the last 24 hours in 5-minute steps |
| `GET /api/dexes/:slug` | One DEX and its markets (`core` for Hyperliquid's own) |
| `GET /api/alerts` | The latest alerts, newest first; `?severity=warning`, `coin`, `kind` and `limit` narrow it |
| `GET /api/badge/:coin.svg` | The market's live grade as a badge to embed, like the ones above |
| `GET /api/health` | Age of the newest data; `ok` is false once it's over 3 minutes old |

[docs/api.md](docs/api.md) documents every field, the badge snippets and the signed alert webhooks. The same reference is at [telltale.markets/developers](https://telltale.markets/developers).

## Using the detectors in your own code

`packages/detectors` holds every metric, grade and alert as pure functions with no dependencies, so a bot, a vault's risk monitor or a deployer's dashboard can run the same checks. Its [README](packages/detectors/README.md) has examples. `pnpm detectors:pack` builds the npm package and checks it loads as plain JavaScript and type-checks in a strict project.

## Deploying

Telltale runs on one small VM: the collector and the server as systemd services, with Caddy in front for HTTPS. On a fresh Ubuntu 24.04 server:

```bash
curl -fsSL https://raw.githubusercontent.com/vignesh-chaturvedi/telltale/main/deploy/setup.sh | bash
```

Then point the domain's `A` records (`@` and `www`) at the server's public IP; Caddy fetches certificates on its own. After that, `TELLTALE_HOST=ubuntu@<ip> deploy/deploy.sh` ships whatever is on `main`.

`pnpm traffic` reports visitors per day (from Caddy's access logs, counting only browsers that ran the app), referrers, badge loads, API calls from other sites, Telegram subscribers and alerts sent. On the server the logs are readable by root only:

```bash
sudo node --env-file=/etc/telltale.env /opt/telltale/apps/collector/src/traffic-cli.ts --db /var/lib/telltale/telltale.db
```

## Development

```bash
pnpm typecheck
pnpm test               # unit tests against recorded API responses
pnpm fixtures:record    # re-record those responses from mainnet
pnpm detectors:pack     # pack the detectors package and check what would be published
```

[CI](.github/workflows/ci.yml) runs the typecheck, the tests, the website build and the package check on every push and pull request. [A second workflow](.github/workflows/uptime.yml) checks the live site's health every 15 minutes.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
