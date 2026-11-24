import { join } from "node:path";

/** Thrown when stored or offered records break the store's rules. The message names the record. */
export class StoreError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "StoreError";
}

/** Resolves all named areas of a run with the same encoding. */
export function runDirectory(root: string, area: "work" | "runs" | "owners", run: string): string {
  const name = encodeURIComponent(run);
  if (name === "" || name === "." || name === "..")
    throw new StoreError(`run ID '${run}' cannot name a directory`);
  return join(root, area, name);
}
