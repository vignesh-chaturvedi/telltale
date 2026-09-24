/** Small statistics helpers. Every function ignores nulls and returns null for empty input. */

const values = (xs: readonly (number | null | undefined)[]): number[] =>
  xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

/** Nearest-rank quantile, `q` in [0, 1]. */
export function quantile(xs: readonly (number | null | undefined)[], q: number): number | null {
  const v = values(xs).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const rank = Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1));
  return v[rank]!;
}

export const median = (xs: readonly (number | null | undefined)[]): number | null => quantile(xs, 0.5);
export const p95 = (xs: readonly (number | null | undefined)[]): number | null => quantile(xs, 0.95);

export function min(xs: readonly (number | null | undefined)[]): number | null {
  const v = values(xs);
  return v.length ? Math.min(...v) : null;
}

/** Sample standard deviation. */
export function stdev(xs: readonly (number | null | undefined)[]): number | null {
  const v = values(xs);
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
}

/** Last non-null value. */
export function last<T>(xs: readonly (T | null | undefined)[]): T | null {
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i];
    if (x !== null && x !== undefined) return x;
  }
  return null;
}
