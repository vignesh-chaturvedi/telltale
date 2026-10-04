import * as m from "motion/react-m";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { MASK, REVEAL } from "../lib/motion.ts";

/** The page's measure: every section lines up on the same grid. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** "• Methodology": the small label above a headline. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/**
 * The editorial headline: a light serif, with its last phrase in the accent colour, the way the
 * reference sets "Rewards follow the bal|ance." Pass the accented part separately.
 */
export function Headline({
  as: Tag = "h2",
  id,
  children,
  accent,
  className = "",
  onBand = false,
}: {
  as?: "h1" | "h2" | "h3" | "p";
  id?: string;
  children: ReactNode;
  accent?: ReactNode;
  className?: string;
  onBand?: boolean;
}) {
  const lead = typeof children === "string" ? children.split(" ").length : 0;
  return (
    <Tag id={id} className={`display ${className}`}>
      {typeof children === "string" ? <MaskWords text={children} /> : children}
      {accent && (
        <>
          {" "}
          <span className={onBand ? "text-band-accent" : "text-primary"}>{typeof accent === "string" ? <MaskWords text={accent} offset={lead} /> : accent}</span>
        </>
      )}
    </Tag>
  );
}

/**
 * Words rising from behind a mask as the headline scrolls into view, one after another. The text stays
 * plain text for screen readers; with reduced motion the words are simply there.
 */
function MaskWords({ text, offset = 0 }: { text: string; offset?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="-mb-[0.14em] inline-block overflow-hidden pb-[0.14em] align-bottom">
            <m.span
              className="inline-block"
              initial={{ y: "110%" }}
              whileInView={{ y: "0%" }}
              viewport={{ once: true, margin: MASK.margin }}
              transition={{ ...MASK.spring, delay: (offset + i) * MASK.stagger }}
            >
              {w}
            </m.span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </>
  );
}

/** The long arrow from the reference's buttons, drawn rather than typed so it lines up at any size. */
export function LongArrow({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 12" className={`arrow-lean h-3 w-7 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M0 6h26M21 1l5 5-5 5" strokeLinecap="square" />
    </svg>
  );
}

type Tone = "ink" | "cream" | "arrow";
const TONE: Record<Tone, string> = { ink: "btn-primary", cream: "btn-cream", arrow: "btn-arrow" };

/** A square button with a long arrow. Internal paths go through the router; anything else opens in place. */
export function ButtonLink({ to, children, tone = "ink", className = "" }: { to: string; children: ReactNode; tone?: Tone; className?: string }) {
  const cls = `${TONE[tone]} ${className}`;
  const body = (
    <>
      <span>{children}</span>
      <LongArrow />
    </>
  );
  if (to.startsWith("/") && !to.startsWith("//")) {
    return (
      <Link to={to} viewTransition className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <a href={to} className={cls} rel={to.startsWith("#") ? undefined : "noreferrer"}>
      {body}
    </a>
  );
}

/**
 * A section that rises a little as it scrolls into view, once. Subtle on purpose: it's for headlines and
 * cards, never for the board or text someone is reading. MotionConfig in App turns it off for reduced motion.
 */
export function Reveal({ children, className = "", delay = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" | "section" }) {
  const M = m[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y: REVEAL.offsetY }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: REVEAL.margin }}
      transition={{ ...REVEAL.spring, delay }}
    >
      {children}
    </M>
  );
}
