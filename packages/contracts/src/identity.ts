import { digest } from "./canonical.ts";
import type { ConfigurationIdentity, Digest } from "./primitives.ts";
import { type Case, type CaseSet } from "./records/case.ts";
import { type Configuration, IDENTITY_EXCLUDED_FIELDS } from "./records/configuration.ts";

/**
 * Returns the configuration identity: the canonical hash of the resolved configuration with its
 * factor statuses (REQ-148). Fields that only name the configuration for people
 * (`label`) are excluded. Any change to behaviour gives a new identity.
 *
 * Model bindings and prompts are order-insensitive: they are sorted by role and by name first, so
 * two resolutions of the same configuration give the same identity.
 */
export async function configurationIdentity(
  configuration: Configuration,
): Promise<ConfigurationIdentity> {
  const record: Record<string, unknown> = { ...configuration };
  for (const field of IDENTITY_EXCLUDED_FIELDS) delete record[field];
  record["models"] = configuration.models.toSorted((a, b) => compare(a.role, b.role));
  record["prompts"] = configuration.prompts.toSorted((a, b) => compare(a.name, b.name));
  return (await digest(record)) as ConfigurationIdentity;
}

/** Returns the digest of one case. */
export async function caseDigest(record: Case): Promise<Digest> {
  return digest(record);
}

/**
 * Returns the digest of a case set: the hash of its entries sorted by case ID. Changing any case
 * changes its digest and so the set's digest (REQ-10).
 */
export async function caseSetDigest(entries: CaseSet["cases"]): Promise<Digest> {
  const sorted = entries
    .map((e) => ({ id: e.id, digest: e.digest, pool: e.pool, family: e.family }))
    .toSorted((a, b) => compare(a.id, b.id));
  return digest(sorted);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
