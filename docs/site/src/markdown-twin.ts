// Turns a page's MDX source into plain Markdown for its `.md` twin. A Markdown reader cannot run
// components, so a titled card becomes a paragraph that starts with its title in bold, wrapper
// tags go, and an interactive part becomes a sentence that sends the reader to the page. Imports
// and MDX comments render nothing on the page, so the twin leaves them out too. Fenced code blocks
// are examples, so they pass through unchanged, even when they hold an import or a tag.
export function markdownTwin(body: string): string {
  return splitFences(body)
    .map((part) => (part.code ? part.text : convert(part.text)))
    .join("")
    .replace(/^\n+|\s+$/g, "");
}

function convert(text: string): string {
  return (
    text
      .replace(/^import\s[\s\S]*?(?:;|from\s*["'][^"']*["'])[ \t]*$\n?/gm, "")
      .replace(/^[ \t]*\{\/\*[\s\S]*?\*\/\}[ \t]*\n?/gm, "")
      .replace(
        /^[ \t]*<([A-Z][\w.]*)\s[^>]*\btitle="([^"]+)"[^>]*>\n([\s\S]*?)\n[ \t]*<\/\1>[ \t]*$/gm,
        (_, _tag: string, title: string, content: string) =>
          `\n**${title}.** ${content
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .join(" ")}\n`,
      )
      // A card that holds fenced code has its tags in two parts, around the code, so the paired rule
      // above cannot see both. Its opening tag still gives the title.
      .replace(
        /^[ \t]*<[A-Z][\w.]*\s[^>]*\btitle="([^"]+)"[^>]*(?<!\/)>[ \t]*$/gm,
        (_, title: string) => `**${title}.**`,
      )
      .replace(
        /^[ \t]*<[A-Z][\w.]*[^>]*\/>[ \t]*$/gm,
        "This part of the page is interactive. Open the page to use it.",
      )
      .replace(/^[ \t]*<\/?[A-Z][\w.]*[^>]*>[ \t]*\n?/gm, "")
      .replace(/\n{3,}/g, "\n\n")
  );
}

/**
 * Splits text into fenced code blocks and the text between them. A fence closes on a line that
 * holds only its marker character, at least as many times, as in CommonMark.
 */
function splitFences(text: string): Array<{ readonly code: boolean; readonly text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  let fence: string | undefined;
  let current = "";
  for (const line of text.split(/(?<=\n)/)) {
    const trimmed = line.trim();
    if (fence === undefined) {
      const open = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
      if (open !== undefined) {
        parts.push({ code: false, text: current });
        current = line;
        fence = open;
      } else current += line;
    } else {
      current += line;
      const close = /^(`+|~+)$/.exec(trimmed)?.[1];
      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) {
        parts.push({ code: true, text: current });
        current = "";
        fence = undefined;
      }
    }
  }
  parts.push({ code: fence !== undefined, text: current });
  return parts;
}
