import type { ReactNode } from "react";
import { useNow } from "../lib/api.ts";

/** The time in UTC, the clock every number on the site is stamped in, with a pulsing dot. */
export function LiveClock({ className = "" }: { className?: string }) {
  const now = new Date(useNow(10_000));
  const hhmm = now.toISOString().slice(11, 16);
  return (
    <p className={`inline-flex items-center gap-2 font-mono text-xs ${className}`}>
      <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-signal" />
      <time dateTime={now.toISOString()}>{hhmm} UTC</time>
    </p>
  );
}

/** One question: native <details>, so it opens with Enter or Space and needs no script. */
export function FaqItem({ q, children, open = false }: { q: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="faq group border-b py-1" open={open}>
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-6 text-base font-medium">
        {q}
        <span aria-hidden="true" className="faq-dot shrink-0" />
      </summary>
      <div className="max-w-2xl pb-5 text-sm leading-6 text-muted-foreground text-pretty">{children}</div>
    </details>
  );
}

// 9 × 9 pixel glyphs for the five checks, in the spirit of the reference's pixel icons. "#" is a lit pixel.
const GLYPHS = {
  depth: [".........", "#........", "#..#.....", "#..#..#..", "#..#..#..", "#..#..#.#", "#..#..#.#", "#..#..#.#", "#########"],
  cost: ["....#....", "....#....", "....#....", "..#####..", "...###...", "....#....", ".........", "#########", "#########"],
  oracle: ["..#####..", ".#.....#.", "#...#...#", "#..###..#", "#...#...#", ".#.....#.", "..#####..", ".........", "........."],
  peers: ["####.....", "#..#.....", "#..#.....", "####.....", "....#####", ".....#..#", ".....#..#", ".....####", "........."],
  moves: [".........", ".......#.", "......#.#", ".....#...", "#...#....", ".#.#.....", "..#......", ".........", "........."],
} as const;
export type Glyph = keyof typeof GLYPHS;

export function PixelIcon({ name, className = "" }: { name: Glyph; className?: string }) {
  const rows = GLYPHS[name];
  return (
    <svg viewBox="0 0 9 9" className={`size-9 shrink-0 ${className}`} aria-hidden="true" shapeRendering="crispEdges">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
    </svg>
  );
}
