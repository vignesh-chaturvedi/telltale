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

```bash
pnpm install
pnpm typecheck
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
