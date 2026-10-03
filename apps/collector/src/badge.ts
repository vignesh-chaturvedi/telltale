import { GRADE_NAMES, type Grade } from "@telltale/detectors";

// An embeddable SVG badge with a market's live grade, for exchanges, vaults and dashboards to
// show next to a market. It always uses the dark logo tile, so it reads the same on light and
// dark pages; the grade colors are the dark theme's (brand.md), which pass AA on that tile.

const TILE = "#061415";
const TEXT = "#EBF4F4";
const MUTED = "#91A2A3";
const GRADE_HEX: Record<Grade, string> = { A: "#68CA80", B: "#ACCB73", C: "#E8C35A", D: "#F1944F", E: "#EF6661" };

// Verdana at 11px, the usual badge font. Widths only need to be close: textLength makes every
// renderer fit the text to them.
const WIDTHS: Record<string, number> = {
  " ": 3.9, ".": 4.4, ":": 4.4, "-": 4.6, i: 3.1, l: 3.1, j: 3.4, f: 3.9, t: 4.3, r: 4.7, I: 4.2,
  m: 10.7, w: 9, M: 9.9, W: 11.1, S: 7.6, T: 6.8, B: 7.6, D: 8.4, E: 6.9, C: 7.7, A: 7.5,
};
const textWidth = (s: string) => [...s].reduce((w, c) => w + (WIDTHS[c] ?? (c >= "A" && c <= "Z" ? 7.6 : 6.6)), 0);

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type BadgeState = { kind: "graded"; grade: Grade } | { kind: "ungraded" } | { kind: "unknown" };

export function badgeSvg(coin: string, state: BadgeState): string {
  const parts: { text: string; color: string; bold?: boolean }[] =
    state.kind === "graded"
      ? [
          { text: state.grade, color: GRADE_HEX[state.grade], bold: true },
          { text: GRADE_NAMES[state.grade], color: TEXT },
        ]
      : [{ text: state.kind === "ungraded" ? "not graded" : "unknown market", color: MUTED }];
  const label =
    state.kind === "graded"
      ? `Telltale grade for ${coin}: ${state.grade}, ${GRADE_NAMES[state.grade]}`
      : state.kind === "ungraded"
        ? `Telltale hasn't graded ${coin} yet`
        : `Telltale doesn't know a market named ${coin}`;

  const pad = 7;
  const nameX = 21;
  const divider = Math.round(nameX + textWidth("Telltale") + pad);
  let x = divider + pad;
  const runs = parts.map((p, i) => {
    const w = textWidth(p.text) + (p.bold ? 0.8 : 0);
    const run = `<text x="${x.toFixed(1)}" y="14" fill="${p.color}"${p.bold ? ' font-weight="bold"' : ""} textLength="${w.toFixed(1)}">${escape(p.text)}</text>`;
    x += w + (i < parts.length - 1 ? 4 : 0);
    return run;
  });
  const width = Math.round(x + pad);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-label="${escape(label)}">`,
    `<title>${escape(label)}</title>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="19" rx="3.5" fill="${TILE}" stroke="${TEXT}" stroke-opacity="0.15"/>`,
    `<g transform="translate(3 3) scale(0.035)" fill="none" stroke-linecap="round">`,
    `<line x1="112" y1="96" x2="112" y2="304" stroke="${TEXT}" stroke-opacity="0.55" stroke-width="18"/>`,
    `<path d="M112 162 C 152 142, 186 182, 228 166 C 256 156, 280 150, 302 154" stroke="#00C5C6" stroke-width="36"/>`,
    `<path d="M112 238 C 148 220, 178 254, 214 242 C 238 234, 258 230, 276 233" stroke="#76E2E2" stroke-width="36"/>`,
    `</g>`,
    `<line x1="${divider}" y1="4" x2="${divider}" y2="16" stroke="${TEXT}" stroke-opacity="0.2"/>`,
    `<g font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" text-rendering="geometricPrecision">`,
    `<text x="${nameX}" y="14" fill="${TEXT}" textLength="${textWidth("Telltale").toFixed(1)}">Telltale</text>`,
    ...runs,
    `</g>`,
    `</svg>`,
  ].join("");
}
