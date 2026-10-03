# @telltale/detectors

The market-risk metrics, A–E grades and alert detectors behind [Telltale](https://telltale.markets), which rates every market on Hyperliquid. Everything is a pure function of market data with no dependencies, so you can run the same checks inside a trading bot, a vault's risk monitor, a HIP-3 deployer's dashboard or a backtest.

```bash
npm install @telltale/detectors
```

Node 22 or later, or any modern bundler. TypeScript types are included.

## Order-book depth

```ts
import { summarizeBook, toLevels } from "@telltale/detectors";

const res = await fetch("https://api.hyperliquid.xyz/info", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "l2Book", coin: "BTC", nSigFigs: 3 }),
});
const { levels: [bids, asks] } = await res.json();
const book = summarizeBook(toLevels(bids), toLevels(asks));

book.bidDepth[2] + book.askDepth[2]; // USD resting within ±2% of mid
book.reachPct; // how far the visible book reaches; depth beyond it is a lower bound
```

Hyperliquid's book feed shows 20 levels a side. Grouping prices to 3 significant figures (`nSigFigs: 3`) lets those levels reach further from mid.

## Pulled walls

`WallTracker` follows the large orders in a stream of book snapshots and reports how each one ended: filled, moved (re-quoted nearby, which market makers do all the time), expired, or pulled before the price reached it. It learns each market's usual large order, so only walls far beyond it raise a signal.

```ts
import { pulledWallSignal, toLevels, WallTracker } from "@telltale/detectors";

const walls = new WallTracker();

// For every l2Book message from the WebSocket:
for (const event of walls.onBook(coin, toLevels(bids), toLevels(asks), time)) {
  const signal = pulledWallSignal(event, dex); // null unless the wall was pulled and far beyond the usual
  if (signal) console.log(signal.severity, signal.title, signal.detail);
}

// For every trade, so fills aren't mistaken for pulls:
walls.onTrade(coin, side, Number(px), Number(px) * Number(sz));
```

## Grades and alerts

`marketMetrics` turns minute bars (oracle, mark and mid price, open interest, depth within 1/2/5% of mid, oracle update timing) into the five graded metrics, and `gradeMarket` turns those into a grade from A (Strong) to E (Fragile) with the reasons behind it. `detectMinute` checks the latest minute for the conditions behind past losses: the mark price pulling away from the oracle, an oracle stuck while its market moves, a deployer's oracle disagreeing with another's, depth collapsing, and open interest surging into a thin book.

```ts
import { detectMinute, gradeMarket, marketMetrics } from "@telltale/detectors";

const metrics = marketMetrics({ coin, maxLeverage, oiCapUsd, bars, candles, peers });
const { grade, score, reasons } = gradeMarket(metrics);

for (const signal of detectMinute({ coin, dex, oiCapUsd, bars: last45Minutes, peers })) {
  console.log(signal.kind, signal.severity, signal.title);
}
```

The [collector](https://github.com/vignesh-chaturvedi/telltale/tree/main/apps/collector) shows how to build those bars from Hyperliquid's public API. [The methodology](https://telltale.markets/methodology) explains every metric, threshold and alert, and what the grades can't tell you.

Grades describe market conditions. They say nothing about anyone's intent and aren't trading advice.

## License

Apache-2.0
