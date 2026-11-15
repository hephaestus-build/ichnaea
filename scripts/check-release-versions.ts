// Fails unless every published package's version equals the release tag (v0.x.y): packages move in
// lockstep before 1.0, so one tag names one consistent set of tarballs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const tag = process.argv[2] ?? "";
const version = tag.replace(/^v/, "");
const root = join(import.meta.dirname, "..", "packages");
const wrong = readdirSync(root)
  .map(
    (dir) =>
      JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as {
        name: string;
        version: string;
        private?: boolean;
      },
  )
  .filter((p) => !p.private && p.version !== version)
  .map((p) => `${p.name}@${p.version}`);
if (!/^v0\.\d+\.\d+$/.test(tag)) {
  console.error(`tag ${tag} is not v0.x.y`);
  process.exit(1);
}
if (wrong.length > 0) {
  console.error(`tag ${tag} does not match package versions: ${wrong.join(", ")}`);
  process.exit(1);
}
console.log(`all packages at ${version}`);
