# Telltale

Live safety ratings for every market on Hyperliquid.

Telltale grades each Hyperliquid market (core perps, HIP-3 exchanges and HIP-4 venues) on published metrics: oracle freshness, order-book depth against open interest, position concentration and recent deployer changes. It raises an alert when a market starts to look like a past manipulation incident.

Status: in development for the Hyperliquid track of Colosseum's Crypto World's Fair (Sep 14 – Oct 12, 2026).

## Layout

- `packages/detectors`: metrics and detectors as pure functions, with no dependencies
- `packages/hl`: read-only Hyperliquid API clients and types
- `apps/collector`: the live data pipeline, grading, alerts and JSON API

## Requirements

Node 24 or later (it runs TypeScript directly) and pnpm.

## Running the collector

```bash
pnpm install
pnpm collect            # streams mainnet into data/telltale.db; Ctrl-C stops it cleanly
pnpm collect:status     # coverage per minute, WebSocket gaps and storage growth
```

`pnpm collect --testnet` uses testnet, `--db <path>` picks another database file, and `--minutes <n>` stops after a fixed time.

The collector uses only the public Hyperliquid API and stays inside its per-IP limits. It sends about 750 WebSocket subscriptions over 4 connections and uses about 300 REST weight a minute. Every live market gets one row per minute with oracle, mark, open interest, funding, impact spread, order-book depth within 1%, 2% and 5% of mid, and trade flow. HIP-3 markets also get oracle update timing. Daily candles for the last 31 days are refreshed every 6 hours.

## Grading markets

```bash
pnpm score                      # every DEX and market, weakest first, over the last 60 minutes
pnpm score --coin xyz:SP500     # one market's metrics, grade and reasons
pnpm score --dex xyz --window 120
pnpm score --json               # the full scorecard, for other tools
```

Each market gets a grade from A (Strong) to E (Fragile), built from depth against open interest, the cost to move the price to liquidation levels, the gap between the mid price and the oracle, agreement with other deployers of the same ticker, and 50%+ daily moves. [docs/methodology.md](docs/methodology.md) defines every metric and threshold, and lists what the grades can't tell you.

## Development

```bash
pnpm typecheck
pnpm test               # unit tests against recorded API responses
pnpm fixtures:record    # re-record those responses from mainnet
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
