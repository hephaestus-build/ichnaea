// The files that the repository checks read: tracked or new and not ignored, as git lists them.
// `-z` separates the paths with NUL and leaves them unquoted, so a path with non-ASCII or special
// characters reaches every check as it is, instead of as a quoted string that names no file.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The tracked and untracked, not ignored, files under `paths` (all when empty), relative to `cwd`. */
export function trackedFiles(paths: readonly string[] = [], cwd = process.cwd()): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...paths],
    { cwd, encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(cwd, file)));
}
