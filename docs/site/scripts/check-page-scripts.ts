// Every prose page ships only the site's own navigation, theme and search scripts: no UI framework
// runtime, no Ichnaea code, and under 20 kB of script in all (REQ-132). Interactive pages, such as
// the planning explorer, run Ichnaea in the browser and are exempt.
//
// For each built page it adds up the inline scripts, the external scripts, their static imports and
// the workers they start. A dynamic import, such as the search UI that loads when search opens, is
// not counted: the page does not load it until it is used. The code is recognised by strings that
// survive minification.
//
// Usage: node scripts/check-page-scripts.ts [dist directory]. The base path comes from DOCS_URL, as in
// astro.config.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";

import { fromHtml } from "hast-util-from-html";
import { selectAll } from "hast-util-select";

export const BUDGET_BYTES = 20 * 1024;

/** Pages that may run Ichnaea in the browser, by their path under the base. */
export const INTERACTIVE = [/^planner\//, /^playground\//, /^demo\//];

/** Strings that only a UI framework runtime contains. */
const FRAMEWORK = [
  ["React", /__REACT_DEVTOOLS_GLOBAL_HOOK__|react-dom|__SECRET_INTERNALS_DO_NOT_USE/],
  ["Preact", /__PREACT_DEVTOOLS__|preact\/hooks/],
  ["Vue", /__VUE_OPTIONS_API__|__VUE_PROD_DEVTOOLS__/],
  ["Svelte", /svelte\/internal|__svelte/],
  ["Solid", /solid-js\/web|_\$HY/],
] as const;

/** Strings that only Ichnaea's code contains: its generator and its record and estimand names. */
const ICHNAEA = /mt19937|fixed-cases|ichnaea\.(case|plan|decision|trial)\/\d/;

export interface PageReport {
  readonly page: string;
  readonly bytes: number;
  readonly problems: readonly string[];
}

/** The scripts a page loads at once: inline scripts, and files with their static imports and workers. */
export function pageScripts(
  html: string,
  read: (path: string) => string | undefined,
  base: string,
): { inline: string[]; files: Map<string, string> } {
  const inline: string[] = [];
  const pending: string[] = [];
  // The page is parsed as a browser parses it, so a script is found in any letter case, with any
  // attributes and quoting, and with any end tag the HTML standard accepts. A regular expression
  // misses some of these, and a missed script would escape the budget.
  for (const script of selectAll("script", fromHtml(html))) {
    const src = script.properties["src"];
    const type = String(script.properties["type"] ?? "");
    if (typeof src === "string" && src !== "") pending.push(src);
    else if (!/^application\/(ld\+)?json$/i.test(type))
      inline.push(script.children.map((c) => (c.type === "text" ? c.value : "")).join(""));
  }
  for (const code of inline) pending.push(...references(code));
  const files = new Map<string, string>();
  while (pending.length > 0) {
    const url = pending.pop() ?? "";
    const path = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
    if (files.has(path)) continue;
    const code = read(path);
    if (code === undefined) continue;
    files.set(path, code);
    for (const ref of references(code))
      pending.push(ref.startsWith("/") ? ref : posix.join(posix.dirname(`/${path}`), ref));
  }
  return { inline, files };
}

/** The static imports and worker scripts that a piece of code loads. */
function references(code: string): string[] {
  const refs: string[] = [];
  for (const match of code.matchAll(
    /(?:^|[;}\s])import\s*(?:[\w${},*\s]+from\s*)?["']([^"']+\.js)["']/g,
  ))
    refs.push(match[1] ?? "");
  for (const match of code.matchAll(/new Worker\(\s*new URL\(\s*[`"']([^`"']+\.js)[`"']/g))
    refs.push(match[1] ?? "");
  return refs.filter(Boolean);
}

/** Checks one page against the budget and the forbidden code. */
export function checkPage(
  page: string,
  html: string,
  read: (path: string) => string | undefined,
  base: string,
): PageReport {
  const { inline, files } = pageScripts(html, read, base);
  const code = [...inline, ...files.values()];
  const bytes = code.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  if (INTERACTIVE.some((pattern) => pattern.test(page))) return { page, bytes, problems: [] };
  const problems: string[] = [];
  if (bytes > BUDGET_BYTES)
    problems.push(`${bytes} bytes of script, over the ${BUDGET_BYTES}-byte budget`);
  for (const [name, pattern] of FRAMEWORK)
    if (code.some((text) => pattern.test(text))) problems.push(`loads the ${name} runtime`);
  if (code.some((text) => ICHNAEA.test(text))) problems.push("loads Ichnaea code");
  return { page, bytes, problems };
}

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".html"),
  );
}

if (import.meta.main) {
  const dist = process.argv[2] ?? "dist";
  const base = new URL(process.env.DOCS_URL ?? "https://hephaestus-build.github.io/ichnaea/")
    .pathname;
  const read = (path: string): string | undefined => {
    const file = join(dist, path);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };
  const reports = htmlFiles(dist).map((file) =>
    checkPage(
      relative(dist, join(dist, file)).split("\\").join("/"),
      readFileSync(join(dist, file), "utf8"),
      read,
      base,
    ),
  );
  const failed = reports.filter((report) => report.problems.length > 0);
  if (failed.length > 0) {
    console.error(
      `page scripts:\n${failed.map((r) => `${r.page}: ${r.problems.join("; ")}`).join("\n")}`,
    );
    process.exit(1);
  }
  const largest = reports
    .filter((r) => !INTERACTIVE.some((p) => p.test(r.page)))
    .toSorted((a, b) => b.bytes - a.bytes)[0];
  console.log(
    `page scripts: ${reports.length} pages clean; the largest prose page loads ${largest?.bytes ?? 0} bytes (${largest?.page ?? "none"})`,
  );
}
