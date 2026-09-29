import { Info } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Freshness } from "../components/Freshness.tsx";
import { GradeBadge } from "../components/GradeBadge.tsx";
import { LineChart } from "../components/LineChart.tsx";
import { Num } from "../components/Num.tsx";
import { ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { dexPath, splitCoin, useApi, type MarketDetail } from "../lib/api.ts";
import { bps, count, percent, price, score, usd, utcTime, type Formatted } from "../lib/format.ts";
import { bandLines, GRADE_BADGE, GRADE_NAMES, GRADE_SUMMARY, GRADES, METRICS, type Grade, type MetricInfo } from "../lib/grades.ts";
import { NotFound } from "./NotFound.tsx";

export function Market() {
  const coin = useParams().coin ?? "";
  const { data, error, loading, receivedAt, retry } = useApi<MarketDetail>(`/api/markets/${encodeURIComponent(coin)}`);
  useEffect(() => {
    document.title = `${coin} · Telltale`;
  }, [coin]);

  if (error && "status" in error && error.status === 404) {
    return <NotFound title={`No live market named ${coin}.`} />;
  }
  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="link-muted">
              Markets
            </Link>
          </li>
          {data && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true">/</span>
              <Link to={dexPath(data.dexSlug)} className="link-muted">
                {data.dexName}
              </Link>
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="font-mono text-foreground">
              {coin}
            </span>
          </li>
        </ol>
      </nav>

      {loading && <MarketSkeleton />}
      {!data && error && <ErrorState title={`Couldn't load ${coin}.`} message={error.message} onRetry={retry} />}
      {data && <MarketBody market={data} receivedAt={receivedAt} />}
    </div>
  );
}

function MarketSkeleton() {
  return (
    <Loading label="Loading the market">
      <div className="space-y-10">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((m) => (
            <Skeleton key={m.key} className="h-40" />
          ))}
        </div>
      </div>
    </Loading>
  );
}

function MarketBody({ market, receivedAt }: { market: MarketDetail; receivedAt: number | null }) {
  const { metrics: m, grade: g } = market;
  const { ticker } = splitCoin(market.coin);
  return (
    <>
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <GradeBadge grade={g.grade} size="lg" note={g.notes[0]} />
          <div className="min-w-0">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {ticker}
              {market.dex && <span className="text-base font-normal text-muted-foreground"> on {market.dexName}</span>}
            </h1>
            <p className="text-sm text-muted-foreground">
              {g.grade ? (
                <>
                  <span className="text-foreground">{GRADE_NAMES[g.grade]}.</span> {GRADE_SUMMARY[g.grade]} Score <Num value={score(g.score)} /> of 4.
                </>
              ) : (
                "Not graded yet."
              )}
            </p>
          </div>
        </div>
        <Freshness dataAgeSeconds={market.dataAgeSeconds} receivedAt={receivedAt} windowMinutes={market.windowMinutes} />
      </header>

      {(g.reasons.length > 0 || g.notes.length > 0) && (
        <section aria-labelledby="why-title" className="max-w-3xl space-y-3">
          <h2 id="why-title" className="text-lg font-semibold">
            {g.reasons.length ? "What holds the grade back" : "Worth knowing"}
          </h2>
          <ul className="space-y-3">
            {g.reasons.map((r) => (
              <li key={r.metric} className="flex gap-3 rounded-lg border bg-card p-4">
                <GradeBadge grade={r.grade} />
                <div className="min-w-0">
                  <p className="font-medium">{r.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{r.text}</p>
                </div>
              </li>
            ))}
            {g.notes.map((note) => (
              <li key={note} className="flex gap-3 px-1 text-sm text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="metrics-title" className="space-y-4">
        <div>
          <h2 id="metrics-title" className="text-lg font-semibold">
            Graded metrics
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Over the {market.windowMinutes} minutes to {utcTime(market.to)}.{" "}
            <Link to="/methodology" className="link">
              How the bands were set
            </Link>
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((info) => (
            <li key={info.key}>
              <MetricCard info={info} value={info.format(m)} band={g.bands[info.key] ?? null} extra={metricExtra(info, market)} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="context-title" className="space-y-4">
        <h2 id="context-title" className="text-lg font-semibold">
          Market details
        </h2>
        <dl className="grid gap-x-8 rounded-lg border bg-card px-4 py-2 sm:grid-cols-2">
          <Detail term="Open interest" value={usd(m.oiUsd, "detailed")} />
          <Detail term="24h volume" value={usd(m.volume24hUsd, "detailed")} />
          <Detail term="Depth within ±2% (median)" value={usd(m.depth2Usd, "detailed")} />
          <Detail term="Thinnest depth within ±2%" value={usd(m.thinnestDepth2Usd, "detailed")} />
          <Detail term="Impact spread (median)" value={bps(m.spreadBps)} />
          <Detail term="Maximum leverage" value={{ ...count(market.maxLeverage), display: `${market.maxLeverage}x` }} />
          <Detail term="Move that liquidates at maximum leverage" value={percent(m.liquidationDistancePct / 100)} />
          <Detail term="Daily volatility (30 days)" value={percent(m.dailyVolPct === null ? null : m.dailyVolPct / 100)} />
          {m.oiCapUse !== null && <Detail term="Open-interest cap used" value={percent(m.oiCapUse)} />}
          {m.oracleUnchangedOver10sShare !== null && <Detail term="Minutes with the oracle unchanged over 10 s" value={percent(m.oracleUnchangedOver10sShare)} />}
          <Detail term="Minutes of data in the window" value={count(m.coverageMinutes)} />
        </dl>
      </section>

      <History market={market} />
    </>
  );
}

function metricExtra(info: MetricInfo, market: MarketDetail): string | null {
  const m = market.metrics;
  if (info.key === "liquidationMoveCost") return `Moves the price ${m.liquidationBandPct}%; ${market.maxLeverage}x positions liquidate at about ${+m.liquidationDistancePct.toFixed(2)}%.`;
  if (info.key === "peerGap") return m.peers.length ? `Compared with ${m.peers.join(", ")}.` : "No other deployer lists this asset.";
  return null;
}

function MetricCard({ info, value, band, extra }: { info: MetricInfo; value: Formatted; band: Grade | null; extra: string | null }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{info.name}</h3>
          <p className="text-xs text-muted-foreground">{Math.round(info.weight * 100)}% of the grade</p>
        </div>
        <GradeBadge grade={band} note="Not measured for this market" />
      </div>
      <p className="text-2xl font-semibold">
        <Num value={value} />
      </p>
      <p className="text-xs text-muted-foreground">{info.help}</p>
      {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
      <ol className="mt-auto grid grid-cols-5 gap-1 pt-1" aria-label="Grade bands">
        {GRADES.map((grade) => (
          <li
            key={grade}
            className={`rounded-sm border px-1 py-1 text-center ${grade === band ? GRADE_BADGE[grade] : "border-transparent text-muted-foreground"}`}
            aria-current={grade === band ? "true" : undefined}
          >
            <span className="block font-mono text-xs font-semibold">{grade}</span>
            <span className="block font-mono text-[10px] leading-tight tabular-nums">{info.bands[grade] ?? "–"}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function Detail({ term, value }: { term: ReactNode; value: Formatted }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-right text-sm">
        <Num value={value} />
      </dd>
    </div>
  );
}

function History({ market }: { market: MarketDetail }) {
  const h = market.history;
  const times = h.map((p) => p.t);
  const first = h[0]?.t;
  const covered = first !== undefined && market.to - first < 23 * 3600_000;
  const depthShare = h.map((p) => (p.depth2Usd !== null && p.oiUsd ? p.depth2Usd / p.oiUsd : null));
  const lastGap = [...h].reverse().find((p) => p.oracleGapBps !== null)?.oracleGapBps ?? null;
  const lastShare = [...depthShare].reverse().find((v) => v !== null) ?? null;
  const lastMark = [...h].reverse().find((p) => p.markPx !== null)?.markPx ?? null;

  return (
    <section aria-labelledby="history-title" className="space-y-4">
      <div>
        <h2 id="history-title" className="text-lg font-semibold">
          Last 24 hours
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Five-minute steps.{covered && first !== undefined ? ` Data starts at ${utcTime(first, true)}.` : ""}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <LineChart
            title="Mark and oracle price"
            summary={`The latest mark price is ${lastMark === null ? "unknown" : price(lastMark).ariaLabel}.`}
            times={times}
            series={[
              { label: "Mark", values: h.map((p) => p.markPx), color: "var(--primary)" },
              { label: "Oracle", values: h.map((p) => p.oraclePx), color: "var(--muted-foreground)", dashed: true },
            ]}
            format={(v) => price(v)}
            height={180}
          />
        </div>
        <LineChart
          title="Oracle gap, largest in each step"
          summary={`The latest gap between the mid and oracle price is ${lastGap === null ? "unknown" : bps(lastGap).ariaLabel}.`}
          times={times}
          series={[{ label: "Gap", values: h.map((p) => p.oracleGapBps), color: "var(--primary)" }]}
          format={bps}
          refs={bandLines("oracleGap")}
        />
        <LineChart
          title="Depth within ±2% against open interest"
          summary={`Depth is now ${lastShare === null ? "unknown" : percent(lastShare).ariaLabel} of open interest.`}
          times={times}
          series={[{ label: "Depth / OI", values: depthShare, color: "var(--primary)" }]}
          format={percent}
          refs={bandLines("depthToOi")}
        />
      </div>
    </section>
  );
}
