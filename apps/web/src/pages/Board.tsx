import { Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertItem } from "../components/AlertItem.tsx";
import { Freshness } from "../components/Freshness.tsx";
import { GradeBadge } from "../components/GradeBadge.tsx";
import { GradeBar } from "../components/GradeBar.tsx";
import { MarketTable } from "../components/MarketTable.tsx";
import { Num } from "../components/Num.tsx";
import { EmptyState, ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { dexPath, useApi, type AlertList, type Board as BoardData, type BoardDex, type BoardMarket } from "../lib/api.ts";
import { count, usd } from "../lib/format.ts";
import { GRADE_BADGE, GRADE_NAMES, GRADES, type Grade } from "../lib/grades.ts";

export function Board() {
  const { data, error, loading, receivedAt, retry } = useApi<BoardData>("/api/board");
  useEffect(() => {
    document.title = "Telltale · Live safety ratings for Hyperliquid markets";
  }, []);

  return (
    <div className="space-y-12">
      <section aria-labelledby="board-title" className="max-w-3xl space-y-4">
        <h1 id="board-title" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Every market on Hyperliquid, graded.
        </h1>
        <p className="text-base leading-7 text-muted-foreground text-pretty">
          Live A–E safety ratings for every perpetual market, core and HIP-3, with the numbers behind each grade: depth against open interest, the
          cost to move the price to liquidation levels, and how closely the market tracks its oracle.{" "}
          <Link to="/methodology" className="link">
            How grades work
          </Link>
        </p>
        {data && <Freshness dataAgeSeconds={data.dataAgeSeconds} receivedAt={receivedAt} windowMinutes={data.windowMinutes} />}
      </section>

      {loading && <BoardSkeleton />}
      {!data && error && <ErrorState title="Couldn't load the ratings." message={error.message} onRetry={retry} />}
      {data && (
        <>
          <Summary board={data} />
          <LatestAlerts />
          <Dexes dexes={data.dexes} />
          <Markets board={data} />
        </>
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <Loading label="Loading the ratings">
      <div className="space-y-12">
        <div className="space-y-4">
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {GRADES.map((g) => (
              <Skeleton key={g} className="h-16" />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    </Loading>
  );
}

function Summary({ board }: { board: BoardData }) {
  const graded = GRADES.reduce((s, g) => s + board.counts[g], 0);
  const active = board.dexes.filter((d) => d.status === "active");
  const oi = active.reduce((s, d) => s + d.oiUsd, 0);
  return (
    <section aria-labelledby="summary-title" className="space-y-4">
      <h2 id="summary-title" className="sr-only">
        Summary
      </h2>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Markets graded</dt>
          <dd>
            <Num value={count(graded)} /> <span className="text-muted-foreground">of</span> <Num value={count(board.markets.length)} />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">DEXes with live markets</dt>
          <dd>
            <Num value={count(active.length)} />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Open interest</dt>
          <dd>
            <Num value={usd(oi)} />
          </dd>
        </div>
      </dl>
      <GradeBar counts={board.counts} className="h-3" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {GRADES.map((g) => (
          <li key={g} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
            <GradeBadge grade={g} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{GRADE_NAMES[g]}</p>
              <p className="text-xs text-muted-foreground">
                <Num value={count(board.counts[g])} />
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The latest warnings, once alerts are public; nothing at all before then. */
function LatestAlerts() {
  const { data } = useApi<AlertList>("/api/alerts?severity=warning&limit=3");
  if (!data?.public || data.alerts.length === 0) return null;
  return (
    <section aria-labelledby="latest-alerts-title" className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="latest-alerts-title" className="text-lg font-semibold">
          Latest alerts
        </h2>
        <Link to="/alerts" className="link text-sm">
          All alerts
        </Link>
      </div>
      <div className="rounded-lg border bg-card">
        {data.alerts.map((a) => (
          <AlertItem key={a.id} alert={a} />
        ))}
      </div>
    </section>
  );
}

function Dexes({ dexes }: { dexes: readonly BoardDex[] }) {
  const active = dexes.filter((d) => d.status === "active").sort((a, b) => b.oiUsd - a.oiUsd);
  const dormant = dexes.filter((d) => d.status !== "active");
  return (
    <section aria-labelledby="dexes-title" className="space-y-4">
      <div>
        <h2 id="dexes-title" className="text-lg font-semibold">
          DEXes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Each DEX is graded by its markets, weighted by open interest.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((d) => (
          <li key={d.slug}>
            <DexCard dex={d} />
          </li>
        ))}
      </ul>
      {dormant.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Deployed with no live markets:{" "}
          {dormant.map((d, i) => (
            <span key={d.slug}>
              {i > 0 && ", "}
              <Link to={dexPath(d.slug)} className="link-muted">
                {d.fullName}
              </Link>{" "}
              <span className="font-mono text-xs">({d.dex})</span>
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}

function DexCard({ dex }: { dex: BoardDex }) {
  return (
    <Link
      to={dexPath(dex.slug)}
      className="flex h-full flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{dex.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{dex.dex || "core"}</p>
        </div>
        <GradeBadge grade={dex.grade} size="md" />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Open interest</dt>
          <dd>
            <Num value={usd(dex.oiUsd)} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Markets</dt>
          <dd>
            <Num value={count(dex.markets)} />
          </dd>
        </div>
      </dl>
      <GradeBar counts={dex.counts} />
      {dex.reasons[0] && <p className="text-xs text-muted-foreground">{dex.reasons[0]}</p>}
    </Link>
  );
}

function Markets({ board }: { board: BoardData }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = useDeferredValue(q.trim().toLowerCase());
  const dex = params.get("dex") ?? "";
  const grades = new Set((params.get("grade") ?? "").split("").filter((g): g is Grade => (GRADES as readonly string[]).includes(g)));
  const gradeKey = [...grades].sort().join("");

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const toggleGrade = (g: Grade) => {
    const next = new Set(grades);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    update("grade", GRADES.filter((x) => next.has(x)).join(""));
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    for (const key of ["q", "dex", "grade"]) next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const dexOptions = board.dexes.filter((d) => d.markets > 0).sort((a, b) => b.oiUsd - a.oiUsd);
  const filtered = useMemo<BoardMarket[]>(() => {
    const wanted = new Set(gradeKey.split("").filter(Boolean));
    const dexName = dex === "core" ? "" : dex;
    return board.markets.filter(
      (m) => (!query || m.coin.toLowerCase().includes(query)) && (!dex || m.dex === dexName) && (wanted.size === 0 || (m.grade !== null && wanted.has(m.grade))),
    );
  }, [board.markets, query, dex, gradeKey]);
  const filtering = Boolean(q || dex || grades.size);

  return (
    <section aria-labelledby="markets-title" className="space-y-4">
      <div>
        <h2 id="markets-title" className="text-lg font-semibold">
          Markets
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a market for its grade breakdown and last 24 hours.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative sm:w-64">
          <label htmlFor="market-search" className="sr-only">
            Search markets
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="market-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search markets"
            value={q}
            onChange={(e) => update("q", e.target.value)}
            className="input w-full pl-9"
          />
        </div>
        <div>
          <label htmlFor="dex-filter" className="sr-only">
            DEX
          </label>
          <select id="dex-filter" value={dex} onChange={(e) => update("dex", e.target.value)} className="input w-full sm:w-auto">
            <option value="">All DEXes</option>
            {dexOptions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.fullName} ({d.markets})
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Grades</legend>
          {GRADES.map((g) => {
            const on = grades.has(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => toggleGrade(g)}
                title={`Show ${GRADE_NAMES[g]} markets`}
                className={`inline-flex size-10 items-center justify-center rounded-md border font-mono text-sm font-semibold transition-colors ${
                  on ? GRADE_BADGE[g] : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {g}
                <span className="sr-only"> ({GRADE_NAMES[g]})</span>
              </button>
            );
          })}
        </fieldset>
        {filtering && (
          <button type="button" onClick={clear} className="btn-ghost">
            <X aria-hidden="true" className="size-4" />
            Clear filters
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtering ? `${filtered.length} of ${board.markets.length} markets` : `${board.markets.length} markets`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState title="No markets match these filters.">
            <button type="button" onClick={clear} className="btn-secondary">
              Clear filters
            </button>
          </EmptyState>
        </div>
      ) : (
        <MarketTable markets={filtered} caption="Markets with their grade and key numbers" />
      )}
    </section>
  );
}
