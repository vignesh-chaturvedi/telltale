import type { MarketMetrics } from "./metrics.ts";

export type Grade = "A" | "B" | "C" | "D" | "E";
export const GRADES: readonly Grade[] = ["A", "B", "C", "D", "E"];
export const GRADE_NAMES: Record<Grade, string> = { A: "Strong", B: "Sound", C: "Mixed", D: "Weak", E: "Fragile" };
const POINTS: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, E: 0 };

export type MetricKey = "depthToOi" | "liquidationMoveCost" | "oracleGap" | "peerGap" | "bigMoves";

export interface Rule {
  key: MetricKey;
  /** Share of the market score. Missing metrics drop out and the rest are reweighted. */
  weight: number;
  higherIsBetter: boolean;
  /** Limits for A, B, C and D. Anything past the D limit is E. */
  cuts: readonly [number, number, number, number];
  value: (m: MarketMetrics) => number | null;
  /** Short, neutral label shown when the metric grades C or worse. */
  label: string;
  /** One sentence with the numbers behind the grade. */
  describe: (m: MarketMetrics) => string;
}

const usd = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
const pct = (share: number): string => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

/** The graded metrics, their weights and band limits. docs/methodology.md explains each one. */
export const RULES: readonly Rule[] = [
  {
    key: "depthToOi",
    weight: 0.3,
    higherIsBetter: true,
    cuts: [0.1, 0.05, 0.02, 0.01],
    value: (m) => m.depthToOi,
    label: "Thin book for its open interest",
    describe: (m) => `${usd(m.depth2Usd ?? 0)} rests within ±2% of mid against ${usd(m.oiUsd ?? 0)} of open interest (${pct(m.depthToOi ?? 0)}).`,
  },
  {
    key: "liquidationMoveCost",
    weight: 0.25,
    higherIsBetter: true,
    // Centered so a typical core market (about $140K in September 2026) lands at C.
    cuts: [2.5e6, 5e5, 1e5, 2.5e4],
    value: (m) => m.liquidationMoveCostUsd,
    label: "Cheap to move to liquidation levels",
    describe: (m) =>
      `${m.moveCostIsLowerBound ? "At least " : "About "}${usd(m.liquidationMoveCostUsd ?? 0)} of orders moves the price ${m.liquidationBandPct}%, ` +
      `within the ${m.liquidationDistancePct.toFixed(1)}% that liquidates a maximum-leverage position.`,
  },
  {
    key: "oracleGap",
    weight: 0.25,
    higherIsBetter: false,
    // Perps normally trade a few bps from their oracle (funding basis), so up to 20 bps is an A.
    cuts: [20, 40, 100, 250],
    value: (m) => m.oracleGapBps,
    label: "Oracle often away from the market",
    describe: (m) => `The oracle and the mid price were up to ${(m.oracleGapBps ?? 0).toFixed(0)} bps apart (95th percentile).`,
  },
  {
    key: "peerGap",
    weight: 0.1,
    higherIsBetter: false,
    cuts: [10, 25, 75, 200],
    value: (m) => m.peerGapBps,
    label: "Oracle disagrees with another deployer",
    describe: (m) => `The oracle was up to ${(m.peerGapBps ?? 0).toFixed(0)} bps from ${m.peers.join(", ")} (95th percentile).`,
  },
  {
    key: "bigMoves",
    weight: 0.1,
    higherIsBetter: false,
    cuts: [0, 0, 1, 1],
    value: (m) => m.bigMoveDays30,
    label: "Moves over 50% in a day",
    describe: (m) => `${m.bigMoveDays30} of the last 30 days moved more than 50% from the open.`,
  },
];

export function band(rule: Rule, value: number): Grade {
  const i = rule.cuts.findIndex((cut) => (rule.higherIsBetter ? value >= cut : value <= cut));
  return i === -1 ? "E" : GRADES[i]!;
}

export function letter(score: number): Grade {
  return score >= 3.5 ? "A" : score >= 2.5 ? "B" : score >= 1.5 ? "C" : score >= 0.75 ? "D" : "E";
}

export interface Reason {
  metric: MetricKey;
  grade: Grade;
  label: string;
  text: string;
}

export interface MarketGrade {
  coin: string;
  /** `null` when there isn't enough data to grade. */
  grade: Grade | null;
  score: number | null;
  bands: Partial<Record<MetricKey, Grade>>;
  /** Metrics graded C or worse, worst first. */
  reasons: Reason[];
  /** Context that isn't graded but a trader should see. */
  notes: string[];
}

export interface GradeOptions {
  /** Minutes with both a context and a book needed before a market is graded. */
  minCoverageMinutes: number;
}

export const DEFAULT_GRADE_OPTIONS: GradeOptions = { minCoverageMinutes: 20 };

export function gradeMarket(m: MarketMetrics, options: GradeOptions = DEFAULT_GRADE_OPTIONS): MarketGrade {
  const notes = marketNotes(m);
  if (m.coverageMinutes < options.minCoverageMinutes) {
    return {
      coin: m.coin,
      grade: null,
      score: null,
      bands: {},
      reasons: [],
      notes: [`Only ${m.coverageMinutes} minutes of data; grading needs ${options.minCoverageMinutes}.`, ...notes],
    };
  }

  const bands: Partial<Record<MetricKey, Grade>> = {};
  let weighted = 0;
  let weights = 0;
  for (const rule of RULES) {
    const value = rule.value(m);
    if (value === null) continue;
    const g = band(rule, value);
    bands[rule.key] = g;
    weighted += POINTS[g] * rule.weight;
    weights += rule.weight;
  }
  if (weights === 0) return { coin: m.coin, grade: null, score: null, bands, reasons: [], notes: ["No metric could be measured.", ...notes] };

  const score = weighted / weights;
  // One serious problem limits the grade: at most two letters better than the worst metric.
  const worst = Math.min(...Object.values(bands).map((g) => POINTS[g]));
  const grade = letter(Math.min(score, worst + 2));
  const reasons = RULES.filter((r) => bands[r.key] && POINTS[bands[r.key]!] <= POINTS.C)
    .map((r) => ({ metric: r.key, grade: bands[r.key]!, label: r.label, text: r.describe(m) }))
    .sort((a, b) => POINTS[a.grade] - POINTS[b.grade]);
  return { coin: m.coin, grade, score, bands, reasons, notes };
}

function marketNotes(m: MarketMetrics): string[] {
  const notes: string[] = [];
  if (m.oiCapUse !== null && m.oiCapUse >= 0.9) notes.push(`At ${pct(m.oiCapUse)} of its open-interest cap, so new positions may be refused.`);
  if (m.oracleUnchangedOver10sShare !== null && m.oracleUnchangedOver10sShare >= 0.25) {
    notes.push(
      `The oracle price went unchanged for over 10 s in ${pct(m.oracleUnchangedOver10sShare)} of minutes. ` +
        "That can be normal: the underlying market may be closed or have no public price.",
    );
  }
  if (m.moveCostIsLowerBound) notes.push(`The visible book usually doesn't reach ${m.liquidationBandPct}% from mid, so the move cost is a lower bound.`);
  return notes;
}

export interface DexSummary {
  dex: string;
  status: "active" | "dormant";
  grade: Grade | null;
  score: number | null;
  markets: number;
  graded: number;
  oiUsd: number;
  /** Markets per grade. */
  counts: Record<Grade, number>;
  reasons: string[];
  notes: string[];
}

export interface DexInput {
  dex: string;
  collateral: string | null;
  markets: readonly { metrics: MarketMetrics; grade: MarketGrade }[];
}

/** Share of a DEX's graded markets with a D or E oracle gap that caps the DEX at C. */
export const DEX_ORACLE_SHARE = 0.25;

export function gradeDex(input: DexInput): DexSummary {
  const counts: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const graded = input.markets.filter((m) => m.grade.grade !== null);
  for (const m of graded) counts[m.grade.grade!]++;
  const oiUsd = input.markets.reduce((s, m) => s + (m.metrics.oiUsd ?? 0), 0);
  const notes = input.collateral ? [`Collateral: ${input.collateral}.`] : [];
  const base = { dex: input.dex, markets: input.markets.length, graded: graded.length, oiUsd, counts, notes };

  if (input.markets.length === 0) return { ...base, status: "dormant", grade: null, score: null, reasons: ["No live markets."] };
  if (graded.length === 0) return { ...base, status: "active", grade: null, score: null, reasons: ["Not enough data to grade any market yet."] };

  // Weight by open interest, so a DEX is graded where its traders' money is.
  const weightOf = (m: (typeof graded)[number]) => Math.max(m.metrics.oiUsd ?? 0, 1);
  const total = graded.reduce((s, m) => s + weightOf(m), 0);
  const score = graded.reduce((s, m) => s + m.grade.score! * weightOf(m), 0) / total;
  const reasons: string[] = [];
  let cap = 4;
  const oracleTrouble = graded.filter((m) => m.grade.bands.oracleGap === "D" || m.grade.bands.oracleGap === "E");
  if (oracleTrouble.length / graded.length >= DEX_ORACLE_SHARE) {
    cap = POINTS.C;
    reasons.push(`The oracle and the mid price differ widely on ${oracleTrouble.length} of ${graded.length} markets.`);
  }
  const weak = graded
    .filter((m) => m.grade.grade === "D" || m.grade.grade === "E")
    .sort((a, b) => (b.metrics.oiUsd ?? 0) - (a.metrics.oiUsd ?? 0));
  if (weak.length) reasons.push(`${weak.length} of ${graded.length} markets grade D or E, including ${weak.slice(0, 3).map((m) => m.metrics.coin).join(", ")}.`);
  return { ...base, status: "active", grade: letter(Math.min(score, cap)), score, reasons };
}
