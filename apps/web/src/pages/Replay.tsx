import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { LineChart } from "../components/LineChart.tsx";
import { ErrorState, Loading, Skeleton } from "../components/States.tsx";
import { useApi, type ReplayAlert, type ReplayResult } from "../lib/api.ts";
import { KIND_LABELS, SEVERITY_BADGE, SEVERITY_LABELS } from "../lib/alerts.ts";
import { minutesSpan, price, usd, utcTime } from "../lib/format.ts";
import { NotFound } from "./NotFound.tsx";

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

/** "2 h 8 min before the crash", "at the crash", "6 min after". */
function relative(t: number, crashAt: number): string {
  const m = Math.round((t - crashAt) / 60_000);
  if (m === 0) return "at the crash";
  return m < 0 ? `${minutesSpan(-m)} before` : `${minutesSpan(m)} after`;
}

interface Moment {
  t: number;
  label: string;
  title: string;
  detail: string;
  alert?: ReplayAlert;
}

function momentsOf(r: ReplayResult): Moment[] {
  const out: Moment[] = r.alerts.map((a) => ({ t: a.startedAt, label: KIND_LABELS[a.kind], title: a.first.title, detail: a.first.detail, alert: a }));
  out.push({
    t: r.crashAt,
    label: "Crash",
    title: `The steepest one-minute fall began: ${r.crashMovePct}%`,
    detail: `HLP lost about ${usd(r.lossUsd).display}, as reported.`,
  });
  for (const l of [...r.liquidations].sort((a, b) => b.usd - a.usd).slice(0, 2)) {
    if (l.usd < 1_000_000) continue;
    out.push({
      t: l.t,
      label: "Liquidations",
      title: `${usd(l.usd).display} of positions liquidated in one minute`,
      detail: l.backstopUsd > 0 ? `${usd(l.backstopUsd).display} of it was taken over by the liquidator vault (HLP).` : "All of it was sold into the book.",
    });
  }
  for (const w of r.pulledWalls) {
    const times = w.typicalUsd ? `, ${(w.peakUsd / w.typicalUsd).toFixed(0)}× the market's usual large order` : "";
    out.push({
      t: w.at,
      label: "Pulled wall",
      title: `A ${usd(w.peakUsd).display} ${w.side} at ${price(w.px).display} was pulled`,
      detail: `It stood ${Math.round((w.at - w.firstSeen) / 1000)} s${times}. Alerts need 5× and two thirds of the side, so this one stayed below the threshold.`,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function Replay() {
  const id = useParams().id ?? "";
  const { data, error, loading, retry } = useApi<ReplayResult>(`/replays/${encodeURIComponent(id)}.json`);
  useEffect(() => {
    document.title = `${data ? data.name : "Replay"} · Telltale`;
  }, [data]);
  if (error && "status" in error && error.status === 404) return <NotFound title="There's no replay with that name." />;

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/replays" className="link-muted">
              Replays
            </Link>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="font-mono text-foreground">
              {data?.name ?? id}
            </span>
          </li>
        </ol>
      </nav>
      {loading && (
        <Loading label="Loading the replay">
          <div className="space-y-6">
            <Skeleton className="h-24 max-w-3xl" />
            <Skeleton className="h-64" />
          </div>
        </Loading>
      )}
      {!data && error && <ErrorState title="Couldn't load the replay." message={error.message} onRetry={retry} />}
      {data && <ReplayBody r={data} />}
    </div>
  );
}

function ReplayBody({ r }: { r: ReplayResult }) {
  const times = r.minutes.map((m) => m.t);
  const markers = [
    ...r.alerts.filter((a) => a.severity !== "info").map((a) => ({ t: a.startedAt, label: hhmm(a.startedAt), tone: "alert" as const })),
    { t: r.crashAt, label: "crash", tone: "event" as const },
  ];
  const liquidated = new Map(r.liquidations.map((l) => [l.t, l.usd]));
  const moments = momentsOf(r);

  return (
    <>
      <header className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          <span className="font-mono">{r.name}</span>, {r.date}
        </h1>
        <p className="text-base leading-7 text-muted-foreground text-pretty">{r.summary}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {r.sources.map((s) => (
            <a key={s.url} href={s.url} rel="noreferrer" className="link inline-flex items-center gap-1">
              {s.label}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ))}
        </p>
      </header>

      <section aria-labelledby="result-title" className="max-w-3xl rounded-lg border bg-card p-5">
        <h2 id="result-title" className="sr-only">
          Result
        </h2>
        {r.firstWarning && r.leadMinutes !== null ? (
          <>
            <p className="text-sm text-muted-foreground">Telltale's first warning came</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{minutesSpan(r.leadMinutes)} before the crash</p>
            <p className="mt-3 text-sm text-pretty">
              At {utcTime(r.firstWarning.startedAt)}: {r.firstWarning.first.title}. {r.firstWarning.first.detail} The steepest fall began at{" "}
              {utcTime(r.crashAt)}.
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold tracking-tight">No warning before the crash</p>
            <p className="mt-3 text-sm text-pretty">None of the alerts reached warning level before the steepest fall began at {utcTime(r.crashAt)}.</p>
          </>
        )}
      </section>

      <section aria-labelledby="charts-title" className="space-y-4">
        <h2 id="charts-title" className="text-lg font-semibold">
          The day, minute by minute
        </h2>
        <div className="grid gap-4">
          <LineChart
            title="Mark and oracle price"
            summary={`The mark price peaked at ${price(Math.max(...r.minutes.map((m) => m.mark))).ariaLabel} before the crash.`}
            times={times}
            series={[
              { label: "Mark", values: r.minutes.map((m) => m.mark), color: "var(--primary)" },
              { label: "Oracle", values: r.minutes.map((m) => m.oracle), color: "var(--muted-foreground)", dashed: true },
            ]}
            format={(v) => price(v)}
            markers={markers}
            height={200}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <LineChart
              title="Open interest"
              summary={`Open interest peaked at ${usd(Math.max(...r.minutes.map((m) => m.oiUsd))).ariaLabel}.`}
              times={times}
              series={[{ label: "Open interest", values: r.minutes.map((m) => m.oiUsd), color: "var(--primary)" }]}
              format={(v) => usd(v)}
              markers={markers}
            />
            <LineChart
              title="Liquidations per minute"
              summary={`${usd(r.liquidations.reduce((s, l) => s + l.usd, 0)).ariaLabel} was liquidated in the window.`}
              times={times}
              series={[{ label: "Liquidated", values: times.map((t) => liquidated.get(t) ?? 0), color: "var(--destructive)" }]}
              format={(v) => usd(v)}
              markers={markers}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Times are UTC. Teal lines mark warnings; the red line marks the crash.</p>
      </section>

      <section aria-labelledby="timeline-title" className="max-w-3xl space-y-4">
        <h2 id="timeline-title" className="text-lg font-semibold">
          Timeline
        </h2>
        <ol className="rounded-lg border bg-card">
          {moments.map((m) => (
            <li key={`${m.label}-${m.t}`} className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:gap-4">
              <div className="shrink-0 sm:w-40">
                <p className="font-mono text-sm tabular-nums">{hhmm(m.t)} UTC</p>
                <p className="text-xs text-muted-foreground">{relative(m.t, r.crashAt)}</p>
              </div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {m.alert && (
                    <span className={`rounded-sm border px-1.5 py-0.5 font-medium ${SEVERITY_BADGE[m.alert.severity]}`}>{SEVERITY_LABELS[m.alert.severity]}</span>
                  )}
                  {m.label}
                </p>
                <p className="mt-0.5 text-sm font-medium">{m.title}</p>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">{m.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="depth-title" className="max-w-3xl space-y-4">
        <div>
          <h2 id="depth-title" className="text-lg font-semibold">
            How much the archive's thin books matter
          </h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            The open-interest surge alert also needs a thin book. The archive shows only the 20 best price levels, so the real book was deeper. Here
            is when the alert would first have fired if the book had held more than the archive shows.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Book depth
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  First surge alert
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Before the crash
                </th>
              </tr>
            </thead>
            <tbody>
              {r.depthSensitivity.map((d) => (
                <tr key={d.multiple} className="border-b last:border-b-0">
                  <td className="px-4 py-2">{d.multiple === 1 ? "As archived" : `${d.multiple}× the archive`}</td>
                  <td className="px-4 py-2 font-mono tabular-nums">{d.firstAt === null ? "--" : `${hhmm(d.firstAt)} UTC`}</td>
                  <td className="px-4 py-2 tabular-nums">{d.leadMinutes === null ? "no warning" : minutesSpan(d.leadMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="limits-title" className="max-w-3xl space-y-3">
        <h2 id="limits-title" className="text-lg font-semibold">
          What this replay can't see
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {r.limits.map((l) => (
            <li key={l} className="text-pretty">
              {l}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="repro-title" className="max-w-3xl space-y-3">
        <h2 id="repro-title" className="text-lg font-semibold">
          Run it yourself
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          The data comes from Hyperliquid's public archive and Hydromancer's Reservoir archive, both on AWS S3 (the downloader pays a few cents of
          transfer). The replay runs the same detector code as the live site.
        </p>
        <pre className="overflow-x-auto rounded-md border bg-muted px-4 py-3 font-mono text-sm">pnpm replay {r.id}</pre>
      </section>
    </>
  );
}
