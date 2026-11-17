// The provenance a study writes (scripts/stats/provenance.ts): the local modules its process loads,
// recorded by the package's load recorder (src/core/load-record.ts) that
// scripts/stats/record-loads.ts preloads, and the third-party packages among them. Each case runs a
// small study in a scratch repository, with the writer, the preload and the recorder copied into
// it at their paths in the package, so the writer imports the very recorder that the preload
// started, as in a real run.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  mergeShards,
  PROVENANCE_SCHEMA,
  type Provenance,
  reexportsOnly,
} from "../../scripts/stats/provenance.ts";
import { commit, removeScratchRepos, scratchRepo } from "../stats/support/git-repo.ts";

afterAll(removeScratchRepos);

const scripts = path.join(import.meta.dirname, "../../scripts/stats");
const workspace = path.join(import.meta.dirname, "../../../..");
const src = path.join(import.meta.dirname, "../../src");
/** The preload, from the root of a scratch repository. */
const RECORDER = "./rec/scripts/stats/record-loads.ts";

/** The version of a package installed in the workspace. */
const installed = (name: string): string =>
  (
    JSON.parse(
      readFileSync(path.join(workspace, "node_modules", name, "package.json"), "utf8"),
    ) as { version: string }
  ).version;

/** A repository with the writer, the preload, the recorder and the workspace's node_modules. */
function studyRepo(files: Readonly<Record<string, string>>): string {
  const root = scratchRepo();
  for (const [from, to] of [
    [path.join(scripts, "provenance.ts"), "rec/scripts/stats/provenance.ts"],
    [path.join(scripts, "record-loads.ts"), "rec/scripts/stats/record-loads.ts"],
    [path.join(src, "core", "load-record.ts"), "rec/src/core/load-record.ts"],
  ] as const) {
    mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    copyFileSync(from, path.join(root, to));
  }
  symlinkSync(path.join(workspace, "node_modules"), path.join(root, "node_modules"));
  commit(root, { ".gitignore": "node_modules\n", ...files });
  return root;
}

/** Runs `study.ts` in `root`, with the recorder unless `record` is false. */
function runStudy(
  root: string,
  record = true,
): { status: number | null; out: string; err: string } {
  const argv = [...(record ? ["--import", RECORDER] : []), "study.ts"];
  const r = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const STUDY = `import { provenance } from "./rec/scripts/stats/provenance.ts";
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
    // The preload and the recorder it starts load before the hooks, so neither is pinned, although
    // the writer imports the recorder.
    expect(Object.keys(p.files)).toEqual([
      "dynamic.ts",
      "rec/scripts/stats/provenance.ts",
      "study.ts",
      "used.ts",
    ]);
    expect(p.files["used.ts"]).toMatch(/^[0-9a-f]{64}$/);
    expect(p.packages).toEqual({});
    expect(p.node).toBe(process.version);
  });

  it("pins each package it loads: its version, its importers and the bytes of its files", () => {
    const root = studyRepo({
      "study.ts": `import fc from "fast-check";
import { provenance } from "./rec/scripts/stats/provenance.ts";

console.log(JSON.stringify({ p: provenance(import.meta.filename, null, []), n: typeof fc }));
`,
    });
    const { status, out, err } = runStudy(root);
    expect(err).toBe("");
    expect(status).toBe(0);
    const { p } = JSON.parse(out) as { p: Provenance };
    const fastCheck = `fast-check@${installed("fast-check")}`;
    expect(p.packages[fastCheck]?.importedBy).toEqual(["study.ts"]);
    const files = Object.entries(p.packages[fastCheck]?.files ?? {});
    expect(files.length).toBeGreaterThan(0);
    for (const [file, hash] of files) {
      expect(file).not.toMatch(/node_modules|^\//);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // fast-check's own dependency is pinned through fast-check, its importer.
    const pureRand = Object.keys(p.packages).find((k) => k.startsWith("pure-rand@"));
    expect(pureRand && p.packages[pureRand]?.importedBy).toEqual([fastCheck]);
    expect(Object.keys(p.packages)).toEqual(Object.keys(p.packages).toSorted());
    expect(Object.keys(p.files).some((f) => f.includes("node_modules"))).toBe(false);
    expect(p.pull).toBeNull();
  });

  it("refuses a run whose loaded modules include one that only re-exports", () => {
    const root = studyRepo({
      "study.ts": `import { provenance } from "./rec/scripts/stats/provenance.ts";
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

  it("refuses a run that loads worker threads, whose modules it cannot record", () => {
    const root = studyRepo({
      "study.ts": `import { Worker } from "node:worker_threads";
import { provenance } from "./rec/scripts/stats/provenance.ts";

console.log(typeof Worker, provenance(import.meta.filename, null, []));
`,
    });
    const { status, err } = runStudy(root);
    expect(status).not.toBe(0);
    expect(err).toMatch(/the study's loads cannot be pinned: it loaded worker threads/);
  });

  it("pins in the merge's sidecar the modules that only a shard loaded", () => {
    const root = studyRepo({
      "study.ts": `import { writeFileSync } from "node:fs";
import { mergeShards, provenance, readProvenance, writeMeta } from "./rec/scripts/stats/provenance.ts";

if (process.argv[2] === "shard") {
  const { value } = await import(["./shard-only", "ts"].join("."));
  const p = provenance(import.meta.filename, 7, process.argv.slice(2));
  writeFileSync("shard.tsv", \`\${value}\\n\`);
  writeMeta("shard.tsv", p, true);
} else {
  const p = provenance(import.meta.filename, 7, process.argv.slice(2), { pull: 5 });
  writeFileSync("out.tsv", "merged\\n");
  writeMeta("out.tsv", mergeShards(p, [readProvenance("shard.tsv")]), true);
}
`,
      "shard-only.ts": "export const value = 1;\n",
    });
    const run = (phase: string): { status: number | null; err: string } => {
      const r = spawnSync(process.execPath, ["--import", RECORDER, "study.ts", phase], {
        cwd: root,
        encoding: "utf8",
      });
      return { status: r.status, err: r.stderr };
    };
    expect(run("shard")).toEqual({ status: 0, err: "" });
    expect(run("merge")).toEqual({ status: 0, err: "" });
    const merged = JSON.parse(
      readFileSync(path.join(root, "out.tsv.meta.json"), "utf8"),
    ) as Provenance;
    expect(Object.keys(merged.files)).toEqual([
      "rec/scripts/stats/provenance.ts",
      "shard-only.ts",
      "study.ts",
    ]);
    expect(merged.pull).toBe(5);
    // A shard output changed after its run is refused.
    writeFileSync(path.join(root, "shard.tsv"), "2\n");
    const changed = run("merge");
    expect(changed.status).not.toBe(0);
    expect(changed.err).toMatch(/shard\.tsv is not the complete output that its sidecar records/);
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
import { provenance, writeMeta } from "./rec/scripts/stats/provenance.ts";

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
    packages: { "x@1.0.0": { importedBy: ["s.ts"], files: { "index.js": "4".repeat(64) } } },
    seedBase: 1,
    arguments: ["merge"],
    node: "v24.22.2",
    started: "2026-11-17T00:00:00.000Z",
  };

  it("adds the modules and packages that each shard loaded", () => {
    const shard = { ...base, files: { "b.ts": "3".repeat(64), "s.ts": "1".repeat(64) } };
    const y = { importedBy: ["b.ts"], files: { "y.js": "5".repeat(64) } };
    const x = {
      importedBy: ["b.ts"],
      files: { "index.js": "4".repeat(64), "x.js": "6".repeat(64) },
    };
    const merged = mergeShards(base, [{ ...shard, packages: { "y@2.0.0": y, "x@1.0.0": x } }]);
    expect(Object.keys(merged.files)).toEqual(["a.ts", "b.ts", "s.ts"]);
    expect(merged.packages).toEqual({
      "x@1.0.0": { importedBy: ["b.ts", "s.ts"], files: x.files },
      "y@2.0.0": y,
    });
    expect(merged.arguments).toEqual(["merge"]);
  });

  it("refuses a shard of another run, or with another sha256", () => {
    expect(() => mergeShards(base, [{ ...base, commit: "b".repeat(40) }])).toThrow(/commit/);
    expect(() => mergeShards(base, [{ ...base, node: "v24.0.0" }])).toThrow(/Node/);
    expect(() => mergeShards(base, [{ ...base, script: "t.ts" }])).toThrow(/script t\.ts/);
    expect(() => mergeShards(base, [{ ...base, seedBase: 2 }])).toThrow(/seed base 2/);
    const old = { ...base, schema: "ichnaea.stats-provenance/1" } as unknown as Provenance;
    expect(() => mergeShards(base, [old])).toThrow(/schema/);
    const patched = { importedBy: ["s.ts"], files: { "index.js": "7".repeat(64) } };
    expect(() => mergeShards(base, [{ ...base, packages: { "x@1.0.0": patched } }])).toThrow(
      /x@1\.0\.0\/index\.js/,
    );
    expect(() => mergeShards(base, [{ ...base, files: { "a.ts": "9".repeat(64) } }])).toThrow(
      /a\.ts/,
    );
  });
});
