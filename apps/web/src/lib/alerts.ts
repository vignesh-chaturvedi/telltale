import type { AlertKind, Severity } from "@telltale/detectors";

export const KIND_LABELS: Record<AlertKind, string> = {
  "mark-divergence": "Mark away from oracle",
  "stale-oracle": "Oracle unchanged",
  "peer-divergence": "Deployers disagree",
  "depth-collapse": "Depth collapse",
  "oi-surge": "Open-interest surge",
  "oi-cap": "Near open-interest cap",
  "pulled-wall": "Pulled wall",
  "deployer-change": "Deployer change",
};

export const SEVERITY_LABELS: Record<Severity, string> = { info: "Info", warning: "Warning", critical: "Critical" };

// Severity uses the destructive and neutral tokens, never the grade colors, which mean grades only.
export const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "border-transparent bg-destructive text-destructive-foreground",
  warning: "border-foreground/40 text-foreground",
  info: "border-border text-muted-foreground",
};
