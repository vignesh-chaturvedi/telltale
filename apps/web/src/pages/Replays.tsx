import { useEffect } from "react";
import { Link } from "react-router";
import { ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { useApi, type ReplaySummary } from "../lib/api.ts";
import { minutesSpan, usd, utcTime } from "../lib/format.ts";

/** One card per replayed incident: what was lost and how early the first warning came. */
export function ReplayCards({ replays }: { replays: readonly ReplaySummary[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {replays.map((r) => (
        <li key={r.id}>
          <Link to={`/replays/${r.id}`} className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/60">
            <div>
              <p className="font-mono font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                {r.date} · HLP lost about {usd(r.lossUsd).display}
              </p>
            </div>
            {r.leadMinutes !== null ? (
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{minutesSpan(r.leadMinutes)}</span>
                <span className="text-muted-foreground"> of warning before the crash</span>
              </p>
            ) : (
              <p className="text-sm font-medium">No warning before the crash</p>
            )}
            <p className="text-xs text-muted-foreground">
              {r.firstWarning ? `First warning: ${r.firstWarning}.` : "The detectors stayed quiet."} Crash at {utcTime(r.crashAt)}.
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Replays() {
  const { data, error, loading, retry } = useApi<ReplaySummary[]>("/replays/index.json");
  useEffect(() => {
    document.title = "Replays · Telltale";
  }, []);
  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Replays</h1>
        <p className="text-base leading-7 text-muted-foreground text-pretty">
          Telltale's live detectors, run minute by minute over the archived data from past losses on Hyperliquid, to see whether they would
          have warned in time. Misses are shown as plainly as hits, and each page lists what the archives can't show.
        </p>
      </header>
      {loading && (
        <Loading label="Loading the replays">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </Loading>
      )}
      {!data && error && <ErrorState title="Couldn't load the replays." message={error.message} onRetry={retry} />}
      {data && <ReplayCards replays={data} />}
    </div>
  );
}
