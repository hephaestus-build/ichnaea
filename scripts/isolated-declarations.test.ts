import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkIsolatedDeclarations, isolatedDeclarationProblems } from "./isolated-declarations.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repository with the package, `packages/ichnaea`, whose contracts hold the given source files. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "isolated-declarations-"));
  roots.push(root);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    "packages/ichnaea/tsconfig.json",
    JSON.stringify({
      compilerOptions: { target: "es2022", module: "esnext", noEmit: true, types: [] },
      include: ["src"],
    }),
  );
  for (const [path, text] of Object.entries(files))
    write(`packages/ichnaea/src/contracts/${path}`, text);
  return root;
}

const INFERRED = "export const list = [1, 2].map((n) => n + 1);\n";
const NO_RETURN_TYPE = "export function double(n: number) { return n * 2; }\n";

describe("the isolatedDeclarations check", () => {
  it("fails on an exported constant with an inferred type in a logic module", () => {
    const root = repository({ "walk.ts": INFERRED });
    expect(checkIsolatedDeclarations("packages/ichnaea", root)).toEqual([
      expect.stringContaining("packages/ichnaea/src/contracts/walk.ts"),
    ]);
  });

  it("fails on an exported function without a return type in a logic module", () => {
    const root = repository({ "egress.ts": NO_RETURN_TYPE });
    expect(checkIsolatedDeclarations("packages/ichnaea", root)).toEqual([
      expect.stringContaining("packages/ichnaea/src/contracts/egress.ts"),
    ]);
  });

  it("allows the same code in the schema modules", () => {
    const root = repository({
      "primitives.ts": INFERRED,
      "records/plan.ts": INFERRED,
      "records/deep/other.ts": NO_RETURN_TYPE,
    });
    expect(checkIsolatedDeclarations("packages/ichnaea", root)).toEqual([]);
  });

  it("passes code with explicit types", () => {
    const root = repository({
      "walk.ts": "export const list: number[] = [1, 2];\nexport const n: number = 1;\n",
    });
    expect(checkIsolatedDeclarations("packages/ichnaea", root)).toEqual([]);
  });

  it("does not read a file with a similar name as a schema module", () => {
    const root = repository({ "primitives-extra.ts": INFERRED, "recordsx/a.ts": INFERRED });
    expect(checkIsolatedDeclarations("packages/ichnaea", root)).toHaveLength(2);
  });

  it("fails when the compiler does not start, instead of reading it as no errors", () => {
    expect(() => checkIsolatedDeclarations("packages/ichnaea", "/nonexistent-directory")).toThrow();
  });

  it("keeps only compiler errors under a package's src", () => {
    const output = [
      "packages/ichnaea/src/contracts/walk.ts(1,14): error TS9017: Only const arrays can be inferred.",
      "packages/ichnaea/src/contracts/records/plan.ts(1,14): error TS9010: Variable must have an explicit type.",
      "packages/ichnaea/test/contracts/a.test.ts(1,1): error TS2322: Not assignable.",
      "Found 3 errors.",
    ].join("\n");
    expect(isolatedDeclarationProblems(output)).toEqual([
      "packages/ichnaea/src/contracts/walk.ts(1,14): error TS9017: Only const arrays can be inferred.",
    ]);
  });
});
