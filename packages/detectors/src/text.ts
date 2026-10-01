// Short number formats for the sentences in grade reasons and alerts. The website formats its
// own numbers; these only need to read well in a sentence or a Telegram message.

export const usd = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;

/** A share as a percentage: 0.034 → "3.4%", 0.25 → "25%". */
export const pct = (share: number): string => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

export const bps = (n: number): string => `${n.toFixed(0)} bps`;

/** 45_000 → "45 s", 150_000 → "2 min 30 s", 7_200_000 → "2 h". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 && m < 10 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A price with enough digits to compare two nearby values. */
export function price(n: number): string {
  if (n >= 1000) return n.toFixed(1);
  if (n >= 1) return n.toFixed(3);
  return n.toPrecision(4);
}
