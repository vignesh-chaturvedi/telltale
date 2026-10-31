# How Telltale grades markets and raises alerts

Version 2 · November 1, 2026. What changed in each version is listed under [Changes](#changes), and the parts we're least sure of under [Open questions](#open-questions).

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

Each metric falls into a band from A to E. The bands below haven't changed since version 0 and will be tuned as more data comes in; every change is listed under [Changes](#changes).

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

## Cancel-adjusted cost (experimental)

The cost to reach liquidation levels counts every order resting in the book, but large orders can be cancelled as the price comes toward them. This experimental number discounts them by how often they have been. It isn't graded.

- **Walls.** Each minute, the collector records how much of each side's depth within 1%, 2% and 5% sits in large levels: $250K or more, and at least 5 times the side's median level or a quarter of its depth within ±2%. That's the test the wall tracker uses for pulled-wall alerts.
- **Pull rate.** Every wall of $250K or more is stored when it ends, with how it ended: traded against, moved nearby, standing for over 10 minutes, or pulled before the price reached it. A market's pull rate is the share of its walls' USD that was pulled over the last 14 days. It needs at least 20 ended walls.
- **Adjusted cost.** Each minute, depth outside walls counts in full and wall depth counts at one minus the pull rate. Then, as for the raw cost, it takes the cheaper side and the median over 60 minutes.

Because both numbers are medians, a wall that stands for less than half the hour barely moves either of them; the adjustment matters where large walls stand most of the time. It assumes a wall is as likely to be pulled when the price heads toward it as on an ordinary day, which is probably optimistic in a fast move. The history charts apply today's pull rate to each minute's walls, which are recorded only from this version on.

## Positions (experimental)

Who holds a market's open interest, and where their positions liquidate, decides how far a push can cascade. Hyperliquid's public API shows any one account's positions but has no list of everyone holding a market, so Telltale reads a sample: the accounts it sees trading. None of this is graded.

- **Accounts.** Every trade names its buyer and seller. The collector notes who traded each market, when and for how much, and keeps it for 14 days. For this, trades are streamed for every market on an active DEX, including the deep ones whose books are polled.
- **Reads.** An account's positions are read one DEX at a time, up to 150 reads a minute: 300 of the collector's 1,000 REST weight. The largest accounts go first, by the USD they held at their last read plus what they've traded since. An account holding $1M or more on a DEX is read again every 10 minutes, $100K or more every 30 minutes, anything less every 2 hours, and an empty one daily. A trade brings the next read forward, but not to within 10 minutes of the last one.
- **Coverage.** Only positions read in the last 6 hours count. Coverage is the tracked longs plus shorts against twice the open interest, since every contract has a long side and a short side.
- **Concentration.** The 10 largest accounts' share of all open positions. When coverage is partial it's a lower bound.
- **Liquidation ladder.** Tracked positions by how far the mark must move to liquidate them, in 1% steps out to 20%: longs as the price falls, shorts as it rises. Sizes are at the mark price when each account was read.
- **The worst push.** For each distance out to 5%, the book in the way (bids for a fall, asks for a rise, interpolated between the median depth within 1%, 2% and 5%) against the tracked positions that distance would liquidate. The page shows the distance where that ratio is highest. Above 1, a push liquidates more than it costs, and the liquidations then trade into the same book.
- **The nearest cluster.** The closest 1% step on each side with $1M or more of tracked liquidations, and the book in the way of its far edge.
- **Check a wallet.** Any address's positions are read live, one call per DEX, and each liquidation price gets the same push price, plus the tracked positions on the same side that liquidate first. The positions read aren't stored.

Accounts that hold without trading aren't found until they trade, so coverage builds over the first days and stays partial where positions are held for weeks. A cross-margin position's liquidation price depends on the account's other positions, so each read is a snapshot. Large positions may be liquidated in parts, and what the book can't take goes to the backstop liquidator or to auto-deleveraging, so the push ratio is a guide to the pressure, not a simulation of a cascade.

## History

Every check is also charted over the last 24 hours, 7 days and 30 days, to show whether today's number is usual for the market. Each point is the check measured the way the grade measures it, over one step instead of the last 60 minutes: 5-minute steps for 24 hours, hourly steps for 7 days and 4-hour steps for 30 days. Depth, the cost to reach liquidation levels and spread are the step's medians, the oracle and peer gaps its 95th percentile, and price, open interest and funding its last minute. On the 7-day chart, each point is the number the grade would have used for that hour.

The shading on each chart is where the check usually sits: the 10th to 90th percentile of the steps in view. Days with 50%+ moves are charted as each finished day's largest move from its open, over the last 30 days.

Minute bars are kept for 14 days. Older steps are built from 15-minute bars, which keep each quarter hour's average depth and spread and its last minute's prices, so older depth on the 30-day chart is slightly smoother. The grade still uses only the last 60 minutes.

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
| Pulled wall | A large level stands for 90 s to 10 minutes and is removed with under 10% filled, before the price reaches it, and no similar wall goes up within 1% of its price in the next 15 s | | ≥ $250K, ≥ ⅔ of its side within ±2% (twice everything else) and ≥ 5× the market's usual wall over the past 2 hours | |
| Deployer change | A DEX changes a setting: listing or delisting a market, leverage, open-interest caps, margin mode, fees, funding settings, the deployer, the oracle updater, or permissions | other changes | delisting, leverage, deployer, oracle updater or oracle permissions | |

**One alert per episode.** A condition that holds for several minutes is one alert, which closes after 3 checked minutes without it. After an alert starts, the same kind of alert for the same market stays quiet for 12 hours unless it gets more severe. An alert keeps the text of its most severe moment.

**What is sent where.** Every alert is listed on the site. Warnings and critical alerts are also posted to the Telegram channel and the webhook, at most 3 a minute and 20 a day, so a market-wide move can't flood the channel. Past those limits, alerts stay on the site.

**Pulled walls need live order books.** They're tracked on the 300 markets whose books are streamed (a snapshot about every 5 seconds) and on the 30 deepest, polled every 30 seconds. Prices are grouped to 3 significant figures, so a wall is a price bucket, possibly several orders. Large levels come and go constantly: market makers re-quote as the price moves, so a wall that reappears nearby within seconds counts as moved, not pulled, and only walls far beyond the market's usual size raise an alert. How every wall of $250K or more ended (pulled, moved, filled, or standing past 10 minutes) is stored as evidence.

**Calibration.** The minute alerts were first replayed over 21 hours of September 2026 data from all 329 markets. All eight then ran for 24 hours on live data before going public, recorded but not shown or sent. With the thresholds above, that comes to about 10 warnings a day across all markets, plus about 14 information alerts that stay on the site.

## Track record

The home page checks every warning against what happened next, so the alerts can be judged by their results rather than by examples picked afterwards.

**What's counted.** Every warning and critical alert about one market since alerts went public on October 2, 2026. Information alerts aren't sent anywhere, and alerts about a whole DEX have no single price to follow, so neither counts.

**The measure.** An hour after an alert starts, Telltale takes the market's mid price at the alert's minute and finds the largest move from it, up or down, over the next 60 minutes. That move is ranked against the same measure for the market's own hours over the 7 days before the alert, one hour starting every 15 minutes, all of them over before the alert's hour begins. An hour at or above the 90th percentile is one of the market's most volatile tenth.

**The comparison.** Some hours are busier for everyone: a stock market opening, a data release. So the same time of day on each of the 3 days before the alert is ranked the same way, each against its own previous week. If alerts meant nothing, the hours after them would land in the top tenth about as often as those control hours do.

**When an hour can't be ranked.** It needs a mid price for at least 40 of its 60 minutes, and the market needs at least 96 baseline hours, about a day of history. Alerts that fall short are counted as warnings but left out of the shares, and the home page says how many. The comparison only appears once 20 warnings have been measured.

**What it doesn't show.** A volatile hour after a warning is not the same as a warning that came first. Some alerts fire because a market is already moving (a mark price pulling away from its oracle, an oracle that stops updating mid-move), so part of what follows is the same move carrying on. The record shows that warnings mark the hours that matter. It doesn't claim they predict which way a price will go, or by how much. Groups of a few alerts of one kind swing a lot, so the breakdown by kind is rough.

Each alert is measured once, when its hour is over, and the result is stored. The record keeps every alert even after the minute bars it came from are rolled up. It's available as JSON at [`/api/track-record`](/developers#get-api-track-record).

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
- **The window is short.** A 60-minute window reacts quickly and can swing with market hours. The history charts show how far each check swings; grading on longer windows is planned.
- **Positions are a sample.** Telltale finds accounts by seeing them trade, so a holder who hasn't traded since the collector started isn't counted. Each market shows its coverage.
- **Daily moves use trade prices,** not the oracle price that HIP-3's rule refers to.
- **Peers are matched by exact ticker only.** Two listings of the same index under different names (such as an S&P 500 index and S&P 500 futures) aren't compared, because a futures basis would look like disagreement.

## Open questions

These are the parts of the method we're least sure of. If you trade or run these markets and see them differently, [open an issue](https://github.com/vignesh-chaturvedi/telltale/issues); changes to the rules are listed below.

- **How to treat cancels.** The cost to reach liquidation levels counts resting orders as if they'll stay. The experimental cancel-adjusted cost discounts large walls by how often they've been pulled, but it uses an ordinary day's pull rate, and walls may be pulled more often exactly when the price heads for them. It leaves smaller orders alone, though market makers widen or pull their quotes in fast moves too. Is the pull rate the right discount, and should smaller levels be discounted as well?
- **Grading on distributions.** Grades use the last 60 minutes. A market that's deep most of the day but thin for an hour each night grades well most of the day. Grading on each check's distribution over a week, such as its worst hours or how often it falls below a band, would catch that, but grades would react more slowly. Which matters more: the market now, or how bad it gets?
- **Positions.** Who holds the open interest matters: a few large accounts near their liquidation prices make a cascade likelier than many small ones. The experimental positions sample covers the accounts seen trading, not everyone. How much of the open interest has to be covered before concentration or the push ratio is worth grading, and should the ratio count the book beyond 5%?

## Changes

### Version 2 · November 1, 2026

Grades are unchanged.

- Positions (November 1, 2026): an experimental, ungraded sample of who holds each market, read from the accounts seen trading, with coverage, the largest accounts' share, a liquidation ladder, the worst push on each side and the nearest $1M+ cluster. Trades are now streamed for every market on an active DEX (schema v7 adds traders, accounts and positions).
- Check a wallet (November 1, 2026): any address's open positions, read live, each with its market's grade, its distance to liquidation and the book in the way.

### Version 1 · October 31, 2026

Grades are unchanged.

- Pulled walls retuned (October 31, 2026), from the track record's 214 measured pulled-wall warnings (October 2–29). Walls pulled within 90 seconds were followed by a top-10% hour 22% of the time, no more than their control hours (22%), while walls that stood longer were followed 27% of the time against 14%. A wall must now stand 90 seconds, not 30, which would have cut these warnings by about a quarter (from 7.8 to 5.7 a day) and kept 42 of the 55 followed by a top-10% hour. Pulled walls are no longer critical: walls of $2M or more and 80% of their side were followed no more often than smaller ones (25% against 26%).
- Cancel-adjusted cost (October 31, 2026): an experimental, ungraded cost to reach liquidation levels that discounts large walls by how often the market's walls were pulled over 14 days. The collector now records each minute's wall depth (schema v6).
- History (October 31, 2026): every check charted over 24 hours, 7 days and 30 days, each point measured the way the grade measures it, with the usual range shaded.
- Open questions, and version numbers for this document. The API reports the version as `methodologyVersion`.

### Version 0 · September 25 – October 9, 2026

- Track record (October 9, 2026): every public warning is measured an hour after it starts, against the market's own week and the same hour on the 3 days before.
- Replays (October 2, 2026): POPCAT and FARTCOIN replayed through the live detectors, with a depth check for the archives' partial order books.
- Alerts go live (October 2, 2026) after a 24-hour shadow run. In its first minutes the pulled-wall rule flagged about 60,000 walls a day, two thirds of them quotes being moved; walls must now not reappear nearby and must be far larger than the market's usual walls. A pulled wall now needs 5× the usual wall, not 3×: at 3× it raised 27 alerts in 26 hours, mostly routine.
- Alerts (September 30, 2026): eight alert types, calibrated by replaying 21 hours of data. Depth collapse was split into information and warning levels, because a single level raised about 10 warnings a day, mostly from ordinary quote refreshes.
- Grades (September 25, 2026): first version, calibrated on three hours of data from all 328 live markets.
  - Oracle-gap bands were widened from A ≤ 10 bps to A ≤ 20 bps, because major core markets showed ordinary perp basis of 10–20 bps.
  - Liquidation-cost bands were lowered from A ≥ $5M (C ≥ $250K) to A ≥ $2.5M (C ≥ $100K). The earlier bands put the typical core market, which needs about $140K to move to its liquidation level, at D.
