// Number display rules for the whole site, following the number-formatting spec v1.0:
// no scientific notation, no signed zero, "--" for missing values, abbreviations only in compact
// USD values, zero-subscript for tiny prices, and the raw value kept for copy and screen readers.
//
// One extension: basis points ("bps"), which the spec doesn't cover. They follow the percent
// rules with a " bps" suffix, 1 decimal under 10 bps and none above.

export type Context = "compact" | "detailed";

export interface Formatted {
  display: string;
  /** Full-precision decimal for copy and export. Empty when there's no value. */
  raw: string;
  /** What a screen reader should say. */
  ariaLabel: string;
}

export const PLACEHOLDER = "--";
const none: Formatted = { display: PLACEHOLDER, raw: "", ariaLabel: "no data" };

function clean(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Object.is(value, -0) || Math.abs(value) < Number.EPSILON * 10 ? 0 : value;
}

/** Decimal string without scientific notation. */
export function toDecimalString(value: number): string {
  if (value === 0) return "0";
  const s = value.toString();
  return /e/i.test(s) ? value.toFixed(20).replace(/\.?0+$/, "") : s;
}

/** Round half away from zero to `decimals` places. */
function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * f + Number.EPSILON)) / f;
}

function withCommas(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const ABBREVIATIONS = [
  { at: 1e12, suffix: "T" },
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/** Leading zeros after the decimal point, for 0 < abs < 1. */
function leadingZeros(abs: number): number {
  const digits = abs.toFixed(20).split(".")[1] ?? "";
  let n = 0;
  for (const d of digits) {
    if (d !== "0") break;
    n++;
  }
  return n;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
const subscript = (n: number) => String(n).split("").map((d) => SUBSCRIPT[Number(d)]).join("");

/** USD amounts: open interest, depth, volume, move cost. */
export function usd(value: number | null | undefined, context: Context = "compact"): Formatted {
  const v = clean(value);
  if (v === null) return none;
  const raw = toDecimalString(v);
  if (v === 0) return { display: "$0.00", raw, ariaLabel: "0 dollars" };
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs < 0.005) return { display: `${sign}<$0.01`, raw, ariaLabel: `${sign}less than 1 cent` };
  if (context === "compact") {
    for (const [i, { at, suffix }] of ABBREVIATIONS.entries()) {
      if (abs < at) continue;
      let scaled = round(abs / at, 1);
      let unit: string = suffix;
      // 999.95K rounds to 1000K; show it as 1M instead.
      if (scaled >= 1000 && i > 0) {
        scaled = 1;
        unit = ABBREVIATIONS[i - 1]!.suffix;
      }
      const n = scaled.toFixed(1).replace(/\.0$/, "");
      return { display: `${sign}$${n}${unit}`, raw, ariaLabel: `${sign}${n}${unit} dollars` };
    }
  }
  const display = `${sign}$${withCommas(round(abs, 2), 2)}`;
  return { display, raw, ariaLabel: `${display.replace("$", "")} dollars` };
}

/** A market price in USDC. Never abbreviated; tiny prices use zero-subscript. */
export function price(value: number | null | undefined, context: Context = "detailed"): Formatted {
  const v = clean(value);
  if (v === null) return none;
  const raw = toDecimalString(v);
  if (v === 0) return { display: "$0.00", raw, ariaLabel: "0 dollars" };
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs < 1 && leadingZeros(abs) >= 3) {
    const zeros = leadingZeros(abs);
    const sig = context === "compact" ? 2 : 4;
    const fixed = round(abs, zeros + sig).toFixed(zeros + sig);
    const digits = (fixed.split(".")[1] ?? "").slice(zeros);
    return { display: `${sign}$0.0${subscript(zeros)}${digits}`, raw, ariaLabel: `${sign}${fixed} dollars` };
  }
  let decimals: number;
  if (abs >= 1000) decimals = 2;
  else if (abs >= 100) decimals = context === "compact" ? 0 : 2;
  else if (abs >= 1) decimals = context === "compact" ? 1 : 3;
  else decimals = Math.min(8, leadingZeros(abs) + (context === "compact" ? 3 : 5));
  const display = `${sign}$${withCommas(round(abs, decimals), decimals)}`;
  return { display, raw, ariaLabel: `${display.replace("$", "")} dollars` };
}

/** A share, given as a fraction (0.25 → "25.00%"). */
export function percent(share: number | null | undefined): Formatted {
  const v = clean(share === null || share === undefined ? share : share * 100);
  if (v === null) return none;
  const raw = toDecimalString(v);
  if (v === 0) return { display: "0.00%", raw, ariaLabel: "0 percent" };
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs < 0.005) return { display: `${sign}<0.01%`, raw, ariaLabel: `${sign}less than 0.01 percent` };
  const decimals = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  const display = `${sign}${withCommas(round(abs, decimals), decimals)}%`;
  return { display, raw, ariaLabel: `${display.replace("%", "")} percent` };
}

/** Basis points: 1 decimal under 10 bps, none above. */
export function bps(value: number | null | undefined): Formatted {
  const v = clean(value);
  if (v === null) return none;
  const raw = toDecimalString(v);
  if (v === 0) return { display: "0 bps", raw, ariaLabel: "0 basis points" };
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs < 0.05) return { display: `${sign}<0.1 bps`, raw, ariaLabel: `${sign}less than 0.1 basis points` };
  const decimals = abs < 10 ? 1 : 0;
  const n = withCommas(round(abs, decimals), decimals);
  return { display: `${sign}${n} bps`, raw, ariaLabel: `${sign}${n} basis points` };
}

/** Whole numbers: counts of days, markets, minutes. */
export function count(value: number | null | undefined, unit?: [singular: string, plural: string]): Formatted {
  const v = clean(value);
  if (v === null) return none;
  const n = Math.round(v);
  const label = unit ? ` ${n === 1 ? unit[0] : unit[1]}` : "";
  return { display: `${withCommas(n, 0)}${label}`, raw: String(v), ariaLabel: `${n}${label}` };
}

/** A grade score from 0 to 4. */
export function score(value: number | null | undefined): Formatted {
  const v = clean(value);
  if (v === null) return none;
  const display = round(v, 2).toFixed(2);
  return { display, raw: toDecimalString(v), ariaLabel: `score ${display} out of 4` };
}

/** "12 s", "3 min", "2 h" — how old the data is. */
export function age(seconds: number | null | undefined): string {
  const v = clean(seconds);
  if (v === null) return PLACEHOLDER;
  if (v < 90) return `${Math.round(v)} s`;
  if (v < 90 * 60) return `${Math.round(v / 60)} min`;
  return `${Math.round(v / 3600)} h`;
}

/** "14:05 UTC" or "Sep 29, 14:05 UTC". */
export function utcTime(ms: number | null | undefined, withDate = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return PLACEHOLDER;
  const d = new Date(ms);
  const time = d.toISOString().slice(11, 16);
  if (!withDate) return `${time} UTC`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}
