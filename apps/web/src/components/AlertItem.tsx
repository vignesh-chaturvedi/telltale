import { TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { dexPath, marketPath, type AlertView } from "../lib/api.ts";
import { KIND_LABELS, SEVERITY_BADGE, SEVERITY_LABELS } from "../lib/alerts.ts";
import { utcTime } from "../lib/format.ts";

function status(a: AlertView): string {
  if (a.kind === "pulled-wall" || a.kind === "deployer-change") return "";
  if (a.resolvedAt === null) return "ongoing";
  return a.minutes > 1 ? `lasted ${a.minutes} min` : "";
}

/** One alert: severity, where, what, and the numbers behind it. */
export function AlertItem({ alert: a, showMarket = true }: { alert: AlertView; showMarket?: boolean }) {
  const where = a.coin ?? (a.dex || "core");
  const state = status(a);
  return (
    <article className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:gap-4">
      <div className="flex shrink-0 items-center gap-2 sm:w-44 sm:flex-col sm:items-start">
        <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE[a.severity]}`}>
          {a.severity !== "info" && <TriangleAlert aria-hidden="true" className="size-3" />}
          {SEVERITY_LABELS[a.severity]}
        </span>
        <time dateTime={new Date(a.startedAt).toISOString()} className="text-xs text-muted-foreground tabular-nums">
          {utcTime(a.startedAt, true)}
        </time>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {showMarket && (
            <>
              <Link to={a.coin ? marketPath(a.coin) : dexPath(a.dex || "core")} className="link-muted font-mono text-foreground">
                {where}
              </Link>
              {" · "}
            </>
          )}
          {KIND_LABELS[a.kind]}
          {state && ` · ${state}`}
        </p>
        <h3 className="mt-0.5 text-sm font-medium">{a.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{a.detail}</p>
      </div>
    </article>
  );
}
