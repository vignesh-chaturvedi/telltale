import { GRADE_BADGE, GRADE_NAMES, type Grade } from "../lib/grades.ts";

const SIZES = {
  sm: "size-7 text-sm rounded-sm",
  md: "size-9 text-base rounded-md",
  lg: "size-14 text-3xl rounded-lg",
} as const;

/** A grade letter in its color. Always the letter as well as the color, never color alone. */
export function GradeBadge({ grade, size = "sm", note }: { grade: Grade | null; size?: keyof typeof SIZES; note?: string | null }) {
  if (grade === null) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center border border-dashed font-mono font-semibold text-muted-foreground ${SIZES[size]}`}
        title={note ?? "Not graded yet"}
        aria-label={`Not graded${note ? `: ${note}` : ""}`}
        role="img"
      >
        –
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border font-mono font-semibold ${GRADE_BADGE[grade]} ${SIZES[size]}`}
      title={`${grade} · ${GRADE_NAMES[grade]}`}
      aria-label={`Grade ${grade}, ${GRADE_NAMES[grade]}`}
      role="img"
    >
      {grade}
    </span>
  );
}
