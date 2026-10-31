import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MarketDetail, MarketPositions } from "../lib/api.ts";
import { count, percent, price, usd, utcTime, wholePercent, type Formatted } from "../lib/format.ts";
import { Num } from "./Num.tsx";
import { EmptyState } from "./States.tsx";

/** 0x1234…abcd */
export const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Longs and shorts get two calm colors, distinct from the grade scale. */
const LONG = "bg-primary";
const SHORT = "bg-foreground/45";

/** Experimental and not graded: concentration and the liquidation map from the accounts read so far. */
export function Positions({ market }: { market: MarketDetail }) {
  const p = market.positions;
  if (!p) return null;
  return (
    <section aria-labelledby="positions-title" className="space-y-4">
      <div className="max-w-2xl">
        <h2 id="positions-title" className="text-lg font-semibold">
          Positions <span className="text-sm font-normal text-muted-foreground">· experimental, not graded</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hyperliquid has no list of everyone holding a market, so Telltale reads the accounts it sees trading, largest first. These are the positions read in the
          last {p.freshHours} hours; coverage says how much of the open interest that is.{" "}
          <Link to="/methodology#positions-experimental" className="link">
            How it's worked out
          </Link>
        </p>
      </div>
      {p.accounts === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState title="No positions read for this market yet.">
            <p>
              {p.traders24h > 0
                ? `${count(p.traders24h, ["account", "accounts"]).display} traded it in the last 24 hours; their positions are read as the budget allows.`
                : "Accounts are read once they're seen trading, and none has traded this market in the last 24 hours."}
            </p>
          </EmptyState>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
            <Stat term="Coverage" value={wholePercent(p.coverage)} note={`${usd(p.longUsd + p.shortUsd).display} of ${usd(market.metrics.oiUsd === null ? null : 2 * market.metrics.oiUsd).display} in longs and shorts`} />
            <Stat term="Largest 10 accounts hold" value={wholePercent(p.topShare)} note={p.coverage !== null && p.coverage < 1 ? "of all open positions, at least" : "of all open positions"} />
            <Stat term="Accounts long / short" value={{ display: `${p.longAccounts} / ${p.shortAccounts}`, raw: "", ariaLabel: `${p.longAccounts} long, ${p.shortAccounts} short` }} note={`${count(p.accounts, ["account", "accounts"]).display} with a position`} />
            <Stat term="Traded in 24 hours" value={count(p.traders24h)} note="distinct accounts" />
          </dl>
          <Pushes positions={p} />
          <Ladder positions={p} markPx={market.metrics.markPx} />
          <Largest positions={p} />
          <p className="text-xs text-muted-foreground">
            Read between {utcTime(p.oldestPolledAt, true)} and {utcTime(p.newestPolledAt, true)}. Sizes are at the mark price when each account was read.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ term, value, note }: { term: string; value: Formatted; note: string }) {
  return (
    <div className="bg-card p-4">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-1">
        <Num value={value} className="text-2xl font-semibold" />
        <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
      </dd>
    </div>
  );
}

/** A push that liquidates less than a tenth of what it costs isn't worth a sentence. */
const NOTABLE_PUSH_RATIO = 0.1;

/** One plain sentence per side: the cheapest push for what it liquidates, and the nearest big cluster. */
function Pushes({ positions: p }: { positions: MarketPositions }) {
  const lines: ReactNode[] = [];
  let notable = false;
  for (const side of ["long", "short"] as const) {
    const push = p.worstPush[side];
    const book = side === "long" ? "bids" : "asks";
    const way = side === "long" ? "down" : "up";
    if (push && push.ratio >= NOTABLE_PUSH_RATIO) {
      notable = true;
      lines.push(
        <li key={`push-${side}`}>
          Pushing the price {way} {push.pct}% takes about <Num value={usd(push.costUsd)} /> of {book} and would liquidate <Num value={usd(push.liquidatedUsd)} /> of
          tracked {side}s{push.ratio >= 1 ? <>, <strong className="font-semibold">more than the push costs</strong></> : null}.
        </li>,
      );
    }
    const cluster = p.nearestCluster[side];
    if (cluster) {
      lines.push(
        <li key={`cluster-${side}`}>
          The nearest $1M+ cluster of {side} liquidations is {cluster.fromPct}–{cluster.toPct}% {side === "long" ? "below" : "above"} the mark:{" "}
          <Num value={usd(cluster.usd)} /> across {count(cluster.accounts, ["account", "accounts"]).display}
          {cluster.costUsd !== null ? (
            <>
              , about <Num value={usd(cluster.costUsd)} /> of {book} away
            </>
          ) : (
            ", past the 5% of book Telltale measures"
          )}
          .
        </li>,
      );
    }
  }
  if (!notable) {
    lines.unshift(<li key="push-none">Within 5% of the mark, no push would liquidate a tenth of what it costs in tracked positions.</li>);
  }
  return <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm">{lines}</ul>;
}

/** Liquidations by distance from the mark: longs to the left (the price falling), shorts to the right. */
function Ladder({ positions: p, markPx }: { positions: MarketPositions; markPx: number | null }) {
  const lastUsed = p.ladder.findLastIndex((r) => r.longUsd > 0 || r.shortUsd > 0);
  const rungs = p.ladder.slice(0, Math.max(10, lastUsed + 1));
  const max = Math.max(1, ...rungs.flatMap((r) => [r.longUsd, r.shortUsd]));
  const width = (v: number) => `${(v / max) * 100}%`;
  const extra = [
    sides(p.beyondUsd) && `${sides(p.beyondUsd)} liquidate further than 20% away`,
    sides(p.unliquidatableUsd) && `${sides(p.unliquidatableUsd)} have no liquidation price`,
  ].filter(Boolean);
  return (
    <figure className="rounded-lg border bg-card p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">Liquidations by distance from the mark</span>
        {markPx !== null && (
          <span className="text-xs text-muted-foreground">
            Mark <Num value={price(markPx)} />
          </span>
        )}
      </figcaption>
      <table className="mt-3 w-full table-fixed text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2 text-right font-normal">
              <span className={`mr-1.5 inline-block size-2 rounded-sm ${LONG}`} aria-hidden="true" />
              Longs, if the price falls
            </th>
            <th scope="col" className="w-20 pb-2 text-center font-normal">
              Distance
            </th>
            <th scope="col" className="pb-2 text-left font-normal">
              <span className={`mr-1.5 inline-block size-2 rounded-sm ${SHORT}`} aria-hidden="true" />
              Shorts, if it rises
            </th>
          </tr>
        </thead>
        <tbody>
          {rungs.map((r) => (
            <tr key={r.fromPct} className={r.toPct === 5 ? "border-b border-dashed border-muted-foreground/60" : undefined}>
              <td className="py-0.5">
                <div className="flex items-center justify-end gap-2">
                  {r.longUsd > 0 && <Num value={usd(r.longUsd)} className="shrink-0 text-muted-foreground" />}
                  <div className="flex h-3.5 min-w-0 flex-1 justify-end">
                    <div className={`h-full rounded-l-sm ${LONG}`} style={{ width: width(r.longUsd) }} />
                  </div>
                </div>
              </td>
              <th scope="row" className="py-0.5 text-center font-mono font-normal tabular-nums text-muted-foreground">
                {r.fromPct}–{r.toPct}%
              </th>
              <td className="py-0.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-3.5 min-w-0 flex-1">
                    <div className={`h-full rounded-r-sm ${SHORT}`} style={{ width: width(r.shortUsd) }} />
                  </div>
                  {r.shortUsd > 0 && <Num value={usd(r.shortUsd)} className="shrink-0 text-muted-foreground" />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        The dashed line is 5%, as far as Telltale measures the book. {extra.length > 0 && `${extra.join("; ")}.`}
      </p>
    </figure>
  );
}

/** "$11M of longs and $2.8M of shorts", leaving out a side with nothing. */
function sides(usdBySide: Record<"long" | "short", number>): string {
  return (["long", "short"] as const)
    .filter((side) => usdBySide[side] > 0)
    .map((side) => `${usd(usdBySide[side]).display} of ${side}s`)
    .join(" and ");
}

function Largest({ positions: p }: { positions: MarketPositions }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="px-4 pt-3 text-left text-sm font-medium">Largest positions read</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-4 py-2 text-left font-normal">Account</th>
            <th scope="col" className="px-4 py-2 text-left font-normal">Side</th>
            <th scope="col" className="px-4 py-2 text-right font-normal">Size</th>
            <th scope="col" className="px-4 py-2 text-right font-normal">Liquidation price</th>
            <th scope="col" className="px-4 py-2 text-right font-normal">Distance</th>
            <th scope="col" className="px-4 py-2 text-right font-normal">Leverage</th>
          </tr>
        </thead>
        <tbody>
          {p.largest.map((x) => (
            <tr key={x.address} className="border-b last:border-b-0">
              <td className="px-4 py-2">
                <Link to={`/wallet/${x.address}`} className="link font-mono text-xs" title={x.address}>
                  {shortAddress(x.address)}
                </Link>
              </td>
              <td className="px-4 py-2 capitalize">{x.side}</td>
              <td className="px-4 py-2 text-right">
                <Num value={usd(x.positionUsd)} />
              </td>
              <td className="px-4 py-2 text-right">{x.liquidationPx === null ? <span className="text-muted-foreground">None</span> : <Num value={price(x.liquidationPx)} />}</td>
              <td className="px-4 py-2 text-right">
                <Num value={percent(x.distancePct === null ? null : x.distancePct / 100)} />
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{x.leverage}x</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
