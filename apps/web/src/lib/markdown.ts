import { Marked } from "marked";

// The docs live in docs/ so they're readable on GitHub too; the site renders the same files.
// They're our own content, so rendering them as HTML is safe.
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

/**
 * Markdown to HTML. Wide tables and code blocks scroll inside their own box instead of the page,
 * and take keyboard focus so they can be scrolled without a mouse.
 */
export function renderMarkdown(source: string): string {
  return (marked.parse(source) as string)
    .replaceAll("<table>", '<div class="table-scroll" tabindex="0"><table>')
    .replaceAll("</table>", "</table></div>")
    .replaceAll("<pre>", '<pre tabindex="0">');
}
