import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

const SITE = "https://telltale.markets";

/** The market's live grade badge, with HTML and Markdown snippets to paste elsewhere. */
export function EmbedBadge({ coin }: { coin: string }) {
  const path = encodeURIComponent(coin);
  const page = `${SITE}/markets/${path}`;
  const image = `${SITE}/api/badge/${path}.svg`;
  const alt = `Telltale grade for ${coin}`;
  return (
    <section aria-labelledby="embed-title" className="max-w-3xl space-y-4">
      <div>
        <h2 id="embed-title" className="text-lg font-semibold">
          Embed this grade
        </h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          A badge that follows the live grade, for an exchange's market page, a vault's docs or a README. It links back here.{" "}
          <Link to="/developers" className="link">
            The API
          </Link>{" "}
          has the numbers behind it.
        </p>
      </div>
      <img src={`/api/badge/${path}.svg`} alt={alt} height={20} className="h-5 w-auto" />
      <Snippet label="HTML" code={`<a href="${page}"><img src="${image}" alt="${alt}" height="20"></a>`} />
      <Snippet label="Markdown" code={`[![${alt}](${image})](${page})`} />
    </section>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      // No clipboard access (an insecure page or a denied permission): select it for the viewer.
      const range = document.createRange();
      range.selectNodeContents(pre.current!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      setState("selected");
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b py-1 pr-1 pl-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="ml-auto flex items-center gap-1">
          <span role="status" className={`text-xs text-muted-foreground ${state === "copied" ? "sr-only" : ""}`}>
            {state === "copied" ? `${label} snippet copied` : state === "selected" ? "Selected: press Ctrl+C or ⌘C to copy" : ""}
          </span>
          <button type="button" onClick={copy} className="btn-icon" aria-label={`Copy the ${label} snippet`}>
            {state === "copied" ? <Check aria-hidden="true" className="size-4 text-primary" /> : <Copy aria-hidden="true" className="size-4" />}
          </button>
        </span>
      </div>
      <pre ref={pre} className="px-4 py-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}
