import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DIGITS } from "../lib/motion.ts";

type Phase = "idle" | "rolling" | "live";

/**
 * A formatted number whose digits roll into place like a slot machine: a 600 ms roll on first
 * appearance, then 150 ms for live updates. Screen readers get the plain value.
 */
export function RollingNumber({ value, delay = 0, className = "" }: { value: string; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduce ? "live" : "idle");
  // the first roll waits until the number is on screen, so numbers further down roll as you reach them
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -8% 0px" });

  useEffect(() => {
    if (reduce) return setPhase("live");
    if (!inView) return;
    const start = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => setPhase("rolling"))), Math.max(50, delay * 1000));
    return () => clearTimeout(start);
  }, [delay, reduce, inView]);
  useEffect(() => {
    if (phase !== "rolling") return;
    const done = setTimeout(() => setPhase("live"), DIGITS.mountMs + DIGITS.spreadMs + 50);
    return () => clearTimeout(done);
  }, [phase]);

  const chars = [...value];
  const total = chars.filter((c) => /\d/.test(c)).length;
  let order = 0;
  return (
    <span ref={ref} className={`inline-flex tabular-nums ${className}`}>
      <span className="sr-only">{value}</span>
      {chars.map((c, i) =>
        /\d/.test(c) ? (
          <Digit key={i} digit={Number(c)} phase={phase} order={order++} total={total} />
        ) : (
          <span key={i} aria-hidden="true" className="inline-block h-[1em] leading-none">
            {c}
          </span>
        ),
      )}
    </span>
  );
}

function Digit({ digit, phase, order, total }: { digit: number; phase: Phase; order: number; total: number }) {
  const shown = phase === "idle" ? 0 : digit;
  const live = phase === "live";
  const delay = phase === "rolling" ? (order / Math.max(1, total - 1)) * DIGITS.spreadMs : 0;
  return (
    <span aria-hidden="true" className="relative inline-block h-[1em] overflow-hidden leading-none">
      <span
        className="block"
        style={{
          transform: `translateY(-${shown * 10}%)`,
          transition: `transform ${live ? DIGITS.updateMs : DIGITS.mountMs}ms ${live ? DIGITS.updateEase : DIGITS.mountEase} ${delay}ms`,
          willChange: "transform",
        }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="block h-[1em] leading-none">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
