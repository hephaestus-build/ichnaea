// Fails unless the release runs on main and its commit is reachable from main, so that a release
// is always built from reviewed code. Needs the full history (`fetch-depth: 0`).
// Usage: node scripts/check-on-main.ts <ref> <commit>
import { execFileSync } from "node:child_process";

/** Returns why the commit may not be released, or nothing if it may. */
export function notOnMain(ref: string, commit: string, cwd = process.cwd()): string | undefined {
  if (ref !== "refs/heads/main") return `the release must run on refs/heads/main, not ${ref}`;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"], {
      cwd,
      stdio: "ignore",
    });
    return undefined;
  } catch {
    return `commit ${commit} is not reachable from origin/main`;
  }
}

if (import.meta.main) {
  const [ref = "", commit = ""] = process.argv.slice(2);
  const why = notOnMain(ref, commit);
  if (why) {
    console.error(why);
    process.exit(1);
  }
  console.log(`commit ${commit} is on main`);
}
