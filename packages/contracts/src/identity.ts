import { digest } from "./canonical.ts";
import type { ConfigurationIdentity, Digest } from "./primitives.ts";
import { Case, CaseSetEntry } from "./records/case.ts";
import { Configuration } from "./records/configuration.ts";

/** Thrown when a record cannot have a well-defined identity. */
export class IdentityError extends Error {
  override readonly name = "IdentityError";
}

/**
 * The members each digest covers (normative, frozen). A digest hashes the record as written,
 * restricted to these top-level members; nested values are hashed whole. So every reader, of any
 * minor version and in any language, computes the same digest from the same bytes. A member added
 * to a record later enters a digest only through a new entry here, which is a breaking change.
 */
export const DIGEST_MEMBERS: {
  readonly case: readonly string[];
  readonly caseSetEntry: readonly string[];
  readonly configuration: readonly string[];
} = {
  case: ["id", "unit", "input", "turns", "fixtures", "references"],
  caseSetEntry: ["id", "digest", "pool", "family"],
  configuration: ["models", "parameters", "prompts", "factors"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps only the listed own members. Object.fromEntries keeps a `__proto__` member as data. */
function pick(value: unknown, members: readonly string[]): Record<string, unknown> {
  if (!isObject(value)) throw new IdentityError("a digested record must be a JSON object");
  return Object.fromEntries(
    members.filter((m) => Object.hasOwn(value, m)).map((m) => [m, value[m]]),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(items: unknown, key: string, what: string): unknown[] {
  const list = items as Array<Record<string, string>>;
  const seen = new Set<string>();
  for (const item of list) {
    const name = item[key] as string;
    if (seen.has(name))
      throw new IdentityError(`duplicate ${what} '${name}': the identity would depend on order`);
    seen.add(name);
  }
  return list.toSorted((a, b) => compare(a[key] as string, b[key] as string));
}

/**
 * Returns the configuration identity (REQ-148). Normative rule, the same in every language:
 *
 * 1. The record must validate against `ichnaea.configuration/1`.
 * 2. Keep the members `models`, `parameters`, `prompts` and `factors` as written. `description`
 *    and `label` describe the configuration for people and do not enter it.
 * 3. Sort `models` by `role`, and `parameters` and `prompts` by `name` (UTF-16 code units).
 *    Duplicate roles or names are an error.
 * 4. Take SHA-256 of the RFC 8785 canonical form.
 *
 * The writer computes the identity and stores it in plans and trials.
 */
export async function configurationIdentity(input: unknown): Promise<ConfigurationIdentity> {
  Configuration.parse(input);
  const projection = pick(input, DIGEST_MEMBERS.configuration);
  projection["models"] = sortedUnique(projection["models"], "role", "model role");
  projection["parameters"] = sortedUnique(projection["parameters"], "name", "parameter");
  projection["prompts"] = sortedUnique(projection["prompts"], "name", "prompt");
  return (await digest(projection)) as ConfigurationIdentity;
}

/**
 * Returns the digest of a case: what a system receives and what it is graded against (`id`,
 * `unit`, `input`, `turns`, `fixtures`, `references`). Provenance, pool, family, slices and review
 * status do not enter it, so erasing an author or reviewing a case keeps its digest.
 */
export async function caseDigest(input: unknown): Promise<Digest> {
  Case.parse(input);
  return digest(pick(input, DIGEST_MEMBERS.case));
}

/**
 * Returns the digest of a case set (REQ-10): SHA-256 of the RFC 8785 form of its entries, each
 * restricted to `id`, `digest`, `pool` and `family`, sorted by `id`. Changing any case changes its
 * digest and so the set's digest. Duplicate IDs and an empty set are errors.
 */
export async function caseSetDigest(entries: readonly unknown[]): Promise<Digest> {
  if (entries.length === 0) throw new IdentityError("a case set has at least one case");
  for (const entry of entries) CaseSetEntry.parse(entry);
  const projected = entries.map((e) => pick(e, DIGEST_MEMBERS.caseSetEntry));
  return digest(sortedUnique(projected, "id", "case id"));
}

/** A mismatch between a stored identity or digest and the record it names. */
export interface LinkError {
  readonly path: string;
  readonly stored: string;
  readonly computed: string;
}

/**
 * Checks that every arm's stored identity is the identity of its configuration. Plans and runs
 * carry both; a reader that trusts the stored identity can check it once here.
 */
export async function verifyArms(
  arms: ReadonlyArray<{ identity: string; configuration: unknown }>,
  at = "/arms",
): Promise<LinkError[]> {
  const errors: LinkError[] = [];
  for (const [i, arm] of arms.entries()) {
    const computed = await configurationIdentity(arm.configuration);
    if (computed !== arm.identity)
      errors.push({ path: `${at}/${i}/identity`, stored: arm.identity, computed });
  }
  return errors;
}
