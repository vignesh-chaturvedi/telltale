import { useRef, type ClipboardEvent } from "react";
import type { Formatted } from "../lib/format.ts";

/**
 * A formatted number. Tabular figures so live values don't jitter, the full-precision value on
 * copy ($1.2K copies as 1234.5), and a spoken form for screen readers when the display is
 * abbreviated or uses zero-subscript.
 */
export function Num({ value, className = "" }: { value: Formatted; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const onCopy = (e: ClipboardEvent<HTMLSpanElement>) => {
    const selection = window.getSelection();
    const el = ref.current;
    // Only when the selection is this number alone; a copied table row keeps its display text.
    if (!value.raw || !el || !selection || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) return;
    e.clipboardData.setData("text/plain", value.raw);
    e.preventDefault();
  };
  const spoken = value.ariaLabel !== value.display;
  return (
    <span ref={ref} onCopy={onCopy} className={`font-mono tabular-nums ${className}`} title={value.raw || undefined}>
      {spoken ? (
        <>
          <span aria-hidden="true">{value.display}</span>
          <span className="sr-only">{value.ariaLabel}</span>
        </>
      ) : (
        value.display
      )}
    </span>
  );
}
