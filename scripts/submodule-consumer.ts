// Follows the README as a consumer who pins Ichnaea as a git submodule would: a new pnpm workspace
// with this checkout at vendor/ichnaea, the README's workspace file and install block, then the
// five-minute example as written, run with Node. It fails unless every package that the install
// adds imports, and unless each scenario of the README's table prints its verdict line, exits with
// its code and stores its verdict. Only `git submodule add` is replaced: the test copies the files
// of this checkout, tracked and untracked but not ignored, so it tests the working tree.
// Usage: node scripts/submodule-consumer.ts
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decides, readmeExample, readmeInstall } from "./readme-example.ts";

const repository = join(import.meta.dirname, "..");
const readme = readFileSync(join(repository, "README.md"), "utf8");
const install = readmeInstall(readme);
const example = readmeExample(readme);
const root = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as {
  packageManager: string;
};

const project = mkdtempSync(join(tmpdir(), "ichnaea-consumer-"));
try {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: repository,
      encoding: "utf8",
    },
  )
    .split("\0")
    // A tracked file that the working tree deletes is not part of it.
    .filter((f) => f !== "" && existsSync(join(repository, f)));
  for (const file of files)
    cpSync(join(repository, file), join(project, "vendor", "ichnaea", file));
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({ private: true, packageManager: root.packageManager }, null, 2)}\n`,
  );
  writeFileSync(join(project, "pnpm-workspace.yaml"), install.workspace);
  execFileSync("sh", ["-ec", install.commands.join("\n")], { cwd: project, stdio: "inherit" });

  // Two copies of zod would give the packages two schema classes: the root's must be the only one.
  const zods = readdirSync(join(project, "node_modules", ".pnpm")).filter((d) =>
    d.startsWith("zod@"),
  );
  if (zods.length !== 1)
    throw new Error(`the consumer installs ${zods.length} zod copies: ${zods}`);

  // Each package that the install adds loads from its workspace link, by its `exports`.
  writeFileSync(
    join(project, "imports.mjs"),
    `${install.added.map((n) => `await import(${JSON.stringify(n)});`).join("\n")}\n`,
  );
  execFileSync("node", ["imports.mjs"], { cwd: project, stdio: "inherit" });
  console.log(`consumer: one zod; ${install.added.length} packages import`);

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
  rmSync(project, { recursive: true, force: true });
}
