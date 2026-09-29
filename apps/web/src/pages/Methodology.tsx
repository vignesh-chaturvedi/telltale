import { Marked } from "marked";
import { useEffect } from "react";
import source from "../../../../docs/methodology.md?raw";

// The methodology lives in docs/ so it's readable on GitHub too; this page renders the same file.
// It's our own content, so rendering it as HTML is safe.
const marked = new Marked({ gfm: true, async: false });
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = text
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/&[a-z0-9#]+;/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
  },
});
// Wide tables scroll inside their own box instead of the page.
const html = (marked.parse(source) as string).replaceAll("<table>", '<div class="table-scroll"><table>').replaceAll("</table>", "</table></div>");

export function Methodology() {
  useEffect(() => {
    document.title = "Methodology · Telltale";
  }, []);
  return <article className="prose max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />;
}
