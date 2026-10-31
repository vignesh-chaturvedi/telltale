import { Info } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { AlertItem } from "../components/AlertItem.tsx";
import { EmbedBadge } from "../components/EmbedBadge.tsx";
import { Freshness } from "../components/Freshness.tsx";
import { GradeBadge } from "../components/GradeBadge.tsx";
import { LineChart } from "../components/LineChart.tsx";
import { Num } from "../components/Num.tsx";
import { ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { dexPath, splitCoin, useApi, type HistoryRange, type MarketDetail, type MarketHistory, type MetricSummary, type SummarizedMetric } from "../lib/api.ts";
import { bps, count, percent, price, score, usd, utcDate, utcTime, wholePercent, type Formatted } from "../lib/format.ts";
import { bandLines, GRADE_BADGE, GRADE_NAMES, GRADE_SUMMARY, GRADES, METRICS, type Grade, type MetricInfo, type MetricKey } from "../lib/grades.ts";
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
  const [range, setRange] = useRange();
  const history = useHistory(market.coin, range.value);
  return (
    <>
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <GradeBadge grade={g.grade} size="lg" note={g.notes[0]} />
          <div className="min-w-0">
            <h1 className="display text-4xl sm:text-5xl">
              {ticker}
              {market.dex && <span className="font-sans text-base tracking-normal text-muted-foreground"> on {market.dexName}</span>}
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

      {market.alerts.length > 0 && (
        <section aria-labelledby="alerts-title" className="space-y-4">
          <div>
            <h2 id="alerts-title" className="text-lg font-semibold">
              Alerts
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This market's latest alerts.{" "}
              <Link to="/alerts" className="link">
                All alerts
              </Link>
            </p>
          </div>
          <div className="rounded-lg border bg-card">
            {market.alerts.map((a) => (
              <AlertItem key={a.id} alert={a} showMarket={false} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="metrics-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="metrics-title" className="text-lg font-semibold">
              Graded metrics
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The grade uses the {market.windowMinutes} minutes to {utcTime(market.to)}. The charts show the last {range.span} in {range.step} steps: the shading is
              where each check usually sits (the middle 80% of steps), the dashed lines are grade limits.
              <HistoryNote history={history.data} />{" "}
              <Link to="/methodology" className="link">
                How the bands were set
              </Link>
            </p>
          </div>
          <RangeSwitch range={range} onChange={setRange} />
        </div>
        {history.error && !history.data && <HistoryError history={history} />}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((info) => (
            <li key={info.key}>
              <MetricCard info={info} value={info.format(m)} band={g.bands[info.key] ?? null} extra={metricExtra(info, market)}>
                <CheckHistory info={info} market={market} history={history} range={range} />
                {info.key === "liquidationMoveCost" && <CancelAdjusted metrics={m} />}
              </MetricCard>
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

      <Activity history={history} range={range} onRange={setRange} />

      <EmbedBadge coin={market.coin} />
    </>
  );
}

function metricExtra(info: MetricInfo, market: MarketDetail): string | null {
  const m = market.metrics;
  if (info.key === "liquidationMoveCost") return `Moves the price ${m.liquidationBandPct}%; ${market.maxLeverage}x positions liquidate at about ${+m.liquidationDistancePct.toFixed(2)}%.`;
  if (info.key === "peerGap") return m.peers.length ? `Compared with ${m.peers.join(", ")}.` : "No other deployer lists this asset.";
  return null;
}

function MetricCard({ info, value, band, extra, children }: { info: MetricInfo; value: Formatted; band: Grade | null; extra: string | null; children: ReactNode }) {
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
      {children}
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

interface Range {
  value: HistoryRange;
  label: string;
  span: string;
  step: string;
}

const RANGES: readonly Range[] = [
  { value: "24h", label: "24h", span: "24 hours", step: "5-minute" },
  { value: "7d", label: "7d", span: "7 days", step: "hourly" },
  { value: "30d", label: "30d", span: "30 days", step: "4-hour" },
];
const DEFAULT_RANGE = RANGES[1]!;

/** The range is kept in the URL (?range=24h), so a shared link opens on the same charts. */
function useRange(): [Range, (value: HistoryRange) => void] {
  const [params, setParams] = useSearchParams();
  const range = RANGES.find((r) => r.value === params.get("range")) ?? DEFAULT_RANGE;
  const set = (value: HistoryRange) => {
    const next = new URLSearchParams(params);
    if (value === DEFAULT_RANGE.value) next.delete("range");
    else next.set("range", value);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return [range, set];
}

interface HistoryState {
  data: MarketHistory | null;
  /** True while a newly chosen range loads, with the previous range still on screen. */
  switching: boolean;
  error: Error | null;
  retry: () => void;
}

function useHistory(coin: string, range: HistoryRange): HistoryState {
  const { data, loading, error, retry } = useApi<MarketHistory>(`/api/markets/${encodeURIComponent(coin)}/history?range=${range}`);
  const [previous, setPrevious] = useState<MarketHistory | null>(null);
  useEffect(() => {
    if (data) setPrevious(data);
  }, [data]);
  const held = loading && previous?.coin === coin ? previous : null;
  return { data: data ?? held, switching: !data && held !== null, error, retry };
}

function RangeSwitch({ range, onChange }: { range: Range; onChange: (value: HistoryRange) => void }) {
  return (
    <fieldset className="flex rounded-md border p-0.5">
      <legend className="sr-only">Chart range</legend>
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={r.value === range.value}
          onClick={() => onChange(r.value)}
          className="min-h-10 rounded-sm px-3.5 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
        >
          {r.label}
          <span className="sr-only"> ({r.span})</span>
        </button>
      ))}
    </fieldset>
  );
}

function HistoryNote({ history }: { history: MarketHistory | null }) {
  if (!history?.minuteBarsFrom) return null;
  return <> Before {utcDate(history.minuteBarsFrom)}, steps are built from 15-minute bars, so depth is averaged.</>;
}

function HistoryError({ history }: { history: HistoryState }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      Couldn't load the history: {history.error!.message}{" "}
      <button type="button" onClick={history.retry} className="link">
        Try again
      </button>
    </p>
  );
}

/** Each check's history series; big moves is charted from daily candles instead. */
const CHECK_SERIES: Record<Exclude<MetricKey, "bigMoves">, { key: SummarizedMetric; format: (v: number) => Formatted; now: (m: MarketDetail["metrics"]) => number | null }> = {
  depthToOi: { key: "depthToOi", format: percent, now: (m) => m.depthToOi },
  liquidationMoveCost: { key: "moveCostUsd", format: (v) => usd(v), now: (m) => m.liquidationMoveCostUsd },
  oracleGap: { key: "oracleGapBps", format: bps, now: (m) => m.oracleGapBps },
  peerGap: { key: "peerGapBps", format: bps, now: (m) => m.peerGapBps },
};

const shaded = (s: MetricSummary, scale = 1) => (s.p10 !== null && s.p90 !== null ? { lo: s.p10 * scale, hi: s.p90 * scale } : null);

function CheckHistory({ info, market, history, range }: { info: MetricInfo; market: MarketDetail; history: HistoryState; range: Range }) {
  const h = history.data;
  if (!h) return history.error ? null : <Skeleton className="h-36" />;
  const busy = history.switching ? "opacity-50" : "";

  if (info.key === "bigMoves") {
    const big = h.dailyMoves.filter((d) => d.movePct > 50).length;
    return (
      <div aria-busy={history.switching} className={`space-y-1.5 transition-opacity motion-reduce:transition-none ${busy}`}>
        <LineChart
          bare
          dates
          title="Largest move from each day's open"
          summary={`${big} of the last ${h.dailyMoves.length} finished days moved more than 50% from the open.`}
          times={h.dailyMoves.map((d) => d.day)}
          series={[{ label: "Move", values: h.dailyMoves.map((d) => d.movePct / 100), color: "var(--primary)" }]}
          format={percent}
          refs={[{ value: 0.5, label: "50%" }]}
          empty="Not enough finished days yet."
          height={88}
        />
        <p className="text-xs text-muted-foreground">The last 30 finished days, whatever the range.</p>
      </div>
    );
  }

  // The card already says no other deployer lists the asset.
  if (info.key === "peerGap" && h.peers.length === 0) return null;
  const { key, format, now } = CHECK_SERIES[info.key];
  const usual = h.summary[key];
  const current = now(market.metrics);
  const position = current === null || usual.p10 === null || usual.p90 === null ? "" : current < usual.p10 ? " Lower than usual now." : current > usual.p90 ? " Higher than usual now." : "";
  const latest = usual.latest === null ? "no data yet" : format(usual.latest).ariaLabel;
  const adjusted = info.key === "liquidationMoveCost" && h.points.some((p) => p.adjustedMoveCostUsd !== null) ? h.points.map((p) => p.adjustedMoveCostUsd) : null;
  return (
    <div aria-busy={history.switching} className={`space-y-1.5 transition-opacity motion-reduce:transition-none ${busy}`}>
      <LineChart
        bare
        title={`Last ${range.span}`}
        summary={`${info.name} over the last ${range.span}, ${range.step} steps: latest ${latest}${usual.p10 !== null && usual.p90 !== null ? `, usually ${format(usual.p10).ariaLabel} to ${format(usual.p90).ariaLabel}` : ""}.`}
        times={h.points.map((p) => p.t)}
        series={[
          { label: adjusted ? "Raw" : info.name, values: h.points.map((p) => p[key]), color: "var(--primary)" },
          ...(adjusted ? [{ label: "Cancel-adjusted", values: adjusted, color: "var(--muted-foreground)", dashed: true }] : []),
        ]}
        format={format}
        refs={bandLines(info.key)}
        band={shaded(usual)}
        height={88}
      />
      {usual.p10 !== null && usual.p90 !== null && (
        <p className="text-xs text-muted-foreground">
          Usually <Num value={format(usual.p10)} /> to <Num value={format(usual.p90)} />.{position}
        </p>
      )}
    </div>
  );
}

/** Experimental and not graded: the cost if large walls are pulled as often as they have been. */
function CancelAdjusted({ metrics: m }: { metrics: MarketDetail["metrics"] }) {
  if (m.liquidationMoveCostUsd === null) return null;
  const { adjustedMoveCostUsd: adjusted, pullRate: rate } = m;
  let text: ReactNode;
  if (adjusted !== null && rate) {
    text = (
      <>
        Large walls here were pulled before the price reached them <Num value={wholePercent(rate.rate)} /> of the time by USD (
        <Num value={count(rate.walls, ["wall", "walls"])} /> in 14 days), so wall depth counts at <Num value={wholePercent(1 - rate.rate)} />.
      </>
    );
  } else if (adjusted !== null) text = "No large walls stood within the band, so cancels don't change it.";
  else if (!rate) text = "Large walls stood within the band, but too few have ended here to measure how often they're pulled.";
  else text = "Wall depth isn't recorded for this window yet.";
  return (
    <div className="rounded-md bg-muted px-3 py-2 text-xs">
      <p className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          Cancel-adjusted <span className="font-normal text-muted-foreground">· experimental</span>
        </span>
        <Num value={usd(adjusted)} className="text-sm font-semibold" />
      </p>
      <p className="mt-1 text-muted-foreground">
        {text} Not graded.{" "}
        <Link to="/methodology#cancel-adjusted-cost-experimental" className="link">
          How it's worked out
        </Link>
      </p>
    </div>
  );
}

/** Funding is stored as the hourly rate; charts show it per year. */
const HOURS_PER_YEAR = 24 * 365;

function Activity({ history, range, onRange }: { history: HistoryState; range: Range; onRange: (value: HistoryRange) => void }) {
  const h = history.data;
  const times = h?.points.map((p) => p.t) ?? [];
  const series = (key: "oiUsd" | "depth2Usd" | "spreadBps" | "funding", scale = 1) => h?.points.map((p) => (p[key] === null ? null : p[key]! * scale)) ?? [];
  const latest = (s: MetricSummary | undefined, format: (v: number) => Formatted, scale = 1) => (s?.latest == null ? "unknown" : format(s.latest * scale).ariaLabel);
  const lastMark = h?.points.findLast((p) => p.markPx !== null)?.markPx ?? null;

  return (
    <section aria-labelledby="activity-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="activity-title" className="text-lg font-semibold">
            Price and activity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The last {range.span} in {range.step} steps. Shading is the usual range.
            <HistoryNote history={h} />
          </p>
        </div>
        <RangeSwitch range={range} onChange={onRange} />
      </div>
      {!h ? (
        history.error ? (
          <HistoryError history={history} />
        ) : (
          <Loading label="Loading the history">
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64 lg:col-span-2" />
              <Skeleton className="h-52" />
              <Skeleton className="h-52" />
            </div>
          </Loading>
        )
      ) : (
        <div aria-busy={history.switching} className={`grid gap-4 transition-opacity motion-reduce:transition-none lg:grid-cols-2 ${history.switching ? "opacity-50" : ""}`}>
          <div className="lg:col-span-2">
            <LineChart
              title="Mark and oracle price"
              summary={`The latest mark price is ${lastMark === null ? "unknown" : price(lastMark).ariaLabel}.`}
              times={times}
              series={[
                { label: "Mark", values: h.points.map((p) => p.markPx), color: "var(--primary)" },
                { label: "Oracle", values: h.points.map((p) => p.oraclePx), color: "var(--muted-foreground)", dashed: true },
              ]}
              format={(v) => price(v)}
              height={180}
            />
          </div>
          <LineChart
            title="Open interest"
            summary={`Open interest is now ${latest(h.summary.oiUsd, usd)}.`}
            times={times}
            series={[{ label: "Open interest", values: series("oiUsd"), color: "var(--primary)" }]}
            format={(v) => usd(v)}
            band={shaded(h.summary.oiUsd)}
          />
          <LineChart
            title="Depth within ±2%, both sides"
            summary={`Depth within 2% is now ${latest(h.summary.depth2Usd, usd)}.`}
            times={times}
            series={[{ label: "Depth", values: series("depth2Usd"), color: "var(--primary)" }]}
            format={(v) => usd(v)}
            band={shaded(h.summary.depth2Usd)}
          />
          <LineChart
            title="Impact spread"
            summary={`The impact spread is now ${latest(h.summary.spreadBps, bps)}.`}
            times={times}
            series={[{ label: "Spread", values: series("spreadBps"), color: "var(--primary)" }]}
            format={bps}
            band={shaded(h.summary.spreadBps)}
          />
          <LineChart
            title="Funding, per year"
            summary={`Funding is now ${latest(h.summary.funding, percent, HOURS_PER_YEAR)} a year.`}
            times={times}
            series={[{ label: "Funding", values: series("funding", HOURS_PER_YEAR), color: "var(--primary)" }]}
            format={percent}
            band={shaded(h.summary.funding, HOURS_PER_YEAR)}
          />
        </div>
      )}
    </section>
  );
}
