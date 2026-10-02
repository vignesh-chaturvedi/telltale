// What a replay produces: one JSON file per incident, which the website draws. Type-only.
import type { AlertKind, Severity } from "@telltale/detectors";
import type { BookArchive } from "./incidents.ts";

export interface ReplayAlert {
  kind: AlertKind;
  severity: Severity;
  startedAt: number;
  resolvedAt: number | null;
  minutes: number;
  /** The alert at its worst moment, as the live site would show it. */
  title: string;
  detail: string;
  evidence: Record<string, number | string | null>;
  /** The alert when it first fired: what triggered it. */
  first: { title: string; detail: string; evidence: Record<string, number | string | null> };
}

/** One line per replay, for the list page (`index.json`). */
export interface ReplaySummary {
  id: string;
  name: string;
  date: string;
  lossUsd: number;
  crashAt: number;
  leadMinutes: number | null;
  firstWarning: string | null;
}

export interface ReplayResult {
  id: string;
  coin: string;
  name: string;
  date: string;
  summary: string;
  sources: { label: string; url: string }[];
  lossUsd: number;
  books: BookArchive;
  from: number;
  to: number;
  /** Start of the steepest one-minute fall in the mark price. */
  crashAt: number;
  crashMovePct: number;
  /** The first warning or critical alert before the crash, if any. */
  firstWarning: ReplayAlert | null;
  /** Minutes from that warning to the crash; `null` when nothing warned in time. */
  leadMinutes: number | null;
  minutes: { t: number; mark: number; oracle: number; oiUsd: number; depth2Usd: number | null }[];
  liquidations: { t: number; usd: number; backstopUsd: number }[];
  alerts: ReplayAlert[];
  /**
   * When the open-interest surge alert would first have fired if the full book held this many
   * times the depth the archive shows. The archive shows only the 20 best levels a side.
   */
  depthSensitivity: { multiple: number; firstAt: number | null; leadMinutes: number | null }[];
  pulledWalls: { side: string; px: number; peakUsd: number; sideDepthUsd: number; firstSeen: number; at: number; typicalUsd: number | null }[];
  /** What the archives can't show, in plain words. */
  limits: string[];
  generatedAt: number;
}
