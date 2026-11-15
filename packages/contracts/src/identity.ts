import { digest as rawDigest, NonJsonValueError, sha256 } from "./canonical.ts";
import type { ConfigurationIdentity, Digest } from "./primitives.ts";
import { Case, CaseSetEntry } from "./records/case.ts";
import { Configuration } from "./records/configuration.ts";

/** Thrown when a record cannot have a well-defined identity. */
export class IdentityError extends Error {
  override readonly name = "IdentityError";
}

/** What one digest projection hashes, and what it leaves out with the reason. */
export interface DigestRule {
  /** The members hashed, an allow-list: a member added later stays out until it is listed. */
  readonly members: readonly string[];
  /** Members a writer may emit that are recorded but not hashed, each with its reason. */
  readonly excluded: Readonly<Record<string, string>>;
}

/**
 * The digest projections (normative, frozen). Every member the writer schema defines is either in
 * `members` or in `excluded`, and a test holds that. A projection keeps the listed members as
 * written. The values of `provenance` (in a case) and of each prompt (in a configuration) are
 * projected by their own rule; every other value is hashed whole, so a member added inside it by a
 * later minor version changes the digest. Changing a rule is a new major version.
 */
export const DIGEST_RULES: {
  readonly case: DigestRule;
  readonly provenance: DigestRule;
  readonly caseSetEntry: DigestRule;
  readonly configuration: DigestRule;
  readonly prompt: DigestRule;
} = {
  case: {
    members: [
      "id",
      "caseSet",
      "unit",
      "dataClass",
      "input",
      "turns",
      "fixtures",
      "references",
      "family",
      "slices",
      "criticality",
      "provenance",
      "pool",
    ],
    excluded: {
      schema:
        "The major version. A major that keeps this projection keeps identities; one that changes it is listed in majors.json, and its migration recomputes them.",
      validation: "The review status. Reviewing a case does not change what it asks or grades.",
    },
  },
  provenance: {
    members: [
      "source",
      "selection",
      "created",
      "collected",
      "licence",
      "exposure",
      "generator",
      "reusedDataset",
      "finding",
    ],
    excluded: {
      author: "A pointer to a person, erased with them. Erasing it keeps the case's digest.",
    },
  },
  caseSetEntry: {
    members: ["id", "digest", "pool", "family"],
    excluded: {},
  },
  configuration: {
    members: ["models", "parameters", "prompts", "factors"],
    excluded: {
      schema:
        "The major version. A major that keeps this projection keeps identities; one that changes it is listed in majors.json, and its migration recomputes them.",
      description:
        "Prose for people. Behaviour is pinned by models, parameters, prompts and factors.",
      label: "A name for people.",
      informational:
        "Values that do not decide behaviour, such as a provider fingerprint seen at resolution.",
    },
  },
  prompt: {
    members: ["name", "digest", "status"],
    excluded: {
      template:
        "The text that `digest` pins. A configuration with the text and one without it are the same configuration; verifyConfiguration checks the text against the digest.",
      uri: "Where the template was resolved from. Two resolutions of one template give one identity.",
    },
  },
};

async function digest(value: unknown): Promise<`sha256:${string}`> {
  try {
    return await rawDigest(value);
  } catch (error) {
    // A record can validate and still be unhashable (a lone surrogate in a string).
    if (error instanceof NonJsonValueError)
      throw new IdentityError(`the record has no canonical form: ${error.message}`);
    throw error;
  }
}

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
 * 1. The record must validate against `ichnaea.configuration/1`, and every recorded template must
 *    match its digest (`verifyConfiguration`).
 * 2. Keep the members in `DIGEST_RULES.configuration` as written, and of each prompt the members
 *    in `DIGEST_RULES.prompt`. The excluded members and their reasons are listed there.
 * 3. Sort `models` by `role`, and `parameters` and `prompts` by `name` (UTF-16 code units).
 *    Duplicate roles or names are an error.
 * 4. Take SHA-256 of the RFC 8785 canonical form.
 *
 * The writer computes the identity and stores it in plans and trials.
 */
export async function configurationIdentity(input: unknown): Promise<ConfigurationIdentity> {
  const [mismatch] = await verifyConfiguration(input);
  if (mismatch)
    throw new IdentityError(
      `the template at ${mismatch.path.replace(/\/digest$/, "/template")} does not match its digest`,
    );
  const projection = pick(input, DIGEST_RULES.configuration.members);
  projection["models"] = sortedUnique(projection["models"], "role", "model role");
  projection["parameters"] = sortedUnique(projection["parameters"], "name", "parameter");
  projection["prompts"] = sortedUnique(
    (projection["prompts"] as unknown[]).map((p) => pick(p, DIGEST_RULES.prompt.members)),
    "name",
    "prompt",
  );
  return (await digest(projection)) as ConfigurationIdentity;
}

/**
 * Returns the digest of a case (REQ-10): the case restricted to `DIGEST_RULES.case`, with its
 * provenance restricted to `DIGEST_RULES.provenance`. Everything that decides what a case asks, how
 * it is graded and which analysis it supports enters it; the author pointer and the review status
 * do not.
 */
export async function caseDigest(input: unknown): Promise<Digest> {
  Case.parse(input);
  const projection = pick(input, DIGEST_RULES.case.members);
  projection["provenance"] = pick(projection["provenance"], DIGEST_RULES.provenance.members);
  return digest(projection);
}

/**
 * Returns the digest of a case set (REQ-10): SHA-256 of the RFC 8785 form of its entries, each
 * restricted to `id`, `digest`, `pool` and `family`, sorted by `id`. Changing any case changes its
 * digest and so the set's digest. Duplicate IDs and an empty set are errors.
 */
export async function caseSetDigest(entries: readonly unknown[]): Promise<Digest> {
  if (entries.length === 0) throw new IdentityError("a case set has at least one case");
  for (const entry of entries) CaseSetEntry.parse(entry);
  const projected = entries.map((e) => pick(e, DIGEST_RULES.caseSetEntry.members));
  return digest(sortedUnique(projected, "id", "case id"));
}

/** A mismatch between a stored identity or digest and the record it names. */
export interface LinkError {
  readonly path: string;
  readonly stored: string;
  readonly computed: string;
}

/**
 * Checks the values a configuration records but does not hash: a prompt's `template`, when
 * present, must have the prompt's `digest`, the SHA-256 of the template's UTF-8 bytes.
 */
export async function verifyConfiguration(input: unknown, at = ""): Promise<LinkError[]> {
  const config = Configuration.parse(input);
  const errors: LinkError[] = [];
  for (const [i, prompt] of config.prompts.entries()) {
    if (prompt.template === undefined) continue;
    const computed = await sha256(prompt.template);
    if (computed !== prompt.digest)
      errors.push({ path: `${at}/prompts/${i}/digest`, stored: prompt.digest, computed });
  }
  return errors;
}

/**
 * Checks that every arm's stored identity is the identity of its configuration, and that each
 * configuration's recorded templates match their digests. Plans and runs carry both; a reader that
 * trusts the stored identity can check it once here.
 */
export async function verifyArms(
  arms: ReadonlyArray<{ identity: string; configuration: unknown }>,
  at = "/arms",
): Promise<LinkError[]> {
  const errors: LinkError[] = [];
  for (const [i, arm] of arms.entries()) {
    const templates = await verifyConfiguration(arm.configuration, `${at}/${i}/configuration`);
    errors.push(...templates);
    if (templates.length > 0) continue;
    const computed = await configurationIdentity(arm.configuration);
    if (computed !== arm.identity)
      errors.push({ path: `${at}/${i}/identity`, stored: arm.identity, computed });
  }
  return errors;
}
