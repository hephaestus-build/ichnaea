import { canonicalize, sha256 } from "./canonical.ts";

/**
 * Whether the candidate arm runs before the base arm in a case, at one trial per case and arm
 * (VALIDATION.md, "One trial per case"). The normative rule, the same in every language: take
 * SHA-256 of the RFC 8785 canonical form of `{ seed, case }`, with `seed` the plan's seed record and
 * `case` the case ID; the candidate runs first when the lowest bit of the digest's first byte is 1.
 * The planner lists each pair in this order, and `decide` recomputes it to check the records.
 */
export function candidateRunsFirst(
  seed: { readonly algorithm: string; readonly value: string },
  caseId: string,
): boolean {
  const hash = sha256(canonicalize({ seed, case: caseId }));
  const firstByte = Number.parseInt(hash.slice("sha256:".length, "sha256:".length + 2), 16);
  return (firstByte & 1) === 1;
}
