import { GRADE_NAMES, GRADES, RULES, type Grade, type MarketMetrics, type MetricKey, type Rule } from "@telltale/detectors";
import { bps, count, percent, usd, type Formatted } from "./format.ts";

export { GRADE_NAMES, GRADES, type Grade, type MetricKey };

// Full class strings, so Tailwind can find them in the source.
export const GRADE_TEXT: Record<Grade, string> = {
  A: "text-grade-a",
  B: "text-grade-b",
  C: "text-grade-c",
  D: "text-grade-d",
  E: "text-grade-e",
};
export const GRADE_BADGE: Record<Grade, string> = {
  A: "text-grade-a border-grade-a/50 bg-grade-a/8",
  B: "text-grade-b border-grade-b/50 bg-grade-b/8",
  C: "text-grade-c border-grade-c/50 bg-grade-c/8",
  D: "text-grade-d border-grade-d/50 bg-grade-d/8",
  E: "text-grade-e border-grade-e/50 bg-grade-e/8",
};
export const GRADE_FILL: Record<Grade, string> = {
  A: "bg-grade-a",
  B: "bg-grade-b",
  C: "bg-grade-c",
  D: "bg-grade-d",
  E: "bg-grade-e",
};

export const GRADE_SUMMARY: Record<Grade, string> = {
  A: "Deep for its open interest, costly to push around, and priced in line with its oracle.",
  B: "No serious weakness.",
  C: "At least one weakness worth knowing about before trading.",
  D: "Several weaknesses, or one serious one.",
  E: "Thin, cheap to move and/or far from its oracle.",
};

export interface MetricInfo {
  key: MetricKey;
  name: string;
  /** What the number means, in one sentence. */
  help: string;
  weight: number;
  format: (m: MarketMetrics) => Formatted;
  /** The range each grade covers, e.g. "≥ 10%". `null` when no value lands in that grade. */
  bands: Record<Grade, string | null>;
}

const CUT_FORMAT: Record<MetricKey, (n: number) => string> = {
  depthToOi: (n) => `${+(n * 100).toFixed(2)}%`,
  liquidationMoveCost: (n) => usd(n).display,
  // The unit is on the value above the bands, so the limits stay short enough for their cells.
  oracleGap: (n) => `${n}`,
  peerGap: (n) => `${n}`,
  bigMoves: (n) => count(n, ["day", "days"]).display,
};

function bandsOf(rule: Rule): Record<Grade, string | null> {
  // Whole days, with repeated limits, so B and D can't be reached.
  if (rule.key === "bigMoves") return { A: "0 days", B: null, C: "1 day", D: null, E: "2 days or more" };
  const fmt = CUT_FORMAT[rule.key];
  const [a, b, c, d] = rule.cuts;
  const within = rule.higherIsBetter ? "≥" : "≤";
  return {
    A: `${within} ${fmt(a)}`,
    B: `${within} ${fmt(b)}`,
    C: `${within} ${fmt(c)}`,
    D: `${within} ${fmt(d)}`,
    E: `${rule.higherIsBetter ? "<" : ">"} ${fmt(d)}`,
  };
}

const INFO: Record<MetricKey, Pick<MetricInfo, "name" | "help" | "format">> = {
  depthToOi: {
    name: "Depth against open interest",
    help: "USD resting within ±2% of the mid price, as a share of open interest.",
    format: (m) => percent(m.depthToOi),
  },
  liquidationMoveCost: {
    name: "Cost to reach liquidation levels",
    help: "Orders needed on the thinner side to move the price far enough to liquidate a maximum-leverage position.",
    format: (m) => {
      const f = usd(m.liquidationMoveCostUsd);
      return m.moveCostIsLowerBound && f.raw ? { ...f, display: `≥ ${f.display}`, ariaLabel: `at least ${f.ariaLabel}` } : f;
    },
  },
  oracleGap: {
    name: "Oracle gap",
    help: "How far the mid price was from the oracle price (95th percentile).",
    format: (m) => bps(m.oracleGapBps),
  },
  peerGap: {
    name: "Gap to other deployers",
    help: "How far the oracle was from other deployers' oracles for the same asset (95th percentile).",
    format: (m) => bps(m.peerGapBps),
  },
  bigMoves: {
    name: "Days with 50%+ moves",
    help: "Days in the last 30 whose high or low was more than 50% from the open.",
    format: (m) => count(m.bigMoveDays30, ["day", "days"]),
  },
};

export const METRICS: readonly MetricInfo[] = RULES.map((rule) => ({ key: rule.key, weight: rule.weight, bands: bandsOf(rule), ...INFO[rule.key] }));

/** A metric's band limits as chart reference lines, each labeled with the grade it closes. */
export function bandLines(key: MetricKey): { value: number; label: string }[] {
  const rule = RULES.find((r) => r.key === key)!;
  return rule.cuts.map((value, i) => ({ value, label: GRADES[i]! }));
}
