// The docs site's Markdown twin of a page: plain Markdown that a reader can use without the site.
import { describe, expect, it } from "vitest";

import { markdownTwin } from "../docs/site/src/markdown-twin.ts";

describe("Markdown twin", () => {
  it("turns a titled card into a paragraph that starts with its title, and drops the wrapper tags", () => {
    const body =
      'import { Card, CardGrid } from "x";\n\n<CardGrid>\n  <Card title="Regression">\n    Worse on these cases.\n  </Card>\n</CardGrid>';
    expect(markdownTwin(body)).toBe("**Regression.** Worse on these cases.");
  });

  it("drops a multiline import and MDX comments", () => {
    const body = 'import {\n  Code,\n} from "x";\n\n{/* TODO: a note */}\nText.';
    expect(markdownTwin(body)).toBe("Text.");
  });

  it("leaves fenced code untouched, even an import, a tag or a comment in it", () => {
    const body =
      'Use it:\n\n```ts\nimport { compare } from "@tumaet/ichnaea";\n<Card title="x">\n{/* kept */}\n<Tag />\n```\n\nDone.';
    expect(markdownTwin(body)).toBe(body);
  });

  it("keeps a card's title when the card holds fenced code, and the code unchanged", () => {
    const body =
      '<Card title="Export">\n  Run this:\n\n  ```sh\n  pnpm export\n  ```\n</Card>\n\nAfter.';
    expect(markdownTwin(body)).toBe(
      "**Export.**\n  Run this:\n\n  ```sh\n  pnpm export\n  ```\n\nAfter.",
    );
  });

  it("replaces an interactive component with a sentence that sends the reader to the page", () => {
    expect(markdownTwin("Before.\n\n<PlanningExplorer />\n\nAfter.")).toBe(
      "Before.\n\nThis part of the page is interactive. Open the page to use it.\n\nAfter.",
    );
  });
});
