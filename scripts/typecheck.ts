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
process.exit(failed ? 1 : 0);
