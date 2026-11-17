// A scratch git repository for the provenance tests: files written and committed in a temporary
// directory, with a fixed author so that the commits do not depend on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];

/** Removes every repository that `scratchRepo` made. */
export function removeScratchRepos(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** Runs git in `cwd` and returns its trimmed standard output. */
export const runGit = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();

/** A new directory with an empty repository on branch main, or with none when `init` is false. */
export function scratchRepo(init = true): string {
  const root = mkdtempSync(path.join(tmpdir(), "ichnaea-provenance-"));
  roots.push(root);
  if (init) runGit(root, "init", "--quiet", "--initial-branch=main");
  return root;
}

/** Writes `files` (by path from `root`) and commits them; returns the commit. */
export function commit(
  root: string,
  files: Readonly<Record<string, string>>,
  message = "c",
): string {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  runGit(root, "add", "--all");
  runGit(root, "commit", "--quiet", "--no-gpg-sign", "--allow-empty", "-m", message);
  return runGit(root, "rev-parse", "HEAD");
}
