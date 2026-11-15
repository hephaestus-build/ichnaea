import { digest } from "./canonical.ts";
import type { ConfigurationIdentity, Digest } from "./primitives.ts";
import { Case, type CaseSet, CaseSetEntry } from "./records/case.ts";
import { Configuration } from "./records/configuration.ts";

/** Thrown when a record cannot have a well-defined identity. */
export class IdentityError extends Error {
  override readonly name = "IdentityError";
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertUnique(names: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name))
      throw new IdentityError(`duplicate ${what} '${name}': the identity would depend on order`);
    seen.add(name);
  }
}

/**
 * Returns the configuration identity (REQ-148). The normative projection, which every language
 * implements the same way:
 *
 * 1. Parse with the `ichnaea.configuration/1` schema, which drops members the schema does not
 *    define. A record from a newer minor version therefore hashes as its version-1 projection.
 * 2. Remove `label`, which names the configuration for people and does not change behaviour.
 * 3. Sort `models` by `role`, `parameters` by `name` and `prompts` by `name` (UTF-16 code units).
 *    Duplicate roles or names are an error.
 * 4. Take SHA-256 of the RFC 8785 canonical form.
 *
 * The identity is computed by the writer and stored in plans and trials. Readers compare stored
 * identities; they never recompute one from a record with unknown members.
 */
export async function configurationIdentity(input: unknown): Promise<ConfigurationIdentity> {
  const configuration = Configuration.parse(input);
  assertUnique(
    configuration.models.map((m) => m.role),
    "model role",
  );
  assertUnique(
    configuration.parameters.map((p) => p.name),
    "parameter",
  );
  assertUnique(
    configuration.prompts.map((p) => p.name),
    "prompt",
  );
  const { label: _label, ...behaviour } = configuration;
  const projection = {
    ...behaviour,
    models: configuration.models.toSorted((a, b) => compare(a.role, b.role)),
    parameters: configuration.parameters.toSorted((a, b) => compare(a.name, b.name)),
    prompts: configuration.prompts.toSorted((a, b) => compare(a.name, b.name)),
  };
  return (await digest(projection)) as ConfigurationIdentity;
}

/** Returns the digest of one case: SHA-256 of the RFC 8785 form of its `ichnaea.case/1` projection. */
export async function caseDigest(input: unknown): Promise<Digest> {
  return digest(Case.parse(input));
}

/**
 * Returns the digest of a case set (REQ-10): SHA-256 of the RFC 8785 form of its entries
 * (`id`, `digest`, `pool`, and `family` where present), sorted by `id`. Changing any case changes
 * its digest and so the set's digest. Duplicate case IDs are an error.
 */
export async function caseSetDigest(entries: CaseSet["cases"]): Promise<Digest> {
  const parsed = entries.map((e) => CaseSetEntry.parse(e));
  assertUnique(
    parsed.map((e) => e.id),
    "case id",
  );
  return digest(parsed.toSorted((a, b) => compare(a.id, b.id)));
}
