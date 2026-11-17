// The implementation digest of a measure: the code that computes its values. A module measure's
// digest covers the modules that its module loads, recorded in a child process by the shipped load
// recorder; a built-in scorer's digest is Ichnaea's build identity; an instrument's is its pin.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { instrumentImplementation, measureDefinitionDigest } from "../../src/contracts/identity.ts";
import { staleLockEntries } from "../../src/contracts/lock-checks.ts";
import { SuiteLock } from "../../src/contracts/records/lock.ts";
import type { SuiteV2 } from "../../src/contracts/records/suite-v2.ts";
import { measurementDigest } from "../../src/contracts/identity.ts";
import {
  buildIdentity,
  builtinImplementation,
  measureImplementation,
  moduleImplementation,
} from "../../src/core/implementation.ts";

const workspace = path.join(import.meta.dirname, "../../../..");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A directory with `files` (by path from it), and the workspace's node_modules when asked. */
function scratch(files: Readonly<Record<string, string>>, modules = false): string {
  const root = mkdtempSync(path.join(tmpdir(), "ichnaea-implementation-"));
  roots.push(root);
  if (modules) symlinkSync(path.join(workspace, "node_modules"), path.join(root, "node_modules"));
  write(root, files);
  return root;
}

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

const installed = (name: string): string =>
  (
    JSON.parse(
      readFileSync(path.join(workspace, "node_modules", name, "package.json"), "utf8"),
    ) as { version: string }
  ).version;

const MEASURE = `import type { Only } from "./type-only.ts";
import { helper } from "./helper.ts";

const late = ["./late", "ts"].join(".");
const { bonus } = await import(late);
export const cites = (answer: string): Only => helper(answer) + bonus;
`;
const MODULES = {
  "scorers/cites.ts": MEASURE.replaceAll("./", "../lib/"),
  "lib/type-only.ts": "export type Only = number;\n",
  "lib/helper.ts": "export const helper = (a: string): number => a.length;\n",
  "lib/late.ts": "export const bonus = 1;\n",
};

describe("the load recorder in a child process", () => {
  it("records the modules a measure's module loads: a dynamic import, never a type-only import", async () => {
    const root = scratch(MODULES);
    const loads = await moduleImplementation(path.join(root, "scorers/cites.ts"), root);
    expect(Object.keys(loads.files)).toEqual(["lib/helper.ts", "lib/late.ts", "scorers/cites.ts"]);
    expect(loads.files["lib/helper.ts"]).toMatch(/^[0-9a-f]{64}$/);
    expect(loads.packages).toEqual({});
    expect(loads.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("records a third-party package by its version, its importers and its files", async () => {
    const root = scratch(
      { "scorer.ts": 'import fc from "fast-check";\nexport const n = typeof fc;\n' },
      true,
    );
    const { packages } = await moduleImplementation(path.join(root, "scorer.ts"), root);
    const fastCheck = `fast-check@${installed("fast-check")}`;
    expect(packages[fastCheck]?.importedBy).toEqual(["scorer.ts"]);
    const files = Object.entries(packages[fastCheck]?.files ?? {});
    expect(files.length).toBeGreaterThan(0);
    for (const [file, hash] of files) {
      expect(file).not.toMatch(/node_modules|^\//);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const pureRand = Object.keys(packages).find((k) => k.startsWith("pure-rand@"));
    expect(pureRand && packages[pureRand]?.importedBy).toEqual([fastCheck]);
  });

  it("is not misled by a module that writes to standard output", async () => {
    const root = scratch({ "noisy.ts": 'console.log("{}");\nexport const x = 1;\n' });
    const loads = await moduleImplementation(path.join(root, "noisy.ts"), root);
    expect(Object.keys(loads.files)).toEqual(["noisy.ts"]);
  });

  it("refuses a module that loads worker threads, whose loads it cannot see", async () => {
    const root = scratch({ "threads.ts": 'import "node:worker_threads";\nexport const x = 1;\n' });
    await expect(moduleImplementation(path.join(root, "threads.ts"), root)).rejects.toThrow(
      /worker threads/,
    );
  });

  it("refuses a module that fails to load, with its error", async () => {
    const root = scratch({ "broken.ts": 'throw new Error("scorer exploded");\n' });
    await expect(moduleImplementation(path.join(root, "broken.ts"), root)).rejects.toThrow(
      /scorer exploded/,
    );
  });

  it("refuses a loaded module outside the root and outside node_modules", async () => {
    const outside = scratch({ "shared.ts": "export const s = 1;\n" });
    const root = scratch({
      "scorer.ts": `import { s } from ${JSON.stringify(path.join(outside, "shared.ts"))};\nexport const x = s;\n`,
    });
    await expect(moduleImplementation(path.join(root, "scorer.ts"), root)).rejects.toThrow(
      /outside/,
    );
  });
});

describe("the implementation digest of a module measure", () => {
  it("changes when a module it loads changes, and not when a type-only import changes", async () => {
    const root = scratch(MODULES);
    const module = path.join(root, "scorers/cites.ts");
    const before = (await moduleImplementation(module, root)).digest;
    write(root, { "lib/type-only.ts": "export type Only = number; // reworded\n" });
    expect((await moduleImplementation(module, root)).digest).toBe(before);
    write(root, {
      "lib/helper.ts": "export const helper = (a: string): number => a.length + 1;\n",
    });
    expect((await moduleImplementation(module, root)).digest).not.toBe(before);
  });

  it("does not depend on where the tree sits", async () => {
    const a = scratch(MODULES);
    const b = scratch(MODULES);
    expect((await moduleImplementation(path.join(a, "scorers/cites.ts"), a)).digest).toBe(
      (await moduleImplementation(path.join(b, "scorers/cites.ts"), b)).digest,
    );
  });
});

/** An installed Ichnaea build: its package.json and its shipped dist/ files. */
function build(version: string, files: Readonly<Record<string, string>>): string {
  const root = scratch({
    "package.json": JSON.stringify({ name: "@tumaet/ichnaea", version }),
    ...Object.fromEntries(Object.entries(files).map(([f, t]) => [`dist/${f}`, t])),
  });
  return path.join(root, "dist");
}

const DIST = {
  "scorers/ndcg.js": "export const ndcg = () => 1;\n",
  "scorers/exact.js": "export const exact = () => true;\n",
  "scorers/ndcg.d.ts": "export declare const ndcg: () => number;\n",
  "core/store.js": "export const store = 1;\n",
};

describe("the implementation digest of a built-in scorer", () => {
  it("changes when an Ichnaea upgrade changes the scorer", () => {
    const before = buildIdentity(build("1.0.0", DIST));
    const after = buildIdentity(
      build("1.1.0", { ...DIST, "scorers/ndcg.js": "export const ndcg = () => 0.5;\n" }),
    );
    expect(builtinImplementation("ndcg", after)).not.toBe(builtinImplementation("ndcg", before));
  });

  // The design keys a built-in scorer by Ichnaea's whole build, so an upgrade that leaves the
  // scorer alone changes its digest as well. This test records that cost.
  it("changes on an upgrade that leaves the scorer alone, as the whole build is its identity", () => {
    const before = buildIdentity(build("1.0.0", DIST));
    const after = buildIdentity(
      build("1.0.1", { ...DIST, "core/store.js": "export const store = 2;\n" }),
    );
    expect(builtinImplementation("ndcg", after)).not.toBe(builtinImplementation("ndcg", before));
  });

  it("covers the version and the shipped code, not the type declarations", () => {
    const base = buildIdentity(build("1.0.0", DIST));
    expect(buildIdentity(build("1.0.0", DIST))).toBe(base);
    expect(buildIdentity(build("1.0.1", DIST))).not.toBe(base);
    const declarations = { ...DIST, "scorers/ndcg.d.ts": "export declare const ndcg: () => 1;\n" };
    expect(buildIdentity(build("1.0.0", declarations))).toBe(base);
  });

  it("names the scorer, so two built-ins of one build differ", () => {
    const b = buildIdentity(build("1.0.0", DIST));
    expect(builtinImplementation("ndcg", b)).not.toBe(builtinImplementation("exact", b));
  });

  it("defaults to the running Ichnaea's build", () => {
    expect(builtinImplementation("ndcg")).toBe(builtinImplementation("ndcg", buildIdentity()));
  });
});

const SUITE = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../../fixtures/valid/suite.2.json"), "utf8"),
) as SuiteV2;
const LOCK = SuiteLock.parse(
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, "../../fixtures/valid/suite.lock.json"), "utf8"),
  ),
);

const measure = (id: string): SuiteV2["measures"][string] => SUITE.measures[id]!;

describe("a measure's implementation, by what computes it", () => {
  it("takes a built-in scorer's from the build", async () => {
    const context = { suiteDir: "/nowhere", root: "/nowhere", instruments: LOCK.instruments };
    expect(await measureImplementation(measure("grounded"), context)).toBe(
      builtinImplementation("links-grounded"),
    );
  });

  it("takes a stage status measure's from the build, since Ichnaea derives the status", async () => {
    const context = { suiteDir: "/nowhere", root: "/nowhere", instruments: LOCK.instruments };
    expect(await measureImplementation(measure("searched"), context)).toBe(
      builtinImplementation("stage-status"),
    );
  });

  it("takes an instrument's dimension from the instrument's pin", async () => {
    const context = { suiteDir: "/nowhere", root: "/nowhere", instruments: LOCK.instruments };
    expect(await measureImplementation(measure("correct"), context)).toBe(
      instrumentImplementation(LOCK.instruments["quality-judge"]),
    );
    await expect(
      measureImplementation(measure("correct"), { ...context, instruments: {} }),
    ).rejects.toThrow(/quality-judge/);
  });

  it("takes a module measure's from the modules its module loads", async () => {
    const root = scratch({ "suites/answers/scorers/cites.ts": MODULES["scorers/cites.ts"] });
    write(
      root,
      Object.fromEntries(
        Object.entries(MODULES)
          .filter(([f]) => f.startsWith("lib/"))
          .map(([f, t]) => [`suites/answers/${f}`, t]),
      ),
    );
    const context = { suiteDir: path.join(root, "suites/answers"), root, instruments: {} };
    const loads = await moduleImplementation(
      path.join(root, "suites/answers/scorers/cites.ts"),
      root,
    );
    expect(await measureImplementation(measure("cites-page"), context)).toBe(loads.digest);
  });

  it("refuses a measure that names neither a scorer nor a stage", async () => {
    const context = { suiteDir: "/nowhere", root: "/nowhere", instruments: {} };
    await expect(measureImplementation({ type: "binary" }, context)).rejects.toThrow(
      /neither a scorer nor a stage/,
    );
  });
});

/** A tree with the module measure's files, and the lock that the suite and the tree give. */
function lockedTree(): { root: string; lockOf: (suite: SuiteV2) => Promise<SuiteLock> } {
  const root = scratch(MODULES);
  const context = { suiteDir: root, root, instruments: LOCK.instruments };
  const lockOf = async (suite: SuiteV2): Promise<SuiteLock> => {
    const measures = Object.fromEntries(
      await Promise.all(
        Object.entries(suite.measures).map(async ([id, m]) => [
          id,
          {
            definition: measureDefinitionDigest(m),
            implementation: await measureImplementation(m, context),
          },
        ]),
      ),
    );
    const pins = { sources: LOCK.sources, instruments: LOCK.instruments, measures };
    return { ...LOCK, measures, measurementDigest: measurementDigest(suite, pins) };
  };
  return { root, lockOf };
}

describe("a change to a measure's scoring code, its definition unchanged", () => {
  it("changes its implementation, the measurement digest and its lock entry, and makes the lock stale", async () => {
    const { root, lockOf } = lockedTree();
    const locked = await lockOf(SUITE);
    expect(staleLockEntries(locked, await lockOf(SUITE))).toEqual([]);

    write(root, {
      "lib/helper.ts": "export const helper = (a: string): number => a.length * 2;\n",
    });
    const current = await lockOf(SUITE);
    expect(current.measures["cites-page"]?.definition).toBe(
      locked.measures["cites-page"]?.definition,
    );
    expect(current.measures["cites-page"]?.implementation).not.toBe(
      locked.measures["cites-page"]?.implementation,
    );
    expect(current.measurementDigest).not.toBe(locked.measurementDigest);
    expect(staleLockEntries(locked, current)).toEqual([
      "/measurementDigest",
      "/measures/cites-page/implementation",
    ]);
  });
});

/** The fixture suite with a level measure whose lowest level has the given anchor. */
const tone = (anchor: string): SuiteV2 => ({
  ...SUITE,
  measures: {
    ...SUITE.measures,
    tone: {
      type: "level",
      levels: [1, 2, 3],
      anchors: { "1": anchor, "3": "warm" },
      scorer: { builtin: "exact" },
    },
  },
});

describe("a change to a measure definition's wording alone", () => {
  it("changes only its definition digest", async () => {
    const { lockOf } = lockedTree();
    const locked = await lockOf(tone("curt"));
    const current = await lockOf(tone("brusque"));
    expect(current.measures["tone"]?.implementation).toBe(locked.measures["tone"]?.implementation);
    expect(staleLockEntries(locked, current)).toEqual([
      "/measurementDigest",
      "/measures/tone/definition",
    ]);
  });
});
