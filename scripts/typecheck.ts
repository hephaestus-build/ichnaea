// Type-checks every package and the repository scripts with its own tsconfig.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { checkIsolatedDeclarations } from "./isolated-declarations.ts";

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
// The schema modules are exempt from isolatedDeclarations, every other module must pass it
// (scripts/isolated-declarations.ts).
for (const project of projects.filter((p) => p.startsWith("packages/"))) {
  const problems = checkIsolatedDeclarations(project, root);
  if (problems.length > 0) {
    failed = true;
    console.error(`isolatedDeclarations: ${project}\n${problems.join("\n")}`);
  } else console.log(`ok ${project} (isolatedDeclarations outside the schema modules)`);
}
process.exit(failed ? 1 : 0);
