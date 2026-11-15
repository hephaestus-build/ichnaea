// Installs the packed tarballs into an empty project with the README's install, as a consumer would,
// and imports each package that the install adds. Proves that the artefact we release installs and
// loads without a registry, that each tarball has its README, and that the README's example runs
// end to end on it with the verdicts it states. Usage: node scripts/smoke-tarballs.ts <directory with .tgz files>
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { installAsReadme } from "./consumer-project.ts";
import { decides, readmeExample, readmeInstall } from "./readme-example.ts";

const repository = join(import.meta.dirname, "..");
const readme = readFileSync(join(repository, "README.md"), "utf8");
const { project, tarballs } = installAsReadme(process.argv[2] ?? "release");
try {
  // The README is the package's page on a registry.
  for (const t of tarballs)
    if (
      !execFileSync("tar", ["-tzf", t.file], { encoding: "utf8" })
        .split("\n")
        .includes("package/README.md")
    )
      throw new Error(`${t.file} has no README.md`);
  // The project can import only what the install adds; the other tarballs load as their
  // dependencies.
  const added = readmeInstall(readme).added.filter((n) => tarballs.some((t) => t.name === n));
  const imports = added.map((n) => `await import(${JSON.stringify(n)});`).join("\n");
  writeFileSync(
    join(project, "smoke.mjs"),
    `${imports}\nconsole.log("loaded ${added.length} packages");\n`,
  );
  execFileSync("node", ["smoke.mjs"], { cwd: project, stdio: "inherit" });
  execFileSync(
    "node",
    ["node_modules/@hephaestus-build/ichnaea-core/dist/bin.js", "schema", "trial"],
    { cwd: project, stdio: "ignore" },
  );

  // The substitution test: the README's five-minute example runs end to end on the tarballs alone.
  // Its config and plugin import the packages by name, so they resolve to the installed tarballs,
  // not to src. The block runs as written. Only its clone is replaced: a `git` on PATH links this
  // checkout as the clone. A marker after each command records the command's exit code.
  const example = readmeExample(readme);
  const shim = join(project, ".shim");
  mkdirSync(shim);
  writeFileSync(
    join(shim, "git"),
    `#!/bin/sh\n[ "$1" = clone ] || exit 64\nexec ln -s ${JSON.stringify(repository)} ichnaea\n`,
    { mode: 0o755 },
  );
  const MARK = "@@ichnaea-smoke-exit";
  const script = [
    "exec 2>&1",
    ...example.commands.map((c) => `${c}\nprintf '\\n${MARK} %s\\n' "$?"`),
  ].join("\n");
  const { stdout } = spawnSync("sh", ["-c", script], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, PATH: `${shim}${delimiter}${process.env["PATH"] ?? ""}` },
  });
  process.stdout.write(stdout);
  const parts = stdout.split(new RegExp(`\\n${MARK} (\\d+)\\n`));
  const ran = example.commands.map((command, i) => ({
    command,
    output: parts[2 * i] ?? "",
    exit: Number(parts[2 * i + 1] ?? -1),
  }));
  const failures: string[] = [];
  for (const { command, output, exit } of ran) {
    const scenario = example.scenarios.find((s) => decides(command, s.run));
    if (!scenario) {
      if (exit !== 0) failures.push(`${command.split("\n")[0]} exited ${exit}`);
      continue;
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
  }
  if (failures.length > 0)
    throw new Error(`the README's example on the tarballs:\n${failures.join("\n")}`);
  console.log("smoke: tarballs install and load; the README's example runs end to end on them");
} finally {
  rmSync(project, { recursive: true, force: true });
}
