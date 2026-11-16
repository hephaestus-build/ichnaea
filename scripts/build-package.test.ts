import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assemble,
  BUILD_INFO,
  type BuildInfo,
  manifestProblems,
  missingTargets,
  PACKAGE,
  REPOSITORY,
  shippedManifest,
  treeDifferences,
  treeDigest,
  treeFiles,
} from "./build-package.ts";
import { checkBuildTree } from "./check-sbom.ts";

const development = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Record<
  string,
  never
>;
const shipped = shippedManifest(development);
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "ichnaea-build-test-"));
  roots.push(root);
  return root;
};

describe("the shipped manifest", () => {
  it("has no scripts, no development or runtime dependencies and no workspace range", () => {
    expect(manifestProblems(shipped)).toEqual([]);
    expect(Object.keys(shipped)).not.toContain("scripts");
    expect(JSON.stringify(shipped)).not.toContain("workspace:");
    expect(shipped["peerDependencies"]).toEqual({ zod: "^4.6.0" });
  });

  it("has exactly the decided subpaths, each with its types first", () => {
    expect(shipped["exports"]).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./contracts": { types: "./dist/contracts/index.d.ts", default: "./dist/contracts/index.js" },
      "./stats": { types: "./dist/stats/index.d.ts", default: "./dist/stats/index.js" },
      "./schemas/*.json": "./schemas/*.json",
      "./package.json": "./package.json",
    });
    for (const target of Object.values(shipped["exports"] as Record<string, unknown>))
      if (typeof target === "object")
        expect(Object.keys(target as object)).toEqual(["types", "default"]);
    expect(shipped["bin"]).toEqual({ ichnaea: "./dist/core/bin.js" });
    expect(shipped["engines"]).toEqual({ node: ">=24.3" });
  });

  it("sorts its keys, so that its bytes do not depend on the development manifest's order", () => {
    const keys = Object.keys(shipped);
    expect(keys).toEqual(keys.toSorted());
    const reversed = Object.fromEntries(Object.entries(development).toReversed());
    expect(JSON.stringify(shippedManifest(reversed))).toBe(JSON.stringify(shipped));
  });

  it.each(["prepare", "install", "postinstall", "preinstall", "prepack", "postpack"])(
    "refuses a manifest with a %s script",
    (script) => {
      expect(manifestProblems({ ...shipped, scripts: { [script]: "node x.js" } })).toEqual([
        "the manifest has scripts",
      ]);
    },
  );

  it("refuses development and runtime dependencies and a workspace range", () => {
    expect(manifestProblems({ ...shipped, devDependencies: { vitest: "5.1.0" } })).toEqual([
      "the manifest has devDependencies",
    ]);
    expect(manifestProblems({ ...shipped, peerDependencies: { x: "workspace:*" } })).toEqual([
      "the manifest has a workspace: range",
    ]);
    expect(manifestProblems({ ...shipped, dependencies: { y: "1.0.0" } })).toEqual([
      "the manifest has dependencies",
    ]);
  });
});

describe("the manifest targets", () => {
  it("names each export and bin target that a tree misses, and each pattern without a match", () => {
    const tree = scratch();
    mkdirSync(join(tree, "dist", "core"), { recursive: true });
    writeFileSync(join(tree, "dist", "index.js"), "");
    expect(missingTargets(tree, shipped)).toEqual([
      "./dist/index.d.ts is missing",
      "./dist/contracts/index.d.ts is missing",
      "./dist/contracts/index.js is missing",
      "./dist/stats/index.d.ts is missing",
      "./dist/stats/index.js is missing",
      "./schemas/*.json matches no file",
      "./package.json is missing",
      "./dist/core/bin.js is missing",
    ]);
  });
});

describe("the tree digest", () => {
  it("changes with a file's bytes, path and mode", () => {
    const tree = scratch();
    writeFileSync(join(tree, "a"), "1");
    const before = treeDigest(treeFiles(tree));
    writeFileSync(join(tree, "a"), "2");
    const bytes = treeDigest(treeFiles(tree));
    execFileSync("chmod", ["+x", join(tree, "a")]);
    const mode = treeDigest(treeFiles(tree));
    expect(new Set([before, bytes, mode]).size).toBe(3);
    expect(treeFiles(tree)).toEqual([{ path: "a", mode: "100755", bytes: Buffer.from("2") }]);
  });
});

describe("the assembled tree", () => {
  const tree = join(scratch(), "tree");
  let info: BuildInfo;
  beforeAll(() => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY, encoding: "utf8" });
    info = assemble(tree, head.trim());
  }, 300_000);

  it("holds the shipped manifest, the builds, the sources, the schemas and the build files", () => {
    const top = [...new Set(treeFiles(tree).map((f) => f.path.split("/")[0]))];
    expect(top).toEqual([
      "LICENSE",
      "README.md",
      "build.json",
      "dist",
      "package.json",
      "sbom.cdx.json",
      "schemas",
      "src",
    ]);
    expect(JSON.parse(readFileSync(join(tree, "package.json"), "utf8"))).toEqual(shipped);
  });

  it("holds every export and bin target, and the bin is an executable Node script", () => {
    expect(missingTargets(tree, shipped)).toEqual([]);
    const bin = treeFiles(tree).find((f) => f.path === "dist/core/bin.js");
    expect(bin?.mode).toBe("100755");
    expect(bin?.bytes.toString("utf8")).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(
      treeFiles(tree)
        .filter((f) => f.mode === "100755")
        .map((f) => f.path),
    ).toEqual(["dist/core/bin.js"]);
  });

  it("has an SBOM that describes the build of its source commit", () => {
    expect(checkBuildTree(tree)).toEqual([]);
  });

  it("records the build and the digest of every other file", () => {
    const files = treeFiles(tree);
    expect(info.node).toBe(process.version);
    expect(info.treeDigest).toBe(treeDigest(files.filter((f) => f.path !== BUILD_INFO)));
    expect(JSON.parse(readFileSync(join(tree, BUILD_INFO), "utf8"))).toEqual(info);
  });

  it("names no path on this machine, and its source maps name the sources relatively", () => {
    for (const f of treeFiles(tree)) {
      const text = f.bytes.toString("utf8");
      expect(text, f.path).not.toContain(REPOSITORY);
      expect(text, f.path).not.toContain(tmpdir());
    }
    const maps = treeFiles(tree).filter((f) => f.path.endsWith(".map"));
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) {
      const { sources } = JSON.parse(map.bytes.toString("utf8")) as { sources: string[] };
      for (const source of sources) expect(source, map.path).toMatch(/^\.\.\/(\.\.\/)*src\//);
    }
  });
});

const file = (path: string, text: string, mode: "100644" | "100755" = "100644") => ({
  path,
  mode,
  bytes: Buffer.from(text),
});

describe("the tree differences", () => {
  it("are none for equal trees", () => {
    expect(treeDifferences([file("a", "1")], [file("a", "1")])).toEqual([]);
  });

  it("name the first differing path in path order first, then the rest", () => {
    const expected = [
      file("README.md", "r"),
      file("dist/b.js", "b"),
      file("src/c.ts", "c", "100755"),
    ];
    const actual = [file("dist/a.js", "a"), file("dist/b.js", "B"), file("src/c.ts", "c")];
    expect(treeDifferences(expected, actual)).toEqual([
      "README.md: missing from the rebuilt tree",
      "dist/a.js: only in the rebuilt tree",
      "dist/b.js: the bytes differ",
      "src/c.ts: mode 100644, expected 100755",
    ]);
  });
});
