// The incidents Telltale replays. Each window starts a few hours before the crash, so the
// detectors have the history they need (45 minutes of bars, 2 hours of walls) before it matters.

export type BookArchive = "hyperliquid-archive" | "reservoir";

export interface Incident {
  id: string;
  coin: string;
  name: string;
  /** The date as people refer to it. */
  date: string;
  /** Replay window, epoch ms (UTC). */
  from: number;
  to: number;
  /** HLP's loss as reported, in USD. */
  lossUsd: number;
  /** What happened, attributed to the reports, in Telltale's neutral wording. */
  summary: string;
  sources: { label: string; url: string }[];
  /** Where the order books come from: neither archive covers both dates. */
  books: BookArchive;
}

export const INCIDENTS: readonly Incident[] = [
  {
    id: "popcat-2025-11",
    coin: "POPCAT",
    name: "POPCAT",
    date: "November 12, 2025",
    from: Date.parse("2025-11-12T09:00:00Z"),
    to: Date.parse("2025-11-12T18:00:00Z"),
    lossUsd: 4_900_000,
    summary:
      "According to Lookonchain, as reported by CoinDesk, $3M was split across 19 wallets to build a $20–30M leveraged long, " +
      "and a $20M buy order was placed near $0.21 and then pulled. The price fell, the longs were liquidated, and HLP " +
      "absorbed about $4.9M once their collateral ran out.",
    sources: [
      {
        label: "CoinDesk, November 13, 2025",
        url: "https://www.coindesk.com/markets/2025/11/13/peak-degen-warfare-alleged-popcat-manipulation-hits-hyperliquid-with-usd4-9m-loss",
      },
    ],
    books: "hyperliquid-archive",
  },
  {
    id: "fartcoin-2026-04",
    coin: "FARTCOIN",
    name: "FARTCOIN",
    date: "April 8–9, 2026",
    from: Date.parse("2026-04-08T17:00:00Z"),
    to: Date.parse("2026-04-09T01:00:00Z"),
    lossUsd: 1_500_000,
    summary:
      "According to press reports, four wallets built a leveraged long of about 145M FARTCOIN. The price rose about 20–27% " +
      "and then reversed, the long was liquidated, and HLP absorbed losses reported at $1.2–1.5M.",
    sources: [
      { label: "Yellow, April 2026", url: "https://yellow.com/news/fartcoin-price-drop-whale-manipulation" },
      { label: "The Crypto Times, April 9, 2026", url: "https://www.cryptotimes.io/2026/04/09/fartcoin-drops-13-after-failed-manipulation-attempt-on-hyperliquid/" },
    ],
    books: "reservoir",
  },
];

export const incident = (id: string): Incident | undefined => INCIDENTS.find((i) => i.id === id);

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC dates the window touches, as YYYY-MM-DD. */
export function datesOf(i: Pick<Incident, "from" | "to">): string[] {
  const out: string[] = [];
  for (let t = i.from - (i.from % 86_400_000); t < i.to; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** UTC hours the window touches, as [YYYYMMDD, hour]. */
export function hoursOf(i: Pick<Incident, "from" | "to">): [string, number][] {
  const out: [string, number][] = [];
  for (let t = i.from - (i.from % 3_600_000); t < i.to; t += 3_600_000) {
    const d = new Date(t);
    out.push([`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, d.getUTCHours()]);
  }
  return out;
}
