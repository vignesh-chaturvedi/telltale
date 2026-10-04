import { useEffect } from "react";
import { Link } from "react-router";
import { ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { useApi, type ReplaySummary } from "../lib/api.ts";
import { RollingNumber } from "../components/RollingNumber.tsx";
import { LongArrow, Reveal } from "../components/ui.tsx";
import { minutesSpan, usd, utcTime } from "../lib/format.ts";
import { REVEAL } from "../lib/motion.ts";

/** One numbered card per replayed incident: what was lost and how early the first warning came. */
export function ReplayCards({ replays }: { replays: readonly ReplaySummary[] }) {
  return (
    <ul className="grid border-t border-l sm:grid-cols-2">
      {replays.map((r, i) => (
        <Reveal as="li" key={r.id} delay={i * REVEAL.stagger} className="border-r border-b">
          <Link to={`/replays/${r.id}`} viewTransition className="group flex h-full flex-col gap-8 bg-card p-6 transition-colors hover:bg-accent sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</p>
                <p className="display mt-3 text-3xl">{r.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {r.date} · HLP lost about {usd(r.lossUsd).display}
                </p>
              </div>
            </div>
            <div className="mt-auto space-y-3">
              {r.leadMinutes !== null ? (
                <p>
                  <span className="display block text-5xl text-primary tabular-nums sm:text-6xl">
                    <RollingNumber value={minutesSpan(r.leadMinutes)} delay={0.1 + i * 0.12} />
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">of warning before the crash</span>
                </p>
              ) : (
                <p className="display text-3xl">No warning before the crash</p>
              )}
              <p className="text-xs text-muted-foreground">
                {r.firstWarning ? `First warning: ${r.firstWarning}.` : "The detectors stayed quiet."} Crash at {utcTime(r.crashAt)}.
              </p>
              <span className="inline-flex min-h-10 items-center gap-3 text-sm font-medium">
                Read the replay
                <LongArrow />
              </span>
            </div>
          </Link>
        </Reveal>
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
        <h1 className="display text-4xl sm:text-5xl">
          Would Telltale <span className="text-primary">have warned?</span>
        </h1>
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
