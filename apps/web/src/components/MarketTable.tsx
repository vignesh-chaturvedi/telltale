import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { marketPath, splitCoin, type BoardMarket } from "../lib/api.ts";
import { bps, percent, usd } from "../lib/format.ts";
import { GradeBadge } from "./GradeBadge.tsx";
import { Num } from "./Num.tsx";

type Dir = "asc" | "desc";

interface Column {
  key: string;
  label: string;
  /** Shown to screen readers and on hover, when the label is short. */
  help?: string;
  sort?: (m: BoardMarket) => number | string | null;
  render: (m: BoardMarket) => ReactNode;
  numeric?: boolean;
  className?: string;
}

const moveCost = (m: BoardMarket) => {
  const f = usd(m.liquidationMoveCostUsd);
  return m.moveCostIsLowerBound && f.raw ? { ...f, display: `≥ ${f.display}`, ariaLabel: `at least ${f.ariaLabel}` } : f;
};

function marketColumn(showDex: boolean): Column {
  return {
    key: "market",
    label: "Market",
    sort: (m) => splitCoin(m.coin).ticker.toLowerCase(),
    render: (m) => {
      const { ticker, dex } = splitCoin(m.coin);
      return (
        <Link to={marketPath(m.coin)} aria-label={m.coin} className="-mx-2 inline-flex min-h-10 items-center gap-2 rounded-sm px-2 hover:text-primary">
          <span className="font-mono font-medium">{ticker}</span>
          {showDex && dex && <span className="font-mono text-xs text-muted-foreground">{dex}</span>}
        </Link>
      );
    },
  };
}

const METRIC_COLUMNS: readonly Column[] = [
  { key: "grade", label: "Grade", sort: (m) => m.score, render: (m) => <GradeBadge grade={m.grade} note={m.ungradedNote} /> },
  { key: "oi", label: "Open interest", numeric: true, sort: (m) => m.oiUsd, render: (m) => <Num value={usd(m.oiUsd)} /> },
  {
    key: "depth",
    label: "Depth / OI",
    help: "USD within ±2% of mid as a share of open interest",
    numeric: true,
    sort: (m) => m.depthToOi,
    render: (m) => <Num value={percent(m.depthToOi)} />,
  },
  {
    key: "move",
    label: "Cost to liquidation",
    help: "Orders needed to move the price to maximum-leverage liquidation levels",
    numeric: true,
    sort: (m) => m.liquidationMoveCostUsd,
    render: (m) => <Num value={moveCost(m)} />,
  },
  {
    key: "oracle",
    label: "Oracle gap",
    help: "Distance between mid and oracle price, 95th percentile",
    numeric: true,
    sort: (m) => m.oracleGapBps,
    render: (m) => <Num value={bps(m.oracleGapBps)} />,
  },
  { key: "volume", label: "24h volume", numeric: true, sort: (m) => m.volume24hUsd, render: (m) => <Num value={usd(m.volume24hUsd)} /> },
  {
    key: "weakness",
    label: "Main weakness",
    className: "hidden min-w-56 lg:table-cell",
    render: (m) => <span className="text-muted-foreground">{m.reasons[0]?.label ?? m.ungradedNote ?? "None"}</span>,
  },
];

const WITH_DEX = [marketColumn(true), ...METRIC_COLUMNS];
const WITHOUT_DEX = [marketColumn(false), ...METRIC_COLUMNS];
const DEFAULT_SORT = "oi";

function compare(a: number | string | null, b: number | string | null, dir: Dir): number {
  // Missing values always go last, whichever way the column is sorted.
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const order = typeof a === "string" ? a.localeCompare(b as string) : a - (b as number);
  return dir === "asc" ? order : -order;
}

/** Sortable table of markets. The sort lives in the URL (?sort=oracle&dir=desc) so views can be shared. */
export function MarketTable({ markets, caption, showDex = true }: { markets: readonly BoardMarket[]; caption: string; showDex?: boolean }) {
  const COLUMNS = showDex ? WITH_DEX : WITHOUT_DEX;
  const [params, setParams] = useSearchParams();
  const sortKey = COLUMNS.some((c) => c.key === params.get("sort") && c.sort) ? params.get("sort")! : DEFAULT_SORT;
  const dir: Dir = params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : sortKey === "market" ? "asc" : "desc";

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    return [...markets].sort((a, b) => compare(col.sort!(a), col.sort!(b), dir) || a.coin.localeCompare(b.coin));
  }, [COLUMNS, markets, sortKey, dir]);

  const sortBy = (key: string) => {
    const next = new URLSearchParams(params);
    const nextDir: Dir = key === sortKey ? (dir === "asc" ? "desc" : "asc") : key === "market" ? "asc" : "desc";
    next.set("sort", key);
    next.set("dir", nextDir);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            {COLUMNS.map((c, i) => {
              const active = c.key === sortKey;
              const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={`px-3 py-1 font-medium whitespace-nowrap ${c.numeric ? "text-right" : "text-left"} ${i === 0 ? "sticky left-0 z-10 bg-card" : ""} ${c.className ?? ""}`}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => sortBy(c.key)}
                      title={c.help}
                      className={`-mx-2 inline-flex min-h-10 items-center gap-1 rounded-sm px-2 transition-colors hover:text-foreground ${active ? "text-foreground" : ""} ${c.numeric ? "flex-row-reverse" : ""}`}
                    >
                      {c.label}
                      <Icon aria-hidden="true" className={`size-3.5 ${active ? "" : "opacity-50"}`} />
                      {c.help && <span className="sr-only">: {c.help}</span>}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.coin} className="group border-b last:border-b-0 hover:bg-muted/60">
              {COLUMNS.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row" className="sticky left-0 z-10 bg-card px-3 py-0.5 text-left font-normal whitespace-nowrap group-hover:bg-muted">
                    {c.render(m)}
                  </th>
                ) : (
                  <td key={c.key} className={`px-3 py-0.5 whitespace-nowrap ${c.numeric ? "text-right" : ""} ${c.className ?? ""}`}>
                    {c.render(m)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
