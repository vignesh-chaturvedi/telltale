import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { utcTime, type Formatted } from "../lib/format.ts";

export interface Series {
  label: string;
  values: readonly (number | null)[];
  /** A CSS color, from the theme tokens. */
  color: string;
  dashed?: boolean;
}

interface Props {
  title: string;
  /** One sentence for screen readers describing what the chart shows now. */
  summary: string;
  times: readonly number[];
  series: readonly Series[];
  format: (v: number) => Formatted;
  /** Faint horizontal lines, drawn only when inside the plotted range (grade limits). */
  refs?: readonly { value: number; label: string }[];
  height?: number;
}

const W = 600;

function domain(values: number[]): [number, number] {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.01 || 1;
    lo -= pad;
    hi += pad;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  // Keep a zero floor for values that can't go negative.
  if (Math.min(...values) >= 0 && lo < 0) lo = 0;
  return [lo, hi];
}

/** Splits at missing values so gaps in the data show as gaps in the line. */
function paths(values: readonly (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function LineChart({ title, summary, times, series, format, refs = [], height = 140 }: Props) {
  const id = useId();
  const [cursor, setCursor] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const n = times.length;

  if (all.length < 2) {
    return (
      <figure className="rounded-lg border bg-card p-4">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <p className="mt-6 mb-4 text-center text-sm text-muted-foreground">Not enough data yet. The chart fills in as the collector runs.</p>
      </figure>
    );
  }

  const [lo, hi] = domain(all);
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const lastIndex = (() => {
    for (let i = n - 1; i >= 0; i--) if (series.some((s) => s.values[i] !== null && s.values[i] !== undefined)) return i;
    return n - 1;
  })();
  const at = cursor ?? lastIndex;
  const visibleRefs = refs.filter((r) => r.value > lo && r.value < hi);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (n - 1));
    setCursor(Math.max(0, Math.min(n - 1, i)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 12 : 1;
    if (e.key === "ArrowLeft") setCursor(Math.max(0, at - step));
    else if (e.key === "ArrowRight") setCursor(Math.min(n - 1, at + step));
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End") setCursor(n - 1);
    else if (e.key === "Escape") setCursor(null);
    else return;
    e.preventDefault();
  };
  const pct = (i: number) => `${(x(i) / W) * 100}%`;

  return (
    <figure className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption id={`${id}-title`} className="text-sm font-medium">
          {title}
        </figcaption>
        <p className="text-xs text-muted-foreground" aria-hidden="true">
          <span className="font-mono tabular-nums">{utcTime(times[at], true)}</span>
          {series.map((s) => {
            const v = s.values[at];
            return (
              <span key={s.label} className="ml-3 inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                {series.length > 1 && <span>{s.label}</span>}
                <span className="font-mono text-foreground tabular-nums">{v === null || v === undefined ? "--" : format(v).display}</span>
              </span>
            );
          })}
        </p>
      </div>
      <p className="sr-only">{summary}</p>
      <div
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-help`}
        tabIndex={0}
        className="relative mt-3 touch-pan-y select-none rounded-sm"
        style={{ height }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={onKeyDown}
      >
        <span id={`${id}-help`} className="sr-only">
          Use the left and right arrow keys to read values.
        </span>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          {visibleRefs.map((r) => (
            <line key={r.label} x1={0} x2={W} y1={y(r.value)} y2={y(r.value)} stroke="var(--border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((s) => (
            <path
              key={s.label}
              d={paths(s.values, x, y)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {visibleRefs.map((r) => (
          <span
            key={r.label}
            aria-hidden="true"
            className="absolute right-0 -translate-y-1/2 bg-card pl-1 font-mono text-[11px] text-muted-foreground"
            style={{ top: y(r.value) }}
          >
            {r.label}
          </span>
        ))}
        {cursor !== null && <span aria-hidden="true" className="absolute inset-y-0 w-px bg-muted-foreground/40" style={{ left: pct(cursor) }} />}
        {series.map((s) => {
          const v = s.values[at];
          if (v === null || v === undefined) return null;
          return (
            <span
              key={s.label}
              aria-hidden="true"
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
              style={{ left: pct(at), top: y(v), background: s.color }}
            />
          );
        })}
        <span aria-hidden="true" className="absolute top-0 left-0 bg-card pr-1 font-mono text-[11px] text-muted-foreground">
          {format(hi).display}
        </span>
        <span aria-hidden="true" className="absolute bottom-0 left-0 bg-card pr-1 font-mono text-[11px] text-muted-foreground">
          {format(lo).display}
        </span>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground" aria-hidden="true">
        <span>{utcTime(times[0])}</span>
        <span>{utcTime(times[n - 1])}</span>
      </div>
    </figure>
  );
}
