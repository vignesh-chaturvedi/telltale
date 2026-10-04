// Motion presets for the whole site (motion/react). Springs for anything that moves into place, short
// fades for anything that only changes. MotionConfig reducedMotion="user" in App keeps opacity and drops
// the movement for viewers who ask for less motion.

/* ─────────────────────────────────────────────────────────
 * HOME HERO STORYBOARD
 *
 * The header and the board's data are never held back; only the hero's own pieces cascade.
 *
 *    0ms   header, hero ground and centrepiece already on screen
 *  120ms   eyebrow fades in
 *  220ms   headline rises, line by line (90ms apart)
 *  480ms   sub-line and the two buttons rise
 *  640ms   live stats roll their digits in (600ms, 200ms spread)
 *  900ms   footnotes and the UTC clock fade in
 * ───────────────────────────────────────────────────────── */
export const HERO_TIMING = {
  eyebrow: 0.12,
  headline: 0.22,
  lineGap: 0.09,
  sub: 0.48,
  stats: 0.64,
  foot: 0.9,
} as const;

export const SPRING = {
  stiff: { type: "spring" as const, stiffness: 350, damping: 28 },
  smooth: { type: "spring" as const, stiffness: 300, damping: 30 },
  bouncy: { type: "spring" as const, stiffness: 280, damping: 26 },
};

export const REVEAL = {
  offsetY: 16,
  margin: "0px 0px -12% 0px",
  spring: SPRING.smooth,
  stagger: 0.06,
};

/** Headlines: each word rises from behind a mask, 45 ms after the one before. */
export const MASK = {
  spring: { type: "spring" as const, stiffness: 240, damping: 30 },
  stagger: 0.045,
  margin: "0px 0px -8% 0px",
};

/** Rolling digits: a dramatic first roll, quiet live updates. */
export const DIGITS = {
  mountMs: 600,
  spreadMs: 200,
  mountEase: "cubic-bezier(0.16, 1, 0.3, 1)",
  updateMs: 150,
  updateEase: "cubic-bezier(0.33, 1, 0.68, 1)",
};
