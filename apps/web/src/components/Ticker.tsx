import { Link } from "react-router";
import { marketPath, splitCoin, type BoardMarket } from "../lib/api.ts";
import { usd } from "../lib/format.ts";
import { GradeBadge } from "./GradeBadge.tsx";

/**
 * A strip of live grades under the hero, the largest markets first: the reference's logo strip, made of
 * the product's own data. It drifts on its own, pauses under the pointer or keyboard focus, and with
 * reduced motion it holds still and scrolls sideways by hand instead.
 */
export function Ticker({ markets, count = 36 }: { markets: readonly BoardMarket[]; count?: number }) {
  const items = [...markets].filter((m) => m.grade !== null).sort((a, b) => (b.oiUsd ?? 0) - (a.oiUsd ?? 0)).slice(0, count);
  if (items.length === 0) return null;
  const row = (copy: number) =>
    items.map((m) => {
      const { ticker, dex } = splitCoin(m.coin);
      return (
        <li key={`${copy}-${m.coin}`} aria-hidden={copy > 0 || undefined}>
          <Link
            to={marketPath(m.coin)}
            viewTransition
            tabIndex={copy > 0 ? -1 : undefined}
            className="inline-flex min-h-11 items-center gap-2.5 px-1 text-sm whitespace-nowrap transition-colors hover:text-primary"
          >
            <GradeBadge grade={m.grade} />
            <span className="font-mono font-medium">{ticker}</span>
            {dex && <span className="font-mono text-xs text-muted-foreground">{dex}</span>}
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{usd(m.oiUsd).display}</span>
          </Link>
        </li>
      );
    });
  return (
    <section aria-label="Live grades of the largest markets" className="ticker border-b bg-card">
      <div className="ticker-window overflow-hidden motion-reduce:overflow-x-auto">
        <ul className="ticker-track flex w-max gap-10 py-3 pr-10">
          {row(0)}
          {row(1)}
        </ul>
      </div>
    </section>
  );
}
