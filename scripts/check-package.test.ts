// The package checks fail on the defects they exist to catch, on small trees written here, so that
// a check that stops looking fails this test rather than passing every build.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { packageProblems } from "./check-package.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A package tree with these files; `package.json` is written from `manifest`. */
function tree(manifest: Record<string, unknown>, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ichnaea-check-package-"));
  roots.push(root);
  const all = { "package.json": `${JSON.stringify(manifest, null, 2)}\n`, ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const good = {
  name: "check-package-fixture",
  version: "0.0.0",
  type: "module",
  exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
};
const sources = {
  "dist/index.js": "export const x = 1;\n",
  "dist/index.d.ts": "export declare const x: number;\n",
};

describe("the package checks", () => {
  it("pass an ESM package whose exports point at its files", () => {
    expect(packageProblems(tree(good, sources))).toEqual([]);
  });

  it("fail an export whose target is missing", () => {
    const problems = packageProblems(tree(good, { "dist/index.js": sources["dist/index.js"] }));
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/^publint/)]));
  });

  it("fail CommonJS declarations for ESM JavaScript", () => {
    const masquerading = {
      ...good,
      exports: { ".": { types: "./dist/index.d.cts", default: "./dist/index.js" } },
    };
    const problems = packageProblems(
      tree(masquerading, {
        "dist/index.js": sources["dist/index.js"],
        "dist/index.d.cts": sources["dist/index.d.ts"],
      }),
    );
    expect(problems).toEqual([expect.stringMatching(/^attw failed/)]);
  });
});
