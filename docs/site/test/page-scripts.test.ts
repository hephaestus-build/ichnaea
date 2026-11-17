import { describe, expect, it } from "vitest";

import { BUDGET_BYTES, checkPage } from "../scripts/check-page-scripts.ts";

const base = "/ichnaea/";
const page = (scripts: string): string => `<html><head>${scripts}</head><body></body></html>`;
const files =
  (entries: Record<string, string>) =>
  (path: string): string | undefined =>
    entries[path];

describe("page scripts", () => {
  it("finds a script in any letter case, with any attributes and end tag, as a browser does", () => {
    const html = page(
      [
        "<SCRIPT>upper()</SCRIPT>",
        "<ScRiPt data-x='1' defer>mixed()</sCrIpT >",
        "<script type=module src=/ichnaea/_astro/a.js></script>",
        "<script src='/ichnaea/_astro/b.js' type=\"module\"></script>",
        '<SCRIPT TYPE="APPLICATION/LD+JSON">{"not":"code"}</SCRIPT>',
      ].join(""),
    );
    const read = files({ "_astro/a.js": "aa", "_astro/b.js": "bbb" });
    const report = checkPage("guide/index.html", html, read, base);
    // The two inline scripts and both files count; the JSON data block does not.
    expect(report.bytes).toBe("upper()".length + "mixed()".length + 2 + 3);
  });

  it("refuses Ichnaea code in an upper-case inline script", () => {
    const html = page("<SCRIPT>const g = 'mt19937';</SCRIPT>");
    expect(checkPage("guide/index.html", html, files({}), base).problems).toContain(
      "loads Ichnaea code",
    );
  });

  it("passes a prose page that loads only small site scripts", () => {
    const html = page(
      `<script>theme()</script><script type="module" src="/ichnaea/_astro/nav.js"></script>`,
    );
    const report = checkPage("guide/index.html", html, files({ "_astro/nav.js": "menu()" }), base);
    expect(report.problems).toEqual([]);
    expect(report.bytes).toBe("theme()".length + "menu()".length);
  });

  it("follows static imports and counts them", () => {
    const html = page(`<script type="module" src="/ichnaea/_astro/a.js"></script>`);
    const read = files({
      "_astro/a.js": 'import{t}from"./b.js";t()',
      "_astro/b.js": "x".repeat(100),
    });
    expect(checkPage("p/index.html", html, read, base).bytes).toBe(25 + 100);
  });

  it("follows static re-exports, which the browser loads too", () => {
    const html = page(`<script type="module" src="/ichnaea/_astro/a.js"></script>`);
    const read = files({
      "_astro/a.js": 'export{t}from"./b.js";export*from"./c.js"',
      "_astro/b.js": 'const algorithm="mt19937"',
      "_astro/c.js": "x".repeat(BUDGET_BYTES),
    });
    const report = checkPage("p/index.html", html, read, base);
    expect(report.problems).toContain("loads Ichnaea code");
    expect(report.bytes).toBeGreaterThan(BUDGET_BYTES);
  });

  it("fails a page that loads a script the check cannot read", () => {
    const html = page(
      [
        `<script src="https://cdn.example/runtime.js"></script>`,
        `<script type="module" src="/ichnaea/_astro/a.js"></script>`,
      ].join(""),
    );
    const read = files({ "_astro/a.js": 'import"./gone.js"' });
    expect(checkPage("p/index.html", html, read, base).problems).toEqual([
      "loads /_astro/gone.js, which the check cannot read",
      "loads https://cdn.example/runtime.js, which the check cannot read",
    ]);
  });

  it("fails a page with a script that does not parse, since its imports are unknown", () => {
    const html = page("<script>if (broken) {</script>");
    expect(checkPage("p/index.html", html, files({}), base).problems).toEqual([
      "loads inline script 1, which the check cannot read",
    ]);
  });

  it("does not count a dynamic import, which loads only when used", () => {
    const html = page(`<script type="module" src="/ichnaea/_astro/a.js"></script>`);
    const read = files({
      "_astro/a.js": 'import("./search-ui.js")',
      "_astro/search-ui.js": "x".repeat(BUDGET_BYTES),
    });
    expect(checkPage("p/index.html", html, read, base).problems).toEqual([]);
  });

  it("fails a prose page over the budget", () => {
    const html = page(`<script>${"x".repeat(BUDGET_BYTES + 1)}</script>`);
    expect(checkPage("p/index.html", html, files({}), base).problems).toEqual([
      `${BUDGET_BYTES + 1} bytes of script, over the ${BUDGET_BYTES}-byte budget`,
    ]);
  });

  it("fails a prose page that loads Ichnaea code, also through a worker", () => {
    const html = page(
      `<script>new Worker(new URL("/ichnaea/_astro/worker.js", import.meta.url))</script>`,
    );
    const read = files({ "_astro/worker.js": 'const algorithm="mt19937"' });
    expect(checkPage("p/index.html", html, read, base).problems).toEqual(["loads Ichnaea code"]);
  });

  it("fails a prose page that loads a UI framework runtime", () => {
    const html = page(`<script type="module" src="/ichnaea/_astro/client.js"></script>`);
    const read = files({ "_astro/client.js": "window.__REACT_DEVTOOLS_GLOBAL_HOOK__" });
    expect(checkPage("p/index.html", html, read, base).problems).toEqual([
      "loads the React runtime",
    ]);
  });

  it("exempts an interactive page", () => {
    const html = page(`<script>${'"mt19937"'.repeat(5000)}</script>`);
    expect(checkPage("planner/index.html", html, files({}), base).problems).toEqual([]);
  });

  it("ignores structured data, which is not a script", () => {
    const html = page(
      `<script type="application/ld+json">${"x".repeat(BUDGET_BYTES + 1)}</script>`,
    );
    expect(checkPage("p/index.html", html, files({}), base).bytes).toBe(0);
  });
});
