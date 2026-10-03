# How Telltale grades markets and raises alerts

Version 0 · September 2026

Telltale grades every live Hyperliquid perpetual market from A to E. It covers the core markets, whose oracles Hyperliquid's validators run, and HIP-3 markets, whose oracles their deployers run. Each grade comes with the numbers behind it. This document explains what is measured, how the numbers turn into a grade, and what the grades can't tell you.

A grade describes a market's condition over a recent window. It says nothing about anyone's intent. Telltale doesn't accuse deployers, traders or market makers of anything, and a low grade isn't an accusation.

## What the grades mean

| Grade | Name | In short |
|---|---|---|
| A | Strong | Deep for its open interest, costly to push around, and priced in line with its oracle |
| B | Sound | No serious weakness |
| C | Mixed | At least one weakness worth knowing about before trading |
| D | Weak | Several weaknesses, or one serious one |
| E | Fragile | Thin, cheap to move and/or far from its oracle |

## Data

Everything comes from Hyperliquid's public API, collected by the open-source collector in this repository:

- Market contexts (oracle, mark, mid, open interest, funding, impact prices) for every market, and a per-market stream for HIP-3 markets that shows each oracle update.
- Order books for every live market: streamed for the 300 thinnest, polled every 30 seconds for the deepest 28. Books are requested with prices grouped to three significant figures. At full precision the API shows only 20 ticks per side, which for BTC reaches 0.02% from the mid; grouped, the 20 levels reach past 2% on every market.
- Trades for streamed markets, and 30 days of daily candles for every market.
- Each DEX's configuration (deployer, oracle updater, fee settings, leverage, open-interest caps), stored whenever it changes.

Grades use the last **60 minutes** unless stated otherwise. A market needs at least 20 minutes with both a context and a book before it's graded.

## Graded metrics

Each metric falls into a band from A to E. The bands below are version 0 and will be tuned as more data comes in; every change will be listed at the end of this document.

### Depth against open interest · weight 30%

The median USD resting within ±2% of the mid price, divided by the market's open interest.

Open interest is what's at stake when prices move: a large liquidation has to trade through the book. A market with little depth for its open interest can gap sharply when positions unwind.

| A | B | C | D | E |
|---|---|---|---|---|
| ≥ 10% | ≥ 5% | ≥ 2% | ≥ 1% | < 1% |

### Cost to reach liquidation levels · weight 25%

The median USD of orders on the thinner side of the book needed to move the price by the distance that liquidates a position opened at maximum leverage.

A position at leverage *L* posts 1/*L* of its size as initial margin and is liquidated at roughly half that, so the distance is 50/*L* percent: 1.25% at 40x, 5% at 10x. The cost uses the widest measured band (1%, 2% or 5% from mid) that doesn't exceed that distance. When the visible book doesn't reach the band, the cost is marked as a lower bound.

This is the price of pushing a market far enough to set off liquidations, the pattern behind past losses at Hyperliquid's HLP vault.

| A | B | C | D | E |
|---|---|---|---|---|
| ≥ $2.5M | ≥ $500K | ≥ $100K | ≥ $25K | < $25K |

### Oracle gap · weight 25%

The 95th percentile, over the window, of the distance between the mid price and the oracle price, in basis points.

Liquidations and funding depend on the oracle. If the market trades far from its oracle, either the oracle isn't following the market or the book is thin enough to drift away from it. For HIP-3 markets the deployer runs the oracle, so this is the clearest view of how well it's maintained. Perps normally trade a few basis points from their oracle because of funding, so up to 20 bps still earns an A.

| A | B | C | D | E |
|---|---|---|---|---|
| ≤ 20 bps | ≤ 40 bps | ≤ 100 bps | ≤ 250 bps | > 250 bps |

### Agreement with other deployers · weight 10%

For HIP-3 markets whose ticker is also listed by another deployer (for example AVGO on two DEXs), the 95th percentile of the distance between the two oracles, in basis points. Markets that no other deployer lists skip this metric, and the other weights are scaled up.

Two deployers pricing the same stock should agree. A peer whose typical price differs by more than 20% is assumed to quote a different unit and is ignored.

| A | B | C | D | E |
|---|---|---|---|---|
| ≤ 10 bps | ≤ 25 bps | ≤ 75 bps | ≤ 200 bps | > 200 bps |

### Moves over 50% in a day · weight 10%

The number of days in the last 30 whose high or low was more than 50% from that day's open.

HIP-3's rules call for a validator review whenever a market moves more than 50% from its start-of-day price, and markets that do so more than once a month can't use cross margin. This metric applies the same test to trade prices.

| A | C | E |
|---|---|---|
| 0 days | 1 day | 2 or more days |

## From metrics to a grade

1. Each band is worth points: A 4, B 3, C 2, D 1, E 0.
2. The market score is the weighted average of the points for the metrics that could be measured.
3. **One serious problem limits the grade.** The grade can be at most two letters better than the market's worst metric, so a market with any E is graded C at best.
4. The score becomes a letter: A from 3.5, B from 2.5, C from 1.5, D from 0.75, E below that.

Every metric graded C or worse is listed as a reason, worst first, with the numbers behind it.

## DEX grades

A DEX's score is the average of its markets' scores, weighted by open interest, so the grade reflects where its traders' money is. If a quarter or more of its graded markets have a D or E oracle gap, the DEX is graded C at best. A DEX with no live markets is shown as dormant, not graded.

## Shown but not graded

- **Oracle updates on HIP-3 markets.** How long the oracle price goes unchanged, and in what share of minutes it stays unchanged for over 10 seconds. Hyperliquid falls back to its own mark after 10 seconds without a fresh oracle. An unchanged price isn't necessarily a missed update: the underlying market may be closed (Korean stocks during US hours), may have no public price (pre-IPO companies), or the deployer may be re-sending the same price. The oracle gap metric captures the part that matters to traders, so this is context only.
- **Open-interest cap use.** At 90% or more of its cap, a market may refuse new positions.
- **Impact spread, 24h volume and daily volatility.**

## Alerts

Grades describe a market over the last hour. Alerts report conditions as they happen, each one tied to how Hyperliquid markets have failed before. Like grades, alerts describe what the data shows. A pulled wall or a frozen oracle can have ordinary causes, and an alert says nothing about anyone's intent.

| Alert | Raised when | Information | Warning | Critical |
|---|---|---|---|---|
| Mark away from oracle | The mark price stays away from the oracle for 3 straight minutes | ≥ 200 bps | ≥ 300 bps | ≥ 1,000 bps |
| Oracle unchanged | A HIP-3 oracle stays unchanged for 60 s or more in each of 3 straight minutes, with the mid price away from it | ≥ 100 bps away | ≥ 200 bps away | |
| Deployers disagree | Two DEXs listing the same asset have oracles apart for 3 straight minutes (a 20%+ difference is treated as a different unit and ignored) | ≥ 100 bps | ≥ 200 bps | |
| Depth collapse | Depth within ±2% stays below a share of its median over the previous 30 minutes (skipping the 5 before) for 5 straight minutes, open interest holds at 90% or more, and the market has at least $500K of open interest and a $100K baseline | below 40%, leaving under 3% of open interest | below 25%, leaving under 2% | |
| Open-interest surge | Open interest rises 25% or more, and by at least $250K, within 15 minutes, in a market with less than 5% of its open interest within ±2% | | any | |
| Near open-interest cap | Open interest reaches 90% of its cap | any | | |
| Pulled wall | A large level stands for 30 s to 10 minutes and is removed with under 10% filled, before the price reaches it, and no similar wall goes up within 1% of its price in the next 15 s | | ≥ $250K, ≥ ⅔ of its side within ±2% (twice everything else) and ≥ 5× the market's usual wall over the past 2 hours | ≥ $2M, ≥ 80% of its side and ≥ 5× the usual wall |
| Deployer change | A DEX changes a setting: listing or delisting a market, leverage, open-interest caps, margin mode, fees, funding settings, the deployer, the oracle updater, or permissions | other changes | delisting, leverage, deployer, oracle updater or oracle permissions | |

**One alert per episode.** A condition that holds for several minutes is one alert, which closes after 3 checked minutes without it. After an alert starts, the same kind of alert for the same market stays quiet for 12 hours unless it gets more severe. An alert keeps the text of its most severe moment.

**What is sent where.** Every alert is listed on the site. Warnings and critical alerts are also posted to the Telegram channel and the webhook, at most 3 a minute and 20 a day, so a market-wide move can't flood the channel. Past those limits, alerts stay on the site.

**Pulled walls need live order books.** They're tracked on the 300 markets whose books are streamed (a snapshot about every 5 seconds) and on the 30 deepest, polled every 30 seconds. Prices are grouped to 3 significant figures, so a wall is a price bucket, possibly several orders. Large levels come and go constantly: market makers re-quote as the price moves, so a wall that reappears nearby within seconds counts as moved, not pulled, and only walls far beyond the market's usual size raise an alert. How every wall of $250K or more ended (pulled, moved, filled, or standing past 10 minutes) is stored as evidence.

**Calibration.** The minute alerts were first replayed over 21 hours of September 2026 data from all 329 markets. All eight then ran for 24 hours on live data before going public, recorded but not shown or sent. With the thresholds above, that comes to about 10 warnings a day across all markets, plus about 14 information alerts that stay on the site.

## Replays

To check whether the alerts would have helped, Telltale replays past losses through the same detector code the live site runs. The data comes from two public archives on AWS S3: Hyperliquid's own (per-minute oracle, mark and open interest for every market, and order books from 2025) and Hydromancer's Reservoir (order books once a minute from December 2025, and every fill, including liquidations).

The **crash** is the start of the steepest one-minute fall in the mark price. The **lead time** is how long before it the first warning (or critical) alert started. Information alerts don't count, and an alert after the crash is a miss.

| Incident | HLP's reported loss | First warning | Lead time |
|---|---|---|---|
| POPCAT, November 12, 2025 | about $4.9M | Open interest up 37% in 15 minutes | 2 h 8 min |
| FARTCOIN, April 8–9, 2026 | $1.2–1.5M | Open interest up 26% in 15 minutes | 13 min |

Both archives keep only the 20 best price levels on each side, about ±0.2% of the price, so the replays understate book depth. That matters for the open-interest surge alert, which also needs a thin book. Each replay therefore shows when that alert would have fired if the book had held 5, 10 or 20 times the archived depth. With 20 times, POPCAT's first warning still comes 56 minutes ahead; FARTCOIN's timing doesn't change. Each replay page lists what else its archive can't show, such as POPCAT's reported $20M order, which sat further from the price than the archive reaches.

## Known limits

- **Grouped books.** Depth is counted in price buckets of 0.1–0.6% of the price, so a band's edge is accurate to about one bucket. Books show at most 20 levels per side.
- **Oracle updates are seen only as price changes.** Telltale can't tell a re-sent unchanged price from a missed update without reading node data.
- **The window is short.** A 60-minute window reacts quickly and can swing with market hours; longer windows are planned for the public board.
- **Position concentration isn't measured yet.** How much of the open interest a few accounts hold needs data the public API doesn't provide. It's planned from daily account snapshots and, if available, Hydromancer's position data.
- **Daily moves use trade prices,** not the oracle price that HIP-3's rule refers to.
- **Peers are matched by exact ticker only.** Two listings of the same index under different names (such as an S&P 500 index and S&P 500 futures) aren't compared, because a futures basis would look like disagreement.

## Changes

- Replays (October 2, 2026): POPCAT and FARTCOIN replayed through the live detectors, with a depth check for the archives' partial order books.

- Alerts go live (October 2, 2026) after a 24-hour shadow run. In its first minutes the pulled-wall rule flagged about 60,000 walls a day, two thirds of them quotes being moved; walls must now not reappear nearby and must be far larger than the market's usual walls. A pulled wall now needs 5× the usual wall, not 3×: at 3× it raised 27 alerts in 26 hours, mostly routine.
- Alerts (September 30, 2026): eight alert types, calibrated by replaying 21 hours of data. Depth collapse was split into information and warning levels, because a single level raised about 10 warnings a day, mostly from ordinary quote refreshes.

- v0 (September 2026): first version, calibrated on three hours of data from all 328 live markets.
  - Oracle-gap bands were widened from A ≤ 10 bps to A ≤ 20 bps, because major core markets showed ordinary perp basis of 10–20 bps.
  - Liquidation-cost bands were lowered from A ≥ $5M (C ≥ $250K) to A ≥ $2.5M (C ≥ $100K). The earlier bands put the typical core market, which needs about $140K to move to its liquidation level, at D.
