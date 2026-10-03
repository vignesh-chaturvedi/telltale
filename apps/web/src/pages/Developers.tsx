import { useEffect } from "react";
import source from "../../../../docs/api.md?raw";
import { renderMarkdown } from "../lib/markdown.ts";

const html = renderMarkdown(source);

/** The API reference, rendered from docs/api.md. */
export function Developers() {
  useEffect(() => {
    document.title = "API · Telltale";
  }, []);
  return <article className="prose max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />;
}
