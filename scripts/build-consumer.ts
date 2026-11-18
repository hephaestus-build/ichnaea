// Follows the README as a consumer who installs the package would, against the built output: the
// artifact tested is the artifact shipped.
//
// By default it assembles the build tree of the working tree (scripts/build-package.ts), and a second
// one from a clone of the working tree at another path, and fails unless the two are byte-identical.
// It checks the tree's manifest and SBOM, packs exactly that tree, and installs the tarball into a
// new pnpm project outside the repository, with the README's install block: its `pnpm add` adds the
// tarball in place of the package's name, and its `npm audit signatures` runs in pnpm's layout.
// For a published version (`--spec @tumaet/ichnaea@<version>`), the audit must also show the
// package's own provenance. Then it fails unless:
// - installing runs no script, and one zod is installed;
// - each subpath (`.`, `./contracts`, `./stats`, `./calibration`, `./schemas/<record>.schema.json`)
//   loads in Node;
// - a consumer file type-checks under each consumer compiler profile with `skipLibCheck: false`,
//   so that the package's declarations are checked;
// - each scenario of the README's five-minute example, run with the CLI and again with the library
//   API, prints its verdict line, exits with its code and stores its verdict.
//
// Usage: node scripts/build-consumer.ts                  # the working tree, built twice
//        node scripts/build-consumer.ts --tree <dir>     # an assembled tree, as the workflows have
//        node scripts/build-consumer.ts --tarball <file> # a packed tarball, as a release stages it
//        node scripts/build-consumer.ts --spec @tumaet/ichnaea@<version>
//        node scripts/build-consumer.ts --spec github:hephaestus-build/ichnaea#<build-commit>
// The --spec forms install a published version from npm, or a build commit from GitHub, and run
// the same checks.
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  assemble,
  manifestProblems,
  missingTargets,
  REPOSITORY,
  treeDifferences,
  treeFiles,
} from "./build-package.ts";
import { checkBuildTree } from "./check-sbom.ts";
import {
  decides,
  installCommands,
  PACKAGE_NAME,
  readmeExample,
  readmeInstall,
  type Scenario,
} from "./readme-example.ts";
import { RELEASE_VERSION } from "./release-version.ts";
import { hasProvenance } from "./verify-published.ts";

const readme = readFileSync(join(REPOSITORY, "README.md"), "utf8");
const install = readmeInstall(readme);
const example = readmeExample(readme);
const root = JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8")) as {
  packageManager: string;
  devDependencies: Record<string, string>;
};

/**
 * The compiler options that consumers type-check with. `skipLibCheck` is false, so the compiler
 * checks the package's declarations under each profile.
 */
const UNION = {
  target: "es2023",
  lib: ["es2024"],
  types: ["node"],
  strict: true,
  exactOptionalPropertyTypes: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noImplicitReturns: true,
  allowImportingTsExtensions: true,
  skipLibCheck: false,
};
export const PROFILES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  // A consumer's scripts project: ESNext modules with Bundler resolution and the DOM libraries,
  // without exactOptionalPropertyTypes or the unused-code checks.
  "consumer-scripts": {
    target: "ES2023",
    module: "ESNext",
    moduleResolution: "Bundler",
    allowImportingTsExtensions: true,
    lib: ["ESNext", "DOM", "DOM.Iterable"],
    strict: true,
    erasableSyntaxOnly: true,
    noUncheckedIndexedAccess: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    forceConsistentCasingInFileNames: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: false,
    types: ["node"],
  },
  // The union of the strictest options that consumers use, under both module systems.
  "union-nodenext": { ...UNION, module: "NodeNext", moduleResolution: "NodeNext" },
  "union-bundler": { ...UNION, module: "Preserve", moduleResolution: "Bundler" },
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "advice.detachedHead=false", ...args], { cwd, encoding: "utf8" });

/** The working tree's files, tracked and untracked but not ignored, that exist. */
const workingTree = (): string[] =>
  git(REPOSITORY, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((f) => f !== "" && existsSync(join(REPOSITORY, f)));

/**
 * Assembles the build tree again from a clone of the working tree at another path, with its own
 * install, and returns every difference from the first tree.
 */
function rebuildElsewhere(first: string, commit: string, work: string): string[] {
  const clone = join(work, "second-checkout");
  git(work, "clone", "--quiet", "--no-checkout", "--shared", REPOSITORY, clone);
  git(clone, "checkout", "--quiet", "--detach", commit);
  // The working tree's changes: its files over the commit's, and its deletions.
  const files = workingTree();
  for (const file of git(clone, "ls-files", "-z").split("\0"))
    if (file !== "" && !files.includes(file)) rmSync(join(clone, file), { force: true });
  for (const file of files) cpSync(join(REPOSITORY, file), join(clone, file));
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: clone,
    stdio: "inherit",
  });
  const second = join(work, "second-tree");
  execFileSync("node", ["scripts/build-package.ts", second, "--source-commit", commit], {
    cwd: clone,
    stdio: "inherit",
  });
  return treeDifferences(treeFiles(first), treeFiles(second));
}

/** Checks a build tree's manifest, targets and SBOM, and packs it. Returns the tarball. */
function checkAndPack(tree: string, work: string): string {
  const manifest = JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const problems = [
    ...manifestProblems(manifest),
    ...missingTargets(tree, manifest),
    ...checkBuildTree(tree),
  ];
  if (problems.length > 0) throw new Error(`the build tree is wrong:\n${problems.join("\n")}`);
  const packed = join(work, "packed");
  execFileSync("pnpm", ["pack", "--pack-destination", packed], { cwd: tree, stdio: "ignore" });
  const [tarball, ...rest] = readdirSync(packed);
  if (!tarball || rest.length > 0) throw new Error(`pnpm pack wrote ${readdirSync(packed)}`);
  console.log(`consumer: the build tree's manifest and SBOM are sound; packed ${tarball}`);
  return join(packed, tarball);
}

/** The consumer file that each profile type-checks: every code subpath, used with its types. */
const API = `import { CORE_VERSION, decide, main, reportPlugin } from "${PACKAGE_NAME}";
import { Case, canonicalize, type Decision } from "${PACKAGE_NAME}/contracts";
import { compareCounts, type Comparison } from "${PACKAGE_NAME}/stats";
import { analyzeCalibration, type CalibrationAnalysis } from "${PACKAGE_NAME}/calibration";

const version: string = CORE_VERSION;
const exit: (argv: readonly string[]) => Promise<number> = main;
const text: string = canonicalize({ a: 1 });
const verdict = (d: Decision): string => d.verdict ?? "none";
const validated = (c: Comparison): boolean => c.regression.validated;
const secondary = (a: CalibrationAnalysis): boolean => a.use === "secondary";
export const used = [version, exit, decide, reportPlugin, Case, compareCounts, text, verdict, validated, analyzeCalibration, secondary];
`;

/** The consumer file that Node runs: every subpath, the JSON Schema files and the manifest. */
const SUBPATHS = `import * as ichnaea from "${PACKAGE_NAME}";
import * as contracts from "${PACKAGE_NAME}/contracts";
import * as stats from "${PACKAGE_NAME}/stats";
import * as calibration from "${PACKAGE_NAME}/calibration";
import caseSchema from "${PACKAGE_NAME}/schemas/case.schema.json" with { type: "json" };
import manifest from "${PACKAGE_NAME}/package.json" with { type: "json" };

const counts = { ".": Object.keys(ichnaea).length, "./contracts": Object.keys(contracts).length, "./stats": Object.keys(stats).length, "./calibration": Object.keys(calibration).length };
console.log(JSON.stringify({ counts, schema: caseSchema.$id, version: manifest.version, main: typeof ichnaea.main }));
`;

/** The library run of the example: each command of the README through `main`, in this process. */
const LIBRARY = `import { main } from "${PACKAGE_NAME}";

const commands = JSON.parse(process.argv[2] ?? "[]") as string[][];
const results: Array<{ exit: number; output: string }> = [];
for (const argv of commands) {
  const lines: string[] = [];
  results.push({ exit: await main(argv, (text) => lines.push(text)), output: lines.join("\\n") });
}
console.log(JSON.stringify(results));
`;

/** The verdict that a run stored, or "none". */
function storedVerdict(project: string, run: string): unknown {
  const decision = join(project, ".ichnaea", "runs", run, "decision.json");
  return existsSync(decision)
    ? (JSON.parse(readFileSync(decision, "utf8")) as { verdict: unknown }).verdict
    : "none";
}

/** Returns one failure per way in which a scenario's decide did not give what the README says. */
function scenarioFailures(
  how: string,
  scenario: Scenario,
  run: string,
  exit: number,
  output: string,
  project: string,
): string[] {
  const failures: string[] = [];
  if (exit !== scenario.exit)
    failures.push(`${how}, ${scenario.scenario}: decide exited ${exit}, expected ${scenario.exit}`);
  if (!output.includes(scenario.line))
    failures.push(`${how}, ${scenario.scenario}: decide did not print "${scenario.line}"`);
  // Exit code 1 means INVALID as well as REGRESSION, so the stored verdict is checked too.
  const stored = storedVerdict(project, run);
  if (stored !== scenario.verdict)
    failures.push(
      `${how}, ${scenario.scenario}: stored verdict ${String(stored)}, expected ${scenario.verdict}`,
    );
  return failures;
}

/** Installs `spec` as the README says into a new project, and runs every consumer check. */
function consume(spec: string, work: string): void {
  const project = join(work, "consumer");
  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({ private: true, packageManager: root.packageManager }, null, 2)}\n`,
  );
  const installed = spawnSync("sh", ["-ec", installCommands(install, spec).join("\n")], {
    cwd: project,
    encoding: "utf8",
  });
  process.stdout.write(installed.stdout + installed.stderr);
  if (installed.status !== 0) throw new Error("the README's install failed");
  const published = `${PACKAGE_NAME}@`;
  if (spec.startsWith(published)) {
    const audit = spawnSync("npm", ["audit", "signatures", "--json", "--include-attestations"], {
      cwd: project,
      encoding: "utf8",
    });
    if (!hasProvenance(JSON.parse(audit.stdout) as unknown, spec.slice(published.length)))
      throw new Error(`npm audit signatures in pnpm's layout shows no provenance for ${spec}`);
    console.log(`consumer: npm audit signatures shows the provenance of ${spec} in pnpm's layout`);
  }

  // Installing runs no script: the manifest has none, and pnpm reports no lifecycle script.
  const pkg = join(project, "node_modules", ...PACKAGE_NAME.split("/"));
  const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  if ("scripts" in manifest) throw new Error("the installed manifest has scripts");
  if (/\b(preinstall|install|postinstall|prepare)\$/.test(installed.stdout + installed.stderr))
    throw new Error("installing the package ran a lifecycle script");
  // Two copies of zod would give the package two schema classes: the root's must be the only one.
  const zods = readdirSync(join(project, "node_modules", ".pnpm")).filter((d) =>
    d.startsWith("zod@"),
  );
  if (zods.length !== 1)
    throw new Error(`the consumer installs ${zods.length} zod copies: ${zods}`);
  console.log(
    `consumer: installed ${PACKAGE_NAME}@${String(manifest["version"])}; no script ran; one zod`,
  );

  // Every subpath loads in Node.
  writeFileSync(join(project, "subpaths.ts"), SUBPATHS);
  const loaded = JSON.parse(
    execFileSync("node", ["subpaths.ts"], { cwd: project, encoding: "utf8" }),
  ) as {
    counts: Record<string, number>;
    schema: unknown;
    main: string;
  };
  if (
    Object.values(loaded.counts).some((n) => n === 0) ||
    loaded.main !== "function" ||
    typeof loaded.schema !== "string"
  )
    throw new Error(`a subpath does not load: ${JSON.stringify(loaded)}`);
  console.log(
    `consumer: the subpaths load: ${JSON.stringify(loaded.counts)} exports, schema ${String(loaded.schema)}`,
  );

  // The declarations, under each consumer profile, with skipLibCheck off.
  execFileSync(
    "pnpm",
    [
      "add",
      "-D",
      `typescript@${root.devDependencies["typescript"]}`,
      `@types/node@${root.devDependencies["@types/node"]}`,
    ],
    { cwd: project, stdio: "inherit" },
  );
  writeFileSync(join(project, "api.ts"), API);
  for (const [profile, compilerOptions] of Object.entries(PROFILES)) {
    writeFileSync(
      join(project, `tsconfig.${profile}.json`),
      JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: true }, files: ["api.ts"] }),
    );
    execFileSync(join(project, "node_modules", ".bin", "tsc"), ["-p", `tsconfig.${profile}.json`], {
      cwd: project,
      stdio: "inherit",
    });
    console.log(
      `consumer: the declarations type-check under the ${profile} profile, skipLibCheck off`,
    );
  }

  // The README's example with the CLI. Its clone of this repository is a copy of the working tree's
  // example, so that the example of this checkout runs.
  const MARK = "@@ichnaea-consumer-exit";
  const script = [
    "exec 2>&1",
    ...example.commands.map((command) => {
      const clone = /^git clone .* (\S+)$/.exec(command);
      if (!clone) return `${command}\nprintf '\\n${MARK} %s\\n' "$?"`;
      const into = join(project, clone[1]!, "examples", "support-assistant");
      for (const file of workingTree().filter((f) => f.startsWith("examples/support-assistant/")))
        cpSync(join(REPOSITORY, file), join(project, clone[1]!, file));
      if (!existsSync(into)) throw new Error(`the example is not at ${into}`);
      return `printf '\\n${MARK} 0\\n'`;
    }),
  ].join("\n");
  const { stdout } = spawnSync("sh", ["-c", script], { cwd: project, encoding: "utf8" });
  process.stdout.write(stdout);
  const parts = stdout.split(new RegExp(`\\n${MARK} (\\d+)\\n`));
  const failures: string[] = [];
  example.commands.forEach((command, i) => {
    const output = parts[2 * i] ?? "";
    const exit = Number(parts[2 * i + 1] ?? -1);
    const scenario = example.scenarios.find((s) => decides(command, s.run));
    if (!scenario) {
      if (exit !== 0) failures.push(`${command.split("\n")[0]} exited ${exit}`);
      return;
    }
    failures.push(...scenarioFailures("the CLI", scenario, scenario.run, exit, output, project));
  });

  // The same example through the library API: each scenario's commands under another run name.
  const PREFIX = "pnpm exec ichnaea ";
  const library = example.commands
    .filter((c) => c.startsWith(PREFIX))
    .map((c) =>
      c
        .slice(PREFIX.length)
        .replace(/\\\n/g, " ")
        .trim()
        .split(/\s+/)
        .map((arg, i, all) => (all[i - 1] === "--run" ? `${arg}-library` : arg)),
    );
  writeFileSync(join(project, "library.ts"), LIBRARY);
  const results = JSON.parse(
    execFileSync("node", ["library.ts", JSON.stringify(library)], {
      cwd: project,
      encoding: "utf8",
    }),
  ) as Array<{ exit: number; output: string }>;
  library.forEach((argv, i) => {
    const result = results[i] ?? { exit: -1, output: "" };
    const run = argv[argv.indexOf("--run") + 1] ?? "";
    const scenario = example.scenarios.find(
      (s) => argv[0] === "decide" && run === `${s.run}-library`,
    );
    if (!scenario) {
      if (result.exit !== 0)
        failures.push(`the library API: ${argv.slice(0, 1).join(" ")} exited ${result.exit}`);
      return;
    }
    failures.push(
      ...scenarioFailures("the library API", scenario, run, result.exit, result.output, project),
    );
  });
  if (failures.length > 0)
    throw new Error(`the README's example against the built package:\n${failures.join("\n")}`);
  console.log(
    "consumer: the README's install and five-minute example run with the CLI and the library API",
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { tree: { type: "string" }, tarball: { type: "string" }, spec: { type: "string" } },
  });
  if ([values.tree, values.tarball, values.spec].filter((v) => v !== undefined).length > 1)
    throw new Error("give one of --tree, --tarball and --spec");
  const published = `${PACKAGE_NAME}@`;
  if (
    values.spec &&
    !/^github:hephaestus-build\/ichnaea#[0-9a-f]{40}$/.test(values.spec) &&
    !(
      values.spec.startsWith(published) && RELEASE_VERSION.test(values.spec.slice(published.length))
    )
  )
    throw new Error(
      `--spec must be ${published}<version> or github:hephaestus-build/ichnaea#<build commit SHA>, not ${values.spec}`,
    );
  const work = mkdtempSync(join(tmpdir(), "ichnaea-consumer-"));
  try {
    let spec = values.spec ?? (values.tarball ? `file:${resolve(values.tarball)}` : undefined);
    if (!spec) {
      let tree = values.tree ? resolve(values.tree) : undefined;
      if (!tree) {
        tree = join(work, "tree");
        const commit = git(REPOSITORY, "rev-parse", "HEAD").trim();
        assemble(tree, commit);
        const differences = rebuildElsewhere(tree, commit, work);
        if (differences.length > 0)
          throw new Error(
            `two builds of the working tree differ, first at ${differences[0]}:\n${differences.join("\n")}`,
          );
        console.log("consumer: two builds of the working tree, at two paths, are byte-identical");
      }
      spec = `file:${checkAndPack(tree, work)}`;
    }
    consume(spec, work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
