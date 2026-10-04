import { useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import * as m from "motion/react-m";
import { useRef } from "react";

/**
 * A statement that lights up word by word as it scrolls through the screen: each word goes from faint
 * to full as you read past it. The whole sentence is always there as text; with reduced motion it's
 * simply fully lit.
 */
export function ScrollWords({ id, text, accent, className = "" }: { id?: string; text: string; accent?: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.88", "end 0.42"] });
  const words: [string, boolean][] = [...text.split(" ").map((w): [string, boolean] => [w, false]), ...(accent ? accent.split(" ").map((w): [string, boolean] => [w, true]) : [])];
  return (
    <h2 ref={ref} id={id} className={`display ${className}`}>
      {words.map(([w, isAccent], i) => (
        <Word key={i} progress={scrollYProgress} from={i / words.length} to={(i + 1) / words.length} still={!!reduce} accent={isAccent} last={i === words.length - 1}>
          {w}
        </Word>
      ))}
    </h2>
  );
}

function Word({ progress, from, to, still, accent, last, children }: { progress: MotionValue<number>; from: number; to: number; still: boolean; accent: boolean; last: boolean; children: string }) {
  const opacity = useTransform(progress, [from, to], [0.16, 1]);
  return (
    <>
      <m.span style={still ? undefined : { opacity }} className={accent ? "text-primary" : undefined}>
        {children}
      </m.span>
      {last ? "" : " "}
    </>
  );
}
