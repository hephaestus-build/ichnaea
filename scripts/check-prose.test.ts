import { describe, expect, it } from "vitest";

import { checkProse, proseBlocks, sentences, wordCount } from "./check-prose.ts";

const problems = (source: string): string[] => checkProse("a.mdx", source).map((f) => f.problem);
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("prose check", () => {
  it.each([
    ["a selling word", "Ichnaea is a powerful tool."],
    ["a word that says it is easy", "Simply run the command."],
    ["a guarantee", "This guarantees a correct verdict."],
    ["significance without an effect", "The change is statistically significant."],
    ["a negative contraction", "It doesn't send data."],
    ["a semicolon", "It runs locally; it sends nothing."],
    ["an exclamation mark", "It works!"],
  ])("fails on %s", (_, line) => {
    expect(problems(line)).toHaveLength(1);
  });

  it("fails on a sentence of 26 words and passes one of 25", () => {
    expect(problems(`${words(26)}.`)).toEqual(["26 words in a sentence (limit 25)"]);
    expect(problems(`${words(25)}.`)).toEqual([]);
  });

  it("gives a list item the lower limit of 20 words", () => {
    expect(problems(`- ${words(21)}.`)).toEqual(["21 words in a sentence (limit 20)"]);
    expect(problems(`- ${words(20)}.`)).toEqual([]);
  });

  it("joins the lines of a paragraph before it counts", () => {
    expect(problems(`${words(13)}\n${words(13)}.`)).toEqual(["26 words in a sentence (limit 25)"]);
  });

  it("skips front matter, code, imports and tags", () => {
    const source = [
      "---",
      "title: A powerful title; with a semicolon!",
      "---",
      'import { Card } from "x";',
      "```sh",
      "<!-- not a comment inside code",
      "echo just do it; really!",
      "```",
      "<!-- A comment; with a semicolon",
      "and a second line! -->",
      '<Card title="REGRESSION">',
      "</Card>",
    ].join("\n");
    expect(problems(source)).toEqual([]);
  });

  it("reads prose again after a code block that holds a comment marker", () => {
    expect(problems("```html\n<!-- markup\n```\n\nSimply run it.")).toEqual([
      "a word that tells the reader it is easy",
    ]);
    expect(problems("<!-- a comment\nthat spans lines -->\n\nSimply run it.")).toHaveLength(1);
  });

  it("closes a fence only on a line that holds the marker and nothing else", () => {
    expect(problems("~~~text\n~~~not-a-close\n~~~\n\nSimply run it.")).toEqual([
      "a word that tells the reader it is easy",
    ]);
  });

  it("skips MDX comments, on one line or several, and inside a sentence", () => {
    expect(problems("{/* Keep this note; it is not rendered. */}")).toEqual([]);
    expect(problems("{/* A note\nthat spans lines; really */}\n\nSimply run it.")).toHaveLength(1);
    expect(problems("It runs {/* note; hidden */} locally.")).toEqual([]);
  });

  it("reads the text after an MDX comment's end on the same line as prose", () => {
    expect(problems("{/* note */} Simply run it.")).toEqual([
      "a word that tells the reader it is easy",
    ]);
    expect(problems("{/* a note\nthat spans lines */} Simply run it.")).toEqual([
      "a word that tells the reader it is easy",
    ]);
  });

  it("skips a whole multiline import or export", () => {
    expect(problems('import {\n  Card,\n  CardGrid,\n} from "x";\n\nIt runs locally.')).toEqual([]);
    expect(problems("export const meta = {\n  title: 'a; b',\n};\n\nSimply run it.")).toHaveLength(
      1,
    );
  });

  it("ends an import or export without a semicolon at the next blank line, as MDX does", () => {
    expect(problems("export const meta = {}\n\nSimply run it.")).toEqual([
      "a word that tells the reader it is easy",
    ]);
    expect(problems('import "./styles.css"\n\nSimply run it.')).toEqual([
      "a word that tells the reader it is easy",
    ]);
  });

  it("counts a code span as one word and keeps the text of a link", () => {
    const [block] = proseBlocks("Run `pnpm exec ichnaea compare plan.json results.jsonl` now.");
    expect(wordCount(block?.text ?? "")).toBe(3);
    expect(proseBlocks("Read [the validation page](https://x.test/a.md).")[0]?.text).toBe(
      "Read the validation page.",
    );
  });

  it("checks the words of a heading and a table cell, but not their length", () => {
    expect(problems(`## ${words(30)}`)).toEqual([]);
    expect(problems("| A | It is seamless |")).toEqual(["a word that sells instead of informs"]);
    expect(problems("| --- | :-: |")).toEqual([]);
  });

  it("splits sentences at a full stop, but not inside a version or a number", () => {
    expect(sentences("Ichnaea is 0.x. It needs Node 24.3 or later.")).toEqual([
      "Ichnaea is 0.x.",
      "It needs Node 24.3 or later.",
    ]);
  });

  it("names the file and the line", () => {
    expect(checkProse("docs/a.md", "Fine.\n\nIt's just fine.")).toEqual([
      {
        path: "docs/a.md",
        line: 3,
        problem: "a word that tells the reader it is easy",
        text: "It's just fine.",
      },
    ]);
  });
});
