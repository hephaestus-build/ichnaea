// Type-checks every package and the repository scripts with its own tsconfig.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const projects = [
  "scripts",
  ...["packages", "examples"].flatMap((dir) =>
    existsSync(join(root, dir)) ? readdirSync(join(root, dir)).map((p) => join(dir, p)) : [],
  ),
].filter((p) => existsSync(join(root, p, "tsconfig.json")));
let failed = false;
for (const project of projects) {
  try {
    execFileSync("tsc", ["-p", join(project, "tsconfig.json")], { cwd: root, stdio: "inherit" });
    console.log(`ok ${project}`);
  } catch {
    failed = true;
  }
}
// DN-2: zod schema modules are exempt from isolatedDeclarations (their exported types would be a
// second, hand-written copy of each schema). Every other source module must pass it, including
// exported constants with inferred types, which the return-type lint cannot see.
const EXEMPT = /^packages\/contracts\/src\/(primitives\.ts|records\/)/;
for (const project of projects.filter((p) => p.startsWith("packages/"))) {
  let output = "";
  try {
    execFileSync(
      "tsc",
      ["-p", join(project, "tsconfig.json"), "--isolatedDeclarations", "--declaration"],
      { cwd: root, encoding: "utf8" },
    );
  } catch (error) {
    // No exit status: tsc did not start, which must fail rather than read as no errors.
    if (typeof (error as { status?: unknown }).status !== "number") throw error;
    output = String((error as { stdout?: string }).stdout ?? "");
  }
  const problems = output
    .split("\n")
    .filter((line) => /^packages\/[^/]+\/src\/.*error TS/.test(line) && !EXEMPT.test(line));
  if (problems.length > 0) {
    failed = true;
    console.error(`isolatedDeclarations: ${project}\n${problems.join("\n")}`);
  } else console.log(`ok ${project} (isolatedDeclarations outside the schema modules)`);
}
process.exit(failed ? 1 : 0);
