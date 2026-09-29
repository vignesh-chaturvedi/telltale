import { Info } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { GradeBadge } from "../components/GradeBadge.tsx";
import { GradeBar } from "../components/GradeBar.tsx";
import { MarketTable } from "../components/MarketTable.tsx";
import { Num } from "../components/Num.tsx";
import { EmptyState, ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { useApi, type DexDetail } from "../lib/api.ts";
import { count, score, usd } from "../lib/format.ts";
import { GRADE_NAMES, GRADES } from "../lib/grades.ts";
import { NotFound } from "./NotFound.tsx";

export function Dex() {
  const slug = useParams().slug ?? "";
  const { data, error, loading, retry } = useApi<DexDetail>(`/api/dexes/${encodeURIComponent(slug)}`);
  const name = data?.dex.fullName ?? slug;
  useEffect(() => {
    document.title = `${name} · Telltale`;
  }, [name]);

  if (error && "status" in error && error.status === 404) return <NotFound title={`No DEX named ${slug}.`} />;
  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="link-muted">
              Markets
            </Link>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-foreground">
              {name}
            </span>
          </li>
        </ol>
      </nav>

      {loading && (
        <Loading label="Loading the DEX">
          <div className="space-y-6">
            <Skeleton className="h-14 w-72" />
            <Skeleton className="h-96" />
          </div>
        </Loading>
      )}
      {!data && error && <ErrorState title={`Couldn't load ${slug}.`} message={error.message} onRetry={retry} />}
      {data && <DexBody detail={data} />}
    </div>
  );
}

function DexBody({ detail }: { detail: DexDetail }) {
  const { dex, markets } = detail;
  return (
    <>
      <header className="flex flex-wrap items-center gap-4">
        <GradeBadge grade={dex.grade} size="lg" note={dex.reasons[0]} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{dex.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{dex.dex || "core"}</span>
            {dex.dex ? " · a HIP-3 DEX whose deployer runs the oracle" : " · Hyperliquid's own markets, with validator-run oracles"}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat term="Grade" value={dex.grade ? `${dex.grade} · ${GRADE_NAMES[dex.grade]}` : "Not graded"} />
        <Stat term="Score" value={<Num value={score(dex.score)} />} />
        <Stat term="Open interest" value={<Num value={usd(dex.oiUsd)} />} />
        <Stat
          term="Markets graded"
          value={
            <>
              <Num value={count(dex.graded)} /> <span className="text-muted-foreground">of</span> <Num value={count(dex.markets)} />
            </>
          }
        />
      </dl>

      {(dex.reasons.length > 0 || dex.notes.length > 0) && (
        <ul className="max-w-3xl space-y-2 text-sm">
          {dex.reasons.map((r) => (
            <li key={r} className="rounded-lg border bg-card p-3">
              {r}
            </li>
          ))}
          {dex.notes.map((n) => (
            <li key={n} className="flex gap-2 px-1 text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {n}
            </li>
          ))}
        </ul>
      )}

      {markets.length > 0 && (
        <section aria-labelledby="dist-title" className="space-y-3">
          <h2 id="dist-title" className="text-lg font-semibold">
            Markets by grade
          </h2>
          <GradeBar counts={dex.counts} className="h-3" />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {GRADES.map((g) => (
              <span key={g}>
                <span className="font-mono font-semibold text-foreground">{g}</span> <Num value={count(dex.counts[g])} />
              </span>
            ))}
          </p>
        </section>
      )}

      <section aria-labelledby="dex-markets-title" className="space-y-4">
        <h2 id="dex-markets-title" className="text-lg font-semibold">
          Markets
        </h2>
        {markets.length === 0 ? (
          <div className="rounded-lg border bg-card">
            <EmptyState title="This DEX has no live markets.">
              <p>It's deployed on Hyperliquid, but every market is delisted or not yet listed.</p>
            </EmptyState>
          </div>
        ) : (
          <MarketTable markets={markets} caption={`Markets on ${dex.fullName}`} showDex={false} />
        )}
      </section>
    </>
  );
}

function Stat({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}
