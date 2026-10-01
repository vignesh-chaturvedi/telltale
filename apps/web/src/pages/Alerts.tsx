import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertItem } from "../components/AlertItem.tsx";
import { EmptyState, ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { useApi, type AlertList } from "../lib/api.ts";
import { KIND_LABELS } from "../lib/alerts.ts";

const KINDS = Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[];

export function Alerts() {
  const [params, setParams] = useSearchParams();
  const everything = params.get("all") === "1";
  const kind = params.get("kind") ?? "";
  const query = new URLSearchParams({ limit: "200" });
  if (!everything) query.set("severity", "warning");
  if (kind) query.set("kind", kind);
  const { data, error, loading, retry } = useApi<AlertList>(`/api/alerts?${query}`);
  useEffect(() => {
    document.title = "Alerts · Telltale";
  }, []);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-base leading-7 text-muted-foreground text-pretty">
          Conditions behind past losses on Hyperliquid, as they happen: the mark price pulling away from the oracle, an oracle that stops
          updating while the market moves, order books thinning out, walls that are pulled before the price reaches them, and deployer changes.
          Alerts describe what the data shows, not anyone's intent.{" "}
          <Link to="/methodology#alerts" className="link">
            How alerts work
          </Link>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex rounded-md border p-0.5">
          <legend className="sr-only">Severity</legend>
          {[
            { label: "Warnings", value: "" },
            { label: "Everything", value: "1" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={(params.get("all") ?? "") === o.value}
              onClick={() => update("all", o.value)}
              className="min-h-9 rounded-sm px-3 text-sm text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground"
            >
              {o.label}
            </button>
          ))}
        </fieldset>
        <div>
          <label htmlFor="kind-filter" className="sr-only">
            Kind of alert
          </label>
          <select id="kind-filter" value={kind} onChange={(e) => update("kind", e.target.value)} className="input">
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <Loading label="Loading alerts">
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </Loading>
      )}
      {!data && error && <ErrorState title="Couldn't load the alerts." message={error.message} onRetry={retry} />}
      {data && !data.public && (
        <div className="rounded-lg border bg-card">
          <EmptyState title="Alerts aren't public yet.">
            <p>They're being checked against live data before they go out.</p>
          </EmptyState>
        </div>
      )}
      {data?.public && data.alerts.length === 0 && (
        <div className="rounded-lg border bg-card">
          <EmptyState title={everything ? "No alerts yet." : "No warnings yet."}>
            {!everything && (
              <button type="button" onClick={() => update("all", "1")} className="btn-secondary">
                Show information alerts too
              </button>
            )}
          </EmptyState>
        </div>
      )}
      {data?.public && data.alerts.length > 0 && (
        <section aria-label="Alert log" className="rounded-lg border bg-card">
          {data.alerts.map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </section>
      )}
    </div>
  );
}
