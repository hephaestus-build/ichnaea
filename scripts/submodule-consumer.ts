// Follows the README as a consumer who pins Ichnaea as a git submodule would. It commits the files
// of this checkout, tracked and untracked but not ignored, with their modes, to a scratch
// repository, so the test covers the working tree. A new consumer repository adds that commit as
// the submodule vendor/ichnaea and runs the README's workspace file and install block. Then it fails
// unless:
// - the install leaves the submodule clean (pnpm marks a bin executable, so a bin committed without
//   its executable bit dirties the submodule);
// - one zod is installed;
// - every package's public API type-checks under each consumer compiler profile, and loads in Node;
// - each scenario of the README's five-minute example prints its verdict line, exits with its code
//   and stores its verdict.
// Usage: node scripts/submodule-consumer.ts
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
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { decides, readmeExample, readmeInstall } from "./readme-example.ts";

const repository = join(import.meta.dirname, "..");
const readme = readFileSync(join(repository, "README.md"), "utf8");
const install = readmeInstall(readme);
const example = readmeExample(readme);
const root = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as {
  packageManager: string;
  devDependencies: Record<string, string>;
};
const packages = readdirSync(join(repository, "packages")).map(
  (dir) => `@hephaestus-build/ichnaea-${dir}`,
);

/**
 * The compiler options that consumers type-check Ichnaea's sources with, through the workspace
 * link: the sources are not under node_modules, so `skipLibCheck` does not skip them. Each profile
 * allows `.ts` import extensions, as a project that runs TypeScript with Node must.
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
  skipLibCheck: true,
};
const PROFILES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
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
    skipLibCheck: true,
    types: ["node"],
  },
  // The union of the strictest options that consumers use, under both module systems.
  "union-nodenext": { ...UNION, module: "NodeNext", moduleResolution: "NodeNext" },
  "union-bundler": { ...UNION, module: "Preserve", moduleResolution: "Bundler" },
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Ichnaea consumer test",
      "-c",
      "user.email=consumer-test@invalid",
      "-c",
      "commit.gpgsign=false",
      // Git refuses a submodule from a local path unless the file transport is allowed.
      "-c",
      "protocol.file.allow=always",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );

const work = mkdtempSync(join(tmpdir(), "ichnaea-consumer-"));
try {
  // The scratch repository: one commit of the working tree.
  const source = join(work, "ichnaea");
  mkdirSync(source);
  git(source, "init", "--quiet", "--initial-branch=main");
  const files = git(repository, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    // A tracked file that the working tree deletes is not part of it.
    .filter((f) => f !== "" && existsSync(join(repository, f)));
  // A copy keeps each file's mode, so the commit records the executable bit as the checkout has it.
  for (const file of files) cpSync(join(repository, file), join(source, file));
  git(source, "add", "--all");
  git(source, "commit", "--quiet", "--message", "scratch commit of the working tree");
  const commit = git(source, "rev-parse", "HEAD").trim();

  // The consumer: the README's submodule, workspace file and install.
  const project = join(work, "consumer");
  mkdirSync(project);
  git(project, "init", "--quiet", "--initial-branch=main");
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({ private: true, packageManager: root.packageManager }, null, 2)}\n`,
  );
  writeFileSync(join(project, "pnpm-workspace.yaml"), install.workspace);
  git(project, "submodule", "add", "--quiet", pathToFileURL(source).href, "vendor/ichnaea");
  git(join(project, "vendor", "ichnaea"), "checkout", "--quiet", commit);
  git(project, "add", ".gitmodules", "vendor/ichnaea");
  git(project, "commit", "--quiet", "--message", "build: pin ichnaea");
  execFileSync("sh", ["-ec", install.commands.join("\n")], { cwd: project, stdio: "inherit" });

  const dirty = [
    git(join(project, "vendor", "ichnaea"), "status", "--porcelain"),
    git(project, "status", "--porcelain", "--", "vendor/ichnaea"),
  ].join("");
  if (dirty !== "") throw new Error(`the install leaves the submodule changed:\n${dirty}`);
  console.log(`consumer: the submodule at ${commit} stays clean after the install`);

  // Two copies of zod would give the packages two schema classes: the root's must be the only one.
  const zods = readdirSync(join(project, "node_modules", ".pnpm")).filter((d) =>
    d.startsWith("zod@"),
  );
  if (zods.length !== 1)
    throw new Error(`the consumer installs ${zods.length} zod copies: ${zods}`);

  // Every package's public API, through its `exports`: type-checked under each profile, then run.
  execFileSync(
    "pnpm",
    [
      "add",
      "-w",
      "-D",
      `typescript@${root.devDependencies["typescript"]}`,
      `@types/node@${root.devDependencies["@types/node"]}`,
      ...packages.filter((n) => !install.added.includes(n)).map((n) => `${n}@workspace:*`),
    ],
    { cwd: project, stdio: "inherit" },
  );
  const names = packages.map((n) => n.replace("@hephaestus-build/ichnaea-", ""));
  writeFileSync(
    join(project, "api.ts"),
    [
      ...packages.map((n, i) => `import * as ${names[i]} from ${JSON.stringify(n)};`),
      `const api = { ${names.join(", ")} };`,
      "for (const [name, module] of Object.entries(api))",
      "  console.log(`consumer: ${name} has ${Object.keys(module).length} exports`);",
      "",
    ].join("\n"),
  );
  for (const [profile, compilerOptions] of Object.entries(PROFILES)) {
    writeFileSync(
      join(project, `tsconfig.${profile}.json`),
      JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: true }, files: ["api.ts"] }),
    );
    execFileSync(join(project, "node_modules", ".bin", "tsc"), ["-p", `tsconfig.${profile}.json`], {
      cwd: project,
      stdio: "inherit",
    });
    console.log(`consumer: the public API type-checks under the ${profile} profile`);
  }
  execFileSync("node", ["api.ts"], { cwd: project, stdio: "inherit" });

  // A marker after each command records the command's exit code.
  const MARK = "@@ichnaea-consumer-exit";
  const script = [
    "exec 2>&1",
    ...example.commands.map((c) => `${c}\nprintf '\\n${MARK} %s\\n' "$?"`),
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
    if (exit !== scenario.exit)
      failures.push(`${scenario.scenario}: decide exited ${exit}, expected ${scenario.exit}`);
    if (!output.includes(scenario.line))
      failures.push(`${scenario.scenario}: decide did not print "${scenario.line}"`);
    // Exit code 1 means INVALID as well as REGRESSION, so the stored verdict is checked too.
    const decision = join(project, ".ichnaea", "runs", scenario.run, "decision.json");
    const stored = existsSync(decision)
      ? (JSON.parse(readFileSync(decision, "utf8")) as { verdict: unknown }).verdict
      : "none";
    if (stored !== scenario.verdict)
      failures.push(
        `${scenario.scenario}: stored verdict ${String(stored)}, expected ${scenario.verdict}`,
      );
  });
  if (failures.length > 0)
    throw new Error(`the README's example in a submodule consumer:\n${failures.join("\n")}`);
  console.log("consumer: the README's install and five-minute example run with Node");
} finally {
  rmSync(work, { recursive: true, force: true });
}
