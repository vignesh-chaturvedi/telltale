import { GRADE_FILL, GRADE_NAMES, GRADES, type Grade } from "../lib/grades.ts";

/** Share of markets in each grade, as one stacked bar. The label carries the numbers. */
export function GradeBar({ counts, className = "h-2" }: { counts: Record<Grade, number>; className?: string }) {
  const total = GRADES.reduce((s, g) => s + counts[g], 0);
  const label = total === 0 ? "No graded markets" : GRADES.filter((g) => counts[g]).map((g) => `${counts[g]} ${GRADE_NAMES[g]} (${g})`).join(", ");
  return (
    <div role="img" aria-label={label} className={`flex w-full gap-px overflow-hidden rounded-full bg-muted ${className}`}>
      {total > 0 &&
        GRADES.filter((g) => counts[g]).map((g) => (
          <span key={g} className={GRADE_FILL[g]} style={{ width: `${(counts[g] / total) * 100}%` }} title={`${g} · ${counts[g]}`} />
        ))}
    </div>
  );
}
