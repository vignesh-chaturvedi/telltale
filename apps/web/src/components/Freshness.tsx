import { TriangleAlert } from "lucide-react";
import { useNow } from "../lib/api.ts";
import { age } from "../lib/format.ts";

/** Grades older than this suggest the collector has stopped or is reconnecting. */
const STALE_SECONDS = 180;

/**
 * How old the newest data is. Counted from when this page received it, so a wrong clock on the
 * viewer's machine doesn't change the answer.
 */
export function Freshness({ dataAgeSeconds, receivedAt, windowMinutes }: { dataAgeSeconds: number; receivedAt: number | null; windowMinutes: number }) {
  const now = useNow();
  const seconds = dataAgeSeconds + (receivedAt ? Math.max(0, now - receivedAt) / 1000 : 0);
  if (seconds > STALE_SECONDS) {
    return (
      <p className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        <span>
          The newest data is <span className="tabular-nums">{age(seconds)}</span> old. Grades will update when collection resumes.
        </span>
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
      <span>
        Updated <span className="tabular-nums">{age(seconds)}</span> ago · grades cover the last {windowMinutes} minutes
      </span>
    </p>
  );
}
