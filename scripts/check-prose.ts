// The user docs speak in one plain voice and make no claim they cannot back. This check covers the
// prose of the docs site: sentence length, words that sell instead of inform, negative
// contractions, semicolons and exclamation marks. Code, front matter, imports and markup are not
// prose and are skipped. A green check does not prove plain writing: reviewers still read for
// meaning, and for a claim with no evidence or link.
//
// `node scripts/check-prose.ts` checks the docs site. `node scripts/check-prose.ts <file>…` checks
// the named files.
import { readFileSync } from "node:fs";

import { trackedFiles } from "./tracked-files.ts";

/** The longest sentence in words; a list item or a step has a lower limit. */
export const SENTENCE_WORDS = 25;
export const LIST_ITEM_WORDS = 20;

/** Words that claim quality instead of stating a fact, and plain words for direction. */
export const THEATRE: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b(powerful|seamless(ly)?|robust|state[- ]of[- ]the[- ]art|cutting[- ]edge|best[- ]in[- ]class|world[- ]class|blazing(ly)?|effortless(ly)?|revolutionary|game[- ]chang\w*|leading)\b/i,
    "a word that sells instead of informs",
  ],
  [/\b(simply|just|easy|easily|obviously|of course)\b/i, "a word that tells the reader it is easy"],
  [/\bguarantee[sd]?\b/i, "a guarantee: state the evidence instead"],
  [/\bstatistically significant\b/i, "'statistically significant': give the change and its bound"],
];

const NEGATIVE_CONTRACTION = /\b\w+n['’]t\b/i;

/** One finding as `path:line: problem: text`. */
export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly problem: string;
  readonly text: string;
}

interface ProseBlock {
  readonly line: number;
  readonly text: string;
  readonly listItem: boolean;
  /** A heading or a table cell is a label, not a sentence: only its words are checked. */
  readonly label: boolean;
}

/** Splits Markdown or MDX into prose blocks, with code, front matter, imports and tags removed. */
export function proseBlocks(source: string): ProseBlock[] {
  const lines = source.split("\n");
  const blocks: ProseBlock[] = [];
  let paragraph: { line: number; parts: string[]; listItem: boolean } | undefined;
  let fence: string | undefined;
  let comment = false;
  let mdxComment = false;
  let esm = false;
  let frontMatter = lines[0]?.trim() === "---";
  const flush = (): void => {
    if (paragraph)
      blocks.push({
        line: paragraph.line,
        text: paragraph.parts.join(" "),
        listItem: paragraph.listItem,
        label: false,
      });
    paragraph = undefined;
  };
  lines.forEach((raw, index) => {
    const line = index + 1;
    let trimmed = raw.trim();
    if (frontMatter) {
      if (index > 0 && trimmed === "---") frontMatter = false;
      return;
    }
    if (fence !== undefined) {
      // A closing fence is the opening character, at least as many times, and only whitespace.
      const close = /^(`+|~+)$/.exec(trimmed)?.[1];
      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length)
        fence = undefined;
      return;
    }
    // An MDX comment, `{/* … */}`, can span lines. The page does not render it, but it renders
    // the text after the comment's end on the same line, so that text is read as prose.
    if (mdxComment || trimmed.startsWith("{/*")) {
      flush();
      const end = trimmed.indexOf("*/}", mdxComment ? 0 : 3);
      mdxComment = end < 0;
      if (mdxComment) return;
      trimmed = trimmed.slice(end + 3).trim();
      if (trimmed === "") return;
    }
    // An import or export can span lines. It ends with a semicolon, with its `from "…"` clause or,
    // as MDX ends it, at the next blank line: `export const meta = {}` needs no semicolon.
    if (esm && trimmed === "") {
      esm = false;
      return;
    }
    if (esm || /^(import|export)\s/.test(trimmed)) {
      flush();
      esm = !/;\s*$|\bfrom\s*["'][^"']*["']\s*$/.test(trimmed);
      return;
    }
    // An HTML comment can span lines. It ends on the line that holds `-->`.
    if (comment || trimmed.startsWith("<!--")) {
      flush();
      comment = !trimmed.includes("-->");
      return;
    }
    const fenceMark = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fenceMark !== undefined) {
      flush();
      fence = fenceMark;
      return;
    }
    if (trimmed === "") {
      flush();
      return;
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      flush();
      blocks.push({ line, text: trimmed.replace(/^#+\s*/, ""), listItem: false, label: true });
      return;
    }
    if (trimmed.startsWith("|")) {
      flush();
      if (!/^\|[\s:|-]+\|$/.test(trimmed))
        for (const cell of trimmed.split("|").slice(1, -1))
          blocks.push({ line, text: cell.trim(), listItem: false, label: true });
      return;
    }
    const item = /^([-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (item) {
      flush();
      paragraph = { line, parts: [item[2] ?? ""], listItem: true };
      return;
    }
    if (paragraph) paragraph.parts.push(trimmed);
    else paragraph = { line, parts: [trimmed], listItem: false };
  });
  flush();
  return blocks.map((block) => ({ ...block, text: plain(block.text) })).filter((b) => b.text);
}

/** Replaces code spans with one word, keeps link text and drops tags and emphasis marks. */
function plain(text: string): string {
  return text
    .replace(/\{\/\*.*?\*\/\}/g, " ")
    .replace(/`[^`]*`/g, "CODE")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/[*_]{1,3}(?=\S)|(?<=\S)[*_]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sentences of a prose block. A sentence ends at `.`, `?` or `!` before a space or the end. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+(?=\S)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The words of a sentence: a code span, a number or a hyphenated word counts as one. */
export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Returns every finding in one Markdown or MDX text. */
export function checkProse(path: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const add = (line: number, problem: string, text: string): void => {
    findings.push({ path, line, problem, text: text.slice(0, 100) });
  };
  for (const block of proseBlocks(source)) {
    for (const [pattern, why] of THEATRE)
      if (pattern.test(block.text)) add(block.line, why, block.text);
    if (NEGATIVE_CONTRACTION.test(block.text))
      add(block.line, "a negative contraction: write it in full", block.text);
    if (block.label) continue;
    if (block.text.includes(";")) add(block.line, "a semicolon: write two sentences", block.text);
    if (/!(\s|$)/.test(block.text)) add(block.line, "an exclamation mark", block.text);
    const limit = block.listItem ? LIST_ITEM_WORDS : SENTENCE_WORDS;
    for (const sentence of sentences(block.text)) {
      const count = wordCount(sentence);
      if (count > limit) add(block.line, `${count} words in a sentence (limit ${limit})`, sentence);
    }
  }
  return findings;
}

/** The prose files of the docs site, from git, so that ignored and generated files are left out. */
function docsFiles(): string[] {
  return trackedFiles(["docs/site/src/content"]).filter((path) => /\.mdx?$/.test(path));
}

if (import.meta.main) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : docsFiles();
  const findings = files.flatMap((path) => checkProse(path, readFileSync(path, "utf8")));
  if (findings.length > 0) {
    const lines = findings.map((f) => `${f.path}:${f.line}: ${f.problem}: ${f.text}`);
    console.error(`Prose check failed (${findings.length}):\n${lines.join("\n")}`);
    process.exit(1);
  }
  console.log(`prose: ${files.length} files clean`);
}
