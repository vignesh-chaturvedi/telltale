import * as m from "motion/react-m";
import { Link } from "react-router";
import { KIND_LABELS } from "../lib/alerts.ts";
import { ApiError, marketPath, useApi, type TrackAlert, type TrackKind, type TrackRecord, type TrackRecordResponse } from "../lib/api.ts";
import { count, multiple, percent, utcTime, wholePercent } from "../lib/format.ts";
import { REVEAL } from "../lib/motion.ts";
import { Num } from "./Num.tsx";
import { RollingNumber } from "./RollingNumber.tsx";
import { ErrorState, Loading } from "./States.tsx";
import { ButtonLink, Container, Eyebrow, Headline, Reveal } from "./ui.tsx";

/** Below this many measured warnings the comparison stays hidden: a share of a handful says little. */
const MIN_SAMPLE = 20;
const DAY_MS = 24 * 60 * 60_000;

const dateOf = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const share = (part: number, whole: number) => (whole ? part / whole : null);

/**
 * The live track record (band): every public warning, and whether the hour after it was one of the
 * market's most volatile, next to the same hour on the days before. Hits and misses both show.
 */
export function TrackRecordSection() {
  const track = useApi<TrackRecordResponse>("/api/track-record");
  const data = track.data;
  if (data && !data.public) return null;
  // A server from before the track record answers 404: leave the section out rather than show an error.
  if (!data && track.error instanceof ApiError && track.error.status === 404) return null;
  return (
    <section aria-labelledby="track-title" className="band py-20 sm:py-28">
      <Container className="space-y-14">
        <Reveal className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-4">
            <Eyebrow className="text-band-muted before:bg-band-accent">Track record</Eyebrow>
            <Headline id="track-title" className="text-4xl sm:text-5xl" accent="what happened next." onBand>
              Every warning, checked against
            </Headline>
            <p className="max-w-xl leading-7 text-band-muted text-pretty">
              An hour after each warning, Telltale measures how far the price moved and ranks that hour against the market's own hours over the
              week before. Every warning counts, hits and misses alike.
            </p>
          </div>
          <ButtonLink to="/methodology#track-record" tone="arrow" className="text-band-foreground">
            How it's measured
          </ButtonLink>
        </Reveal>
        {track.loading && <TrackSkeleton />}
        {!data && track.error && <ErrorState title="Couldn't load the track record." message={track.error.message} onRetry={track.retry} />}
        {data?.public && <Record record={data} />}
      </Container>
    </section>
  );
}

function TrackSkeleton() {
  return (
    <Loading label="Loading the track record">
      <div aria-hidden="true" className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
        <div className="h-56 bg-band-raised motion-safe:animate-pulse" />
        <div className="h-24 self-end bg-band-raised motion-safe:animate-pulse" />
      </div>
    </Loading>
  );
}

function Record({ record }: { record: TrackRecord }) {
  const t = record.totals;
  const hit = share(t.followed, t.measured);
  const chance = share(t.controlFollowed, t.controlHours);
  const enough = t.measured >= MIN_SAMPLE && hit !== null && chance !== null;
  const top = Math.round((1 - record.topRank) * 100);
  const days = record.liveSince ? Math.floor((record.generatedAt - record.liveSince) / DAY_MS) : null;
  const unmeasured = t.alerts - t.measured - t.pending;
  const stats: [string, string][] = [
    ["Days live", count(days).display],
    [record.alertsSince ? `Warnings since ${dateOf(record.alertsSince)}` : "Warnings", count(t.alerts).display],
    ["Checked", count(t.measured).display],
  ];
  const notes = [
    t.pending > 0 && `${count(t.pending).display} waiting for their hour to end.`,
    unmeasured > 0 && `${count(unmeasured).display} couldn't be ranked: the market had under a day of history, or gaps in its data.`,
  ].filter(Boolean);

  return (
    <>
      <div className="grid grid-cols-1 gap-12 [&>*]:min-w-0 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        {enough ? (
          <Comparison hit={hit} chance={chance} totals={t} top={top} />
        ) : (
          <p className="max-w-lg text-lg leading-8 text-pretty">
            {count(t.measured).display} of the warnings have been checked so far. The comparison appears here once {MIN_SAMPLE} have been, since a
            share of a handful says little.
          </p>
        )}
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-6 border-t border-band-border pt-6">
            {stats.map(([label, value], i) => (
              <div key={label} className="flex flex-col justify-between gap-1.5">
                <dt className="text-xs text-band-muted">{label}</dt>
                <dd className="text-2xl tracking-tight sm:text-3xl">
                  <RollingNumber value={value} delay={0.1 + i * 0.08} />
                </dd>
              </div>
            ))}
          </dl>
          {notes.length > 0 && <p className="text-xs leading-5 text-band-muted">{notes.join(" ")}</p>}
        </div>
      </div>
      {record.recent.length > 0 && <Receipts recent={record.recent} topRank={record.topRank} />}
      {enough && <ByKind kinds={record.kinds} top={top} />}
    </>
  );
}

function Comparison({ hit, chance, totals: t, top }: { hit: number; chance: number; totals: TrackRecord["totals"]; top: number }) {
  return (
    <figure className="space-y-8">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p className="display text-7xl leading-none sm:text-8xl">
          <RollingNumber value={wholePercent(hit).display} />
        </p>
        <p className="max-w-xs pb-1 leading-6 text-band-muted text-pretty">of warnings were followed by one of the market's {top}% most volatile hours.</p>
      </div>
      <div className="space-y-5">
        <Bar label="The hour after a warning" value={hit} detail={`${t.followed} of ${t.measured}`} accent />
        <Bar label="The same hour on the 3 days before" value={chance} detail={`${t.controlFollowed} of ${t.controlHours}`} />
      </div>
      {chance > 0 && (
        <figcaption className="text-sm leading-6 text-band-muted text-pretty">
          <Num value={multiple(hit / chance)} className="text-band-foreground" /> as often as at the same time of day on the days before, so it isn't
          just the busy hours of the day.
        </figcaption>
      )}
    </figure>
  );
}

/** A share drawn to scale on a 0–100% track. */
function Bar({ label, value, detail, accent = false }: { label: string; value: number; detail: string; accent?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="flex items-baseline justify-between gap-4 text-sm">
        <span>{label}</span>
        <span className="shrink-0 font-mono whitespace-nowrap tabular-nums">
          {wholePercent(value).display} <span className="text-band-muted">· {detail}</span>
        </span>
      </p>
      <div className="h-2.5 bg-band-raised">
        <m.div
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, margin: REVEAL.margin }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: `${Math.max(0.5, value * 100)}%` }}
          className={`h-full origin-left ${accent ? "bg-band-accent" : "bg-band-muted"}`}
        />
      </div>
    </div>
  );
}

function rankLabel(rank: number, topRank: number): string {
  if (rank >= 1) return "Busiest hour of its week";
  if (rank >= topRank) return `Top ${Math.max(1, Math.round((1 - rank) * 100))}% of its week`;
  return rank >= 0.5 ? "Busier than usual" : "Quieter than usual";
}

function Receipts({ recent, topRank }: { recent: readonly TrackAlert[]; topRank: number }) {
  return (
    <section aria-labelledby="receipts-title" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="receipts-title" className="text-lg font-semibold">
          Latest checked warnings
        </h3>
        <ButtonLink to="/alerts" tone="arrow" className="text-band-foreground">
          All alerts
        </ButtonLink>
      </div>
      <ol className="border-t border-band-border">
        {recent.map((r, i) => {
          const hit = r.rank >= topRank;
          return (
            <Reveal as="li" key={r.id} delay={i * REVEAL.stagger} className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-band-border py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
              <time dateTime={new Date(r.startedAt).toISOString()} className="text-xs text-band-muted tabular-nums">
                {utcTime(r.startedAt, true)}
              </time>
              <div className="min-w-0">
                <p className="text-sm">
                  <Link to={marketPath(r.coin)} viewTransition className="font-mono font-medium underline decoration-band-border underline-offset-4 hover:decoration-band-accent">
                    {r.coin}
                  </Link>
                  <span className="text-band-muted"> · {KIND_LABELS[r.kind]}</span>
                </p>
                <p className="mt-1 text-sm text-band-muted">
                  Moved <Num value={percent(r.movePct / 100)} className="text-band-foreground" /> within the hour, against{" "}
                  <Num value={percent(r.usualPct / 100)} /> in a usual hour.
                </p>
              </div>
              <span
                className={`justify-self-start border px-2 py-1 text-xs font-medium sm:justify-self-end ${hit ? "border-transparent bg-band-accent text-band" : "border-band-border text-band-muted"}`}
              >
                {rankLabel(r.rank, topRank)}
              </span>
            </Reveal>
          );
        })}
      </ol>
    </section>
  );
}

function ByKind({ kinds, top }: { kinds: readonly TrackKind[]; top: number }) {
  const cell = (part: number, whole: number) => (whole ? `${wholePercent(part / whole).display} (${part} of ${whole})` : "--");
  return (
    <details className="faq group border-y border-band-border">
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-6 font-medium">
        By kind of alert
        <span aria-hidden="true" className="faq-dot shrink-0" />
      </summary>
      <div className="space-y-3 pb-6">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Track record by kind of alert">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-band-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Alert
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Warnings
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Followed by a top-{top}% hour
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Same hour, days before
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {kinds.map((k) => (
                <tr key={k.kind} className="border-t border-band-border">
                  <th scope="row" className="py-2.5 pr-4 text-left font-sans font-normal">
                    {KIND_LABELS[k.kind]}
                  </th>
                  <td className="py-2.5 pr-4 text-right">{k.alerts}</td>
                  <td className="py-2.5 pr-4 text-right">{cell(k.followed, k.measured)}</td>
                  <td className="py-2.5 text-right text-band-muted">{cell(k.controlFollowed, k.controlHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-band-muted">Groups of a few alerts swing a lot, so read these as rough.</p>
      </div>
    </details>
  );
}
