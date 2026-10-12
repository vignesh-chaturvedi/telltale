# Changelog

## 0.1.0 · 2026-10-13

The first release of Telltale, live at [telltale.markets](https://telltale.markets): A–E safety ratings for every market on Hyperliquid, with alerts.

- **Collector.** Streams every live Hyperliquid market, on the core exchange and the HIP-3 deployers, into one-minute bars in SQLite. Older bars roll up into 15-minute bars.
- **Grades.** Every market is graded A to E from five checks, each banded and weighted into one grade, with its reasons. The checks are depth against open interest, the cost to reach liquidation levels, the oracle gap, agreement with other deployers, and days with 50%+ moves. The rules are in [docs/methodology.md](docs/methodology.md).
- **Alerts.** Eight detectors cover pulled walls, stale oracles, depth collapse, open-interest surges, the mark price away from the oracle, deployers disagreeing, open interest near its cap, and deployer changes. Alerts go to the site, a public [Telegram channel](https://t.me/telltalemarkets) and a webhook.
- **Track record.** Every public warning is measured an hour after it starts: the next hour's largest move is ranked against the market's previous week, with the same hour on the 3 days before as a control.
- **Replays.** The same detectors run over Hyperliquid's S3 archive and Hydromancer's Reservoir, for POPCAT (November 2025) and FARTCOIN (April 2026).
- **API and badges.** A read-only JSON API that needs no key, and embeddable SVG grade badges, documented in [docs/api.md](docs/api.md).
- **`@telltale/detectors` 0.1.0.** The detector library, tested and packable on its own.
