# Changelog

## Unreleased

- **History for every check.** `GET /api/markets/{coin}/history?range=24h|7d|30d` measures each graded check step by step, the way the grade measures it, with a usual range for each. Each metric card on a market page now charts its check over 24 hours, 7 days or 30 days, beside the 60-minute value the grade uses.
- **Cancel-adjusted cost to liquidation** (experimental, not graded). The collector records how much depth sits in large walls each minute (schema v6), and each market's pull rate comes from 14 days of walls that ended. The cost card shows the adjusted cost beside the raw one.
- **Pulled walls retuned.** A wall must stand 90 seconds before its pull is an alert, and pulled walls are never critical. Of 214 measured warnings, walls pulled sooner were followed by a top-10% hour no more often than their control hours.
- **Methodology version 1**, with open questions, and `methodologyVersion` in the API.
- **Positions** (experimental, not graded). The collector notes who trades each market from the trade stream, now streamed for every market on an active DEX, and reads those accounts' positions largest first, up to 150 reads a minute (schema v7). Each market page shows coverage, the largest accounts' share, a liquidation ladder, the worst push on each side and the nearest $1M+ cluster.
- **Check a wallet.** `/wallet/{address}` and `GET /api/wallets/{address}` read a wallet's open positions live, each with its market's grade, its distance to liquidation and the book in the way.
- **Methodology version 2**, describing positions. `deploy/deploy.sh` now waits up to a minute for the API to answer after a restart.

## 0.1.0 · 2026-10-13

The first release of Telltale, live at [telltale.markets](https://telltale.markets): A–E safety ratings for every market on Hyperliquid, with alerts.

- **Collector.** Streams every live Hyperliquid market, on the core exchange and the HIP-3 deployers, into one-minute bars in SQLite. Older bars roll up into 15-minute bars.
- **Grades.** Every market is graded A to E from five checks, each banded and weighted into one grade, with its reasons. The checks are depth against open interest, the cost to reach liquidation levels, the oracle gap, agreement with other deployers, and days with 50%+ moves. The rules are in [docs/methodology.md](docs/methodology.md).
- **Alerts.** Eight detectors cover pulled walls, stale oracles, depth collapse, open-interest surges, the mark price away from the oracle, deployers disagreeing, open interest near its cap, and deployer changes. Alerts go to the site, a public [Telegram channel](https://t.me/telltalemarkets) and a webhook.
- **Track record.** Every public warning is measured an hour after it starts: the next hour's largest move is ranked against the market's previous week, with the same hour on the 3 days before as a control.
- **Replays.** The same detectors run over Hyperliquid's S3 archive and Hydromancer's Reservoir, for POPCAT (November 2025) and FARTCOIN (April 2026).
- **API and badges.** A read-only JSON API that needs no key, and embeddable SVG grade badges, documented in [docs/api.md](docs/api.md).
- **`@telltale/detectors` 0.1.0.** The detector library, tested and packable on its own.
