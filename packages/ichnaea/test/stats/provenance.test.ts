// The provenance a study writes (scripts/stats/provenance.ts): the local modules its process loads,
// recorded by the hook of scripts/stats/record-loads.ts, and the third-party packages among them.
// Each case runs a small study in a scratch repository, with the two scripts copied into it.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  mergeShards,
  PROVENANCE_SCHEMA,
  type Provenance,
  reexportsOnly,
} from "../../scripts/stats/provenance.ts";
import { commit, removeScratchRepos, scratchRepo } from "./support/git-repo.ts";

afterAll(removeScratchRepos);

const scripts = path.join(import.meta.dirname, "../../scripts/stats");
const workspace = path.join(import.meta.dirname, "../../../..");

/** The version of a package installed in the workspace. */
const installed = (name: string): string =>
  (
    JSON.parse(
      readFileSync(path.join(workspace, "node_modules", name, "package.json"), "utf8"),
    ) as { version: string }
  ).version;

/** A repository with the recorder, the writer, the workspace's lockfile and its node_modules. */
function studyRepo(files: Readonly<Record<string, string>>): string {
  const root = scratchRepo();
  mkdirSync(path.join(root, "rec"));
  for (const name of ["record-loads.ts", "provenance.ts"])
    copyFileSync(path.join(scripts, name), path.join(root, "rec", name));
  copyFileSync(path.join(workspace, "pnpm-lock.yaml"), path.join(root, "pnpm-lock.yaml"));
  symlinkSync(path.join(workspace, "node_modules"), path.join(root, "node_modules"));
  commit(root, { ".gitignore": "node_modules\n", ...files });
  return root;
}

/** Runs `study.ts` in `root`, with the recorder unless `record` is false. */
function runStudy(
  root: string,
  record = true,
): { status: number | null; out: string; err: string } {
  const argv = [...(record ? ["--import", "./rec/record-loads.ts"] : []), "study.ts"];
  const r = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const STUDY = `import { provenance } from "./rec/provenance.ts";
import type { Only } from "./type-only.ts";
import { used } from "./used.ts";

const dynamic = ["./dynamic", "ts"].join(".");
const { late } = await import(dynamic);
const total: Only = used + late;
const p = provenance(import.meta.filename, 7, process.argv.slice(2), { pull: 12 });
console.log(JSON.stringify({ p, total }));
`;

const MODULES = {
  "type-only.ts": "export type Only = number;\n",
  "used.ts": "export const used = 1;\n",
  "dynamic.ts": "export const late = 2;\n",
};

describe("the provenance of a study", () => {
  it("pins every local module the process loads, a dynamic import too, and no type-only import", () => {
    const root = studyRepo({ "study.ts": STUDY, ...MODULES });
    const { status, out, err } = runStudy(root);
    expect(err).toBe("");
    expect(status).toBe(0);
    const { p, total } = JSON.parse(out) as { p: Provenance; total: number };
    expect(total).toBe(3);
    expect(p.schema).toBe(PROVENANCE_SCHEMA);
    expect(PROVENANCE_SCHEMA).toBe("ichnaea.stats-provenance/2");
    expect(p.script).toBe("study.ts");
    expect(p.pull).toBe(12);
    expect(p.seedBase).toBe(7);
    expect(Object.keys(p.files)).toEqual([
      "dynamic.ts",
      "rec/provenance.ts",
      "study.ts",
      "used.ts",
    ]);
    expect(p.files["used.ts"]).toMatch(/^[0-9a-f]{64}$/);
    expect(p.packages).toEqual([]);
    expect(p.node).toBe(process.version);
  });

  it("pins each third-party package it loads by name and installed version", () => {
    const root = studyRepo({
      "study.ts": `import fc from "fast-check";
import { provenance } from "./rec/provenance.ts";

console.log(JSON.stringify({ p: provenance(import.meta.filename, null, []), n: typeof fc }));
`,
    });
    const { status, out, err } = runStudy(root);
    expect(err).toBe("");
    expect(status).toBe(0);
    const { p } = JSON.parse(out) as { p: Provenance };
    expect(p.packages).toContain(`fast-check@${installed("fast-check")}`);
    expect(p.packages).toEqual(p.packages.toSorted());
    expect(Object.keys(p.files).some((f) => f.includes("node_modules"))).toBe(false);
    expect(p.pull).toBeNull();
  });

  it("refuses a run whose loaded modules include one that only re-exports", () => {
    const root = studyRepo({
      "study.ts": `import { provenance } from "./rec/provenance.ts";
import { used } from "./barrel.ts";

console.log(used, provenance(import.meta.filename, null, []));
`,
      "barrel.ts": `// A barrel.\nexport { used } from "./used.ts";\nexport * from "./dynamic.ts";\n`,
      ...MODULES,
    });
    const { status, err } = runStudy(root);
    expect(status).not.toBe(0);
    expect(err).toMatch(/barrel\.ts only re-exports/);
  });

  it("refuses a run that did not record its loaded modules from the start", () => {
    const root = studyRepo({ "study.ts": STUDY, ...MODULES });
    const { status, err } = runStudy(root, false);
    expect(status).not.toBe(0);
    expect(err).toMatch(/--import \.\/scripts\/stats\/record-loads\.ts/);
  });

  it("refuses a sidecar when the run loaded a module after its provenance was taken", () => {
    const root = studyRepo({
      "study.ts": `import { writeFileSync } from "node:fs";
import { provenance, writeMeta } from "./rec/provenance.ts";

const p = provenance(import.meta.filename, null, []);
await import(["./dynamic", "ts"].join("."));
writeFileSync("out.tsv", "x\\n");
writeMeta("out.tsv", p, true);
`,
      ...MODULES,
    });
    const { status, err } = runStudy(root);
    expect(status).not.toBe(0);
    expect(err).toMatch(/dynamic\.ts was loaded after the provenance was taken/);
  });
});

describe("a module that only re-exports", () => {
  it.each([
    ['export * from "./a.ts";\n', true],
    ['// comment\nexport { a, type B } from "./a.ts";\nexport * as c from "./c.ts";\n', true],
    ['/* block */ export type { T } from "./t.ts"', true],
    ['export * from "./a.ts";\nexport const x = 1;\n', false],
    ['import { a } from "./a.ts";\nexport { a };\n', false],
    ["export const x = 1;\n", false],
    ["", false],
  ])("%j: %s", (text, expected) => {
    expect(reexportsOnly(text)).toBe(expected);
  });
});

describe("the shards of a study", () => {
  const base: Provenance = {
    schema: PROVENANCE_SCHEMA,
    script: "s.ts",
    commit: "a".repeat(40),
    pull: 3,
    files: { "s.ts": "1".repeat(64), "a.ts": "2".repeat(64) },
    packages: ["x@1.0.0"],
    seedBase: 1,
    arguments: ["merge"],
    node: "v24.22.2",
    started: "2026-11-17T00:00:00.000Z",
  };

  it("adds the modules and packages that each shard loaded", () => {
    const shard = { ...base, files: { "b.ts": "3".repeat(64), "s.ts": "1".repeat(64) } };
    const merged = mergeShards(base, [{ ...shard, packages: ["y@2.0.0"] }]);
    expect(Object.keys(merged.files)).toEqual(["a.ts", "b.ts", "s.ts"]);
    expect(merged.packages).toEqual(["x@1.0.0", "y@2.0.0"]);
    expect(merged.arguments).toEqual(["merge"]);
  });

  it("refuses a shard of another commit or Node version, or with another sha256", () => {
    expect(() => mergeShards(base, [{ ...base, commit: "b".repeat(40) }])).toThrow(/commit/);
    expect(() => mergeShards(base, [{ ...base, node: "v24.0.0" }])).toThrow(/Node/);
    expect(() => mergeShards(base, [{ ...base, files: { "a.ts": "9".repeat(64) } }])).toThrow(
      /a\.ts/,
    );
  });
});
