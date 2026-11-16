// Decides whether a pull request changes what the docs site build reads: the site, the library's
// sources (the site bundles them for the browser, so its build is the library's browser check), the
// examples and the workspace files. docs.yml runs on every pull request and calls this in its first
// job. The `docs build` job then builds, or is skipped, and a skipped job still reports to a
// required check. A workflow-level path filter would report nothing, and a required check that
// never reports blocks the pull request.
//
// Usage: node scripts/docs-changes.ts <base> <head>. It prints `docs=true` or `docs=false`, and
// appends the same line to $GITHUB_OUTPUT when it is set.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

/** A directory ends in `/` and matches everything under it. Any other entry is one file. */
export const DOCS_PATHS: readonly string[] = [
  "docs/site/",
  "packages/ichnaea/src/",
  "packages/ichnaea/schemas/",
  "packages/ichnaea/package.json",
  "examples/",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".github/workflows/docs.yml",
  "scripts/docs-changes.ts",
];

/** True when any changed file is one that the docs site build reads. */
export function touchesDocs(files: readonly string[]): boolean {
  return files.some((file) =>
    DOCS_PATHS.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path)),
  );
}

if (import.meta.main) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("usage: node scripts/docs-changes.ts <base> <head>");
    process.exit(2);
  }
  const files = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const line = `docs=${touchesDocs(files)}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
}
