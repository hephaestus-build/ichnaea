// The isolatedDeclarations check of the type-check task, kept apart so that a test can run it.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Where the exemption applies: the zod schema modules of the contracts, `src/contracts/primitives.ts` and `src/contracts/records/`. Their exported types are
 * inferred from the schemas, and `isolatedDeclarations` would make each one a second, hand-written
 * copy. Every other source module must pass, including exported constants with inferred types,
 * which the return-type lint cannot see. Decision 0001 in docs/decisions has the reasons.
 */
export const EXEMPT = /^packages\/ichnaea\/src\/contracts\/(primitives\.ts|records\/)/;

const TSC = join(import.meta.dirname, "..", "node_modules", ".bin", "tsc");

/** Returns the compiler errors under a package's `src/` that the exemption does not cover. */
export function isolatedDeclarationProblems(output: string, exempt = EXEMPT): string[] {
  return output
    .split("\n")
    .filter((line) => /^packages\/[^/]+\/src\/.*error TS/.test(line) && !exempt.test(line));
}

/** Runs the compiler on a project with `isolatedDeclarations` and returns the problems. */
export function checkIsolatedDeclarations(project: string, cwd: string): string[] {
  let output = "";
  try {
    execFileSync(
      TSC,
      ["-p", join(project, "tsconfig.json"), "--isolatedDeclarations", "--declaration"],
      { cwd, encoding: "utf8" },
    );
  } catch (error) {
    // No exit status: tsc did not start, which must fail rather than read as no errors.
    if (typeof (error as { status?: unknown }).status !== "number") throw error;
    output = String((error as { stdout?: string }).stdout ?? "");
  }
  return isolatedDeclarationProblems(output);
}
