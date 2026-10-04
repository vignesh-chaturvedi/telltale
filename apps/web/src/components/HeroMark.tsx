import { useReducedMotion, type MotionValue } from "motion/react";
import * as m from "motion/react-m";
import { lazy, Suspense, useMemo } from "react";

// The hero's centrepiece: the Telltale mark struck in liquid metal on its dark tile, inside a band of
// guilloche (the fine interlaced lines engraved on banknotes and certificates). The shader is loaded
// separately, so the board never waits for it; until it arrives, or without WebGL, the flat mark shows.
const LiquidMetal = lazy(() => import("@paper-design/shaders-react").then((m) => ({ default: m.LiquidMetal })));

const TAU = Math.PI * 2;

/** One closed curve r(θ) = R + A·sin(nθ + φ), as an SVG path. */
function wave(R: number, A: number, n: number, phase: number, steps = 360): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * TAU, r = R + A * Math.sin(n * th + phase);
    d += `${i ? "L" : "M"}${(r * Math.cos(th)).toFixed(2)} ${(r * Math.sin(th)).toFixed(2)}`;
  }
  return d + "Z";
}

// Two interlaced bands and a fan of fine spokes, generated once.
const INNER = Array.from({ length: 16 }, (_, k) => wave(176, 9, 30, (k / 16) * TAU));
const OUTER = Array.from({ length: 12 }, (_, k) => wave(250, 16, 44, (k / 12) * TAU));
const SPOKES = Array.from({ length: 144 }, (_, k) => {
  const th = (k / 144) * TAU, r0 = 196, r1 = k % 3 === 0 ? 300 : 272;
  return `M${(r0 * Math.cos(th)).toFixed(1)} ${(r0 * Math.sin(th)).toFixed(1)}L${(r1 * Math.cos(th)).toFixed(1)} ${(r1 * Math.sin(th)).toFixed(1)}`;
});
// a few short red marks on the outer band: the one thing in the frame that says "warning"
const MARKS = [0.07, 0.19, 0.31, 0.52, 0.66, 0.83, 0.94].map((u, k) => {
  const th = u * TAU, r = 250 + (k % 2 ? 14 : -10);
  return { x: r * Math.cos(th), y: r * Math.sin(th), rot: (th * 180) / Math.PI };
});

function hasWebGL(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function FlatMark() {
  return (
    <svg viewBox="70 70 260 260" className="size-full" aria-hidden="true">
      <g fill="none" strokeLinecap="round">
        <line x1="112" y1="96" x2="112" y2="304" stroke="#EBF4F4" strokeOpacity="0.55" strokeWidth="18" />
        <path d="M112 162 C 152 142, 186 182, 228 166 C 256 156, 280 150, 302 154" stroke="#00C5C6" strokeWidth="36" className="ribbon-flutter" />
        <path d="M112 238 C 148 220, 178 254, 214 242 C 238 234, 258 230, 276 233" stroke="#76E2E2" strokeWidth="36" className="ribbon-flutter ribbon-flutter-late" />
      </g>
    </svg>
  );
}

/** `ringRotate`: the engraved rings turn with the page's scroll (degrees), set by the hero. */
export function HeroMark({ className = "", ringRotate }: { className?: string; ringRotate?: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const webgl = useMemo(hasWebGL, []);
  return (
    <div className={`relative aspect-square ${className}`} role="img" aria-label="The Telltale mark: two ribbons on a stay, the way sailors read the wind">
      <m.svg viewBox="-320 -320 640 640" className="absolute inset-0 size-full" aria-hidden="true" style={ringRotate ? { rotate: ringRotate } : undefined}>
        <g fill="none" strokeWidth="0.7" className="text-band-accent" stroke="currentColor">
          <g opacity="0.22">{OUTER.map((d, i) => <path key={i} d={d} />)}</g>
          <g opacity="0.16">{SPOKES.map((d, i) => <path key={i} d={d} />)}</g>
          <g opacity="0.3">{INNER.map((d, i) => <path key={i} d={d} />)}</g>
        </g>
        <g className="text-signal" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.85">
          {MARKS.map((m, i) => (
            <path key={i} d="M-5 0H5" transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)}) rotate(${(m.rot + 90).toFixed(1)})`} />
          ))}
        </g>
      </m.svg>
      {/* the tile: the brand's dark logo tile in both themes, a little raised off the ground */}
      <div className="absolute top-1/2 left-1/2 aspect-square w-[44%] -translate-1/2 rounded-[22%] border border-white/10 bg-[radial-gradient(120%_120%_at_30%_20%,#1d2b2c_0%,#081011_70%)] shadow-[0_30px_70px_-24px_rgba(6,20,21,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] dark:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="absolute inset-[14%]">
          {webgl ? (
            <Suspense fallback={<FlatMark />}>
              <LiquidMetal
                image="/telltale-mark-mask.svg"
                colorBack="#00000000"
                colorTint="#9fe9e9"
                repetition={3}
                softness={0.2}
                shiftRed={0.25}
                shiftBlue={0.25}
                distortion={0.08}
                contour={0.45}
                angle={70}
                speed={reduce ? 0 : 0.6}
                scale={1}
                fit="contain"
                style={{ width: "100%", height: "100%" }}
              />
            </Suspense>
          ) : (
            <FlatMark />
          )}
        </div>
      </div>
    </div>
  );
}
