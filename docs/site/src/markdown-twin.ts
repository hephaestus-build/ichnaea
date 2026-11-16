// Turns a page's MDX source into plain Markdown for its `.md` twin. A Markdown reader cannot run
// components, so a titled card becomes a paragraph that starts with its title in bold, wrapper
// tags go, and an interactive part becomes a sentence that sends the reader to the page. Imports
// and MDX comments render nothing on the page, so the twin leaves them out too.
export function markdownTwin(body: string): string {
  return body
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
    .replace(
      /^[ \t]*<[A-Z][\w.]*[^>]*\/>[ \t]*$/gm,
      "This part of the page is interactive. Open the page to use it.",
    )
    .replace(/^[ \t]*<\/?[A-Z][\w.]*[^>]*>[ \t]*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
