import * as z from "zod";

import { digest as rawDigest, NonJsonValueError, sha256 } from "./canonical.ts";
import type { ConfigurationIdentity, Digest } from "./primitives.ts";
import { Case, CaseSetEntry } from "./records/case.ts";
import { Configuration } from "./records/configuration.ts";
import { InstrumentPin, LockedSource } from "./records/lock.ts";
import { MeasureIdentity } from "./records/measure-identity.ts";
import { ProjectConfig } from "./records/project.ts";
import { MeasureDefinition, SuiteV2 } from "./records/suite-v2.ts";

/** Thrown when a record cannot have a well-defined identity. */
export class IdentityError extends Error {
  /** The error's name, for `instanceof`-free checks. */
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
 * later minor version changes the digest. Changing a rule is a new major version. Decisions 0002
 * (case digests) and 0003 (configuration identity) in docs/decisions give the reasons.
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
    ],
    excluded: {
      schema:
        "The major version. A major that keeps this projection keeps identities; one that changes it is listed in majors.json, and its migration recomputes them.",
      id: "Where the case sits in its set. A case copied under a new ID keeps its digest, so a screened case cannot pass as new; the set entry hashes the ID.",
      pool: "Where the case sits in its set. Moving a screened case into another pool keeps its digest; the set entry hashes the pool.",
      caseSet:
        "A pointer to the set that holds the case. The same case in another set, or in a renamed set, keeps its digest, so a case is traced by its digest across sets. The set's own digest covers its membership.",
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

function digest(value: unknown): `sha256:${string}` {
  try {
    return rawDigest(value);
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
export function configurationIdentity(input: unknown): ConfigurationIdentity {
  const [mismatch] = verifyConfiguration(input);
  if (mismatch) {
    const template = mismatch.path.replace(/\/digest$/, "/template");
    throw new IdentityError(
      mismatch.problem === undefined
        ? `the template at ${template} does not match its digest`
        : `the template at ${template} cannot be hashed: ${mismatch.problem}`,
    );
  }
  const projection = pick(input, DIGEST_RULES.configuration.members);
  projection["models"] = sortedUnique(projection["models"], "role", "model role");
  projection["parameters"] = sortedUnique(projection["parameters"], "name", "parameter");
  projection["prompts"] = sortedUnique(
    (projection["prompts"] as unknown[]).map((p) => pick(p, DIGEST_RULES.prompt.members)),
    "name",
    "prompt",
  );
  return digest(projection) as ConfigurationIdentity;
}

/**
 * Returns the digest of a case (REQ-10): the case restricted to `DIGEST_RULES.case`, with its
 * provenance restricted to `DIGEST_RULES.provenance`. Everything that decides what a case asks, how
 * it is graded and which analysis it supports enters it; the author pointer and the review status
 * do not.
 */
export function caseDigest(input: unknown): Digest {
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
export function caseSetDigest(entries: readonly unknown[]): Digest {
  if (entries.length === 0) throw new IdentityError("a case set has at least one case");
  for (const entry of entries) CaseSetEntry.parse(entry);
  const projected = entries.map((e) => pick(e, DIGEST_RULES.caseSetEntry.members));
  return digest(sortedUnique(projected, "id", "case id"));
}

/**
 * A stored identity or digest that does not match the record it names (`computed` is the value the
 * record has), or a record whose value cannot be computed (`computed` is null and `problem` says
 * why).
 */
export interface LinkError {
  /**
   * The JSON pointer of the value that does not match, or of the configuration that cannot be
   * checked.
   */
  readonly path: string;
  /** The identity or digest that the record stores. */
  readonly stored: string;
  /** The value computed from the record, or null when it cannot be computed. */
  readonly computed: string | null;
  /** Why the value cannot be computed; present only when `computed` is null. */
  readonly problem?: string;
}

/**
 * Checks the values a configuration records but does not hash: a prompt's `template`, when
 * present, must be well-formed Unicode and have the prompt's `digest`, the SHA-256 of the
 * template's UTF-8 bytes. A template with a lone surrogate has no UTF-8 form, so it never matches.
 */
export function verifyConfiguration(input: unknown, at = ""): LinkError[] {
  const config = Configuration.parse(input);
  const errors: LinkError[] = [];
  for (const [i, prompt] of config.prompts.entries()) {
    if (prompt.template === undefined) continue;
    const path = `${at}/prompts/${i}/digest`;
    if (!prompt.template.isWellFormed()) {
      errors.push({
        path,
        stored: prompt.digest,
        computed: null,
        problem: "the template has a lone surrogate, so it has no UTF-8 form",
      });
      continue;
    }
    const computed = sha256(prompt.template);
    if (computed !== prompt.digest) errors.push({ path, stored: prompt.digest, computed });
  }
  return errors;
}

/**
 * Checks that every arm's stored identity is the identity of its configuration, and that each
 * configuration's recorded templates match their digests. Plans and runs carry both; a reader that
 * trusts the stored identity can check it once here. It reports every problem and does not throw:
 * an arm that is not a valid configuration, or that has no identity (an empty `models`, a duplicate
 * role), is reported with a null `computed` and its `problem`.
 */
export function verifyArms(
  arms: ReadonlyArray<{ identity: string; configuration: unknown }>,
  at = "/arms",
): LinkError[] {
  const errors: LinkError[] = [];
  for (const [i, arm] of arms.entries()) {
    const path = `${at}/${i}`;
    try {
      const templates = verifyConfiguration(arm.configuration, `${path}/configuration`);
      errors.push(...templates);
      if (templates.length > 0) continue;
      const computed = configurationIdentity(arm.configuration);
      if (computed !== arm.identity)
        errors.push({ path: `${path}/identity`, stored: arm.identity, computed });
    } catch (error) {
      if (!(error instanceof IdentityError || error instanceof z.ZodError)) throw error;
      errors.push({
        path: `${path}/configuration`,
        stored: arm.identity,
        computed: null,
        problem: error instanceof z.ZodError ? z.prettifyError(error) : error.message,
      });
    }
  }
  return errors;
}

/** The record without its `$schema` editor pointer, which enters no digest. */
function withoutSchemaPointer(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$schema"));
}

/**
 * The digest of a suite (`ichnaea.suite/2`): SHA-256 over the RFC 8785 canonical JSON of the
 * record without its `$schema` member, so the TypeScript and JSONC forms of one suite share a
 * digest. Comments and layout of a JSONC file never reach the record.
 */
export function suiteDigest(input: unknown): Digest {
  return digest(withoutSchemaPointer(SuiteV2.parse(input)));
}

/**
 * The digest of a project config (`ichnaea.project/1`): SHA-256 over the RFC 8785 canonical JSON
 * of the record without its `$schema` member, as for a suite.
 */
export function projectDigest(input: unknown): Digest {
  return digest(withoutSchemaPointer(ProjectConfig.parse(input)));
}

/**
 * The digest of a measure's definition: SHA-256 over the RFC 8785 canonical JSON of the measure's
 * entry in a suite (`ichnaea.suite/2`), which holds its value type, what computes it and the cases
 * it applies to. It is the first part of a measure's identity; `implementation` is the second.
 */
export function measureDefinitionDigest(definition: unknown): Digest {
  return digest(MeasureDefinition.parse(definition));
}

/**
 * The implementation digest of a measure that an instrument process computes: the digest of the
 * instrument's pin in the lock, so a change to its files, its image or its judge identity changes
 * it.
 */
export function instrumentImplementation(pin: unknown): Digest {
  return digest(InstrumentPin.parse(pin));
}

/**
 * The members of a suite that the measurement digest hashes: the parts that change what is
 * measured. `measures` enters as each measure's identity, which covers its definition and its
 * code. Every member of `ichnaea.suite/2` is either hashed or excluded with its reason, and a test
 * holds that.
 */
export const MEASUREMENT_RULE: DigestRule = {
  members: [
    "cases",
    "instruments",
    "measures",
    "limits",
    "stages",
    "entry",
    "stopReasons",
    "profiles",
  ],
  excluded: {
    $schema: "Editor metadata. The TypeScript and JSONC forms of one suite measure the same thing.",
    schema: "The major version, a one-value literal.",
    id: "The suite's name. Renaming a suite changes nothing that it measures.",
    version: "A label for people. The digest is the suite's identity.",
    about: "Prose for people. It decides nothing.",
    worker:
      "What runs the system. A trial's key carries the system's identity, so the measurement stays apart from the system it measures.",
    import: "The other runner whose results the suite imports: the system side, as for the worker.",
    configuration: "What the arm configuration record keeps: the system side, as for the worker.",
    environment:
      "What the system reads. A trial's key carries each factor's identity, as for the worker.",
    policy:
      "Which measures decide and their limits. They turn values into a verdict and change no value; the lock carries a copy of the limits.",
    budget: "How many calls a run may make. A run that reaches it records its missing trials.",
    baselines: "Which stored baselines a run may use. It changes no value.",
    attribute: "The fidelity margins of attribute. They decide its verdict and change no value.",
    deterministic: "A declaration about the system, which the records check. It changes no value.",
  },
};

/** What the lock pins beside the suite, which the measurement digest covers. */
export interface MeasurementPins {
  /** Each case source as the lock pins it. */
  readonly sources: readonly unknown[];
  /** Each instrument's pin, by instrument. */
  readonly instruments: Readonly<Record<string, unknown>>;
  /** Each measure's identity, by measure: one for every measure of the suite. */
  readonly measures: Readonly<Record<string, unknown>>;
}

/**
 * The measurement digest of a suite: the digest of the parts that change what is measured
 * (`MEASUREMENT_RULE`), with the lock's pins: each source, each instrument's pin and each measure's
 * identity. A change to a measure's code changes its implementation digest and so this digest,
 * which keys the noise setup. Throws when the identities do not name exactly the suite's measures,
 * or the pins exactly its instruments; when an identity's definition is not the digest of the
 * suite's definition of that measure; or when a measure that reads an instrument's dimension has
 * another implementation than the digest of that instrument's pin.
 */
export function measurementDigest(suite: unknown, pins: MeasurementPins): Digest {
  const parsed = SuiteV2.parse(suite);
  const measures = z.record(z.string(), MeasureIdentity).parse(pins.measures);
  const named = Object.keys(parsed.measures).toSorted(compare);
  const identified = Object.keys(measures).toSorted(compare);
  if (named.join("\0") !== identified.join("\0"))
    throw new IdentityError(
      `the identities name the measures ${identified.join(", ")}, the suite ${named.join(", ")}`,
    );
  const instruments = z.record(z.string(), InstrumentPin).parse(pins.instruments);
  const declared = Object.keys(parsed.instruments ?? {}).toSorted(compare);
  const pinned = Object.keys(instruments).toSorted(compare);
  if (declared.join("\0") !== pinned.join("\0"))
    throw new IdentityError(
      `the pins name the instruments ${pinned.join(", ")}, the suite ${declared.join(", ")}`,
    );
  for (const [id, definition] of Object.entries(parsed.measures)) {
    if (measures[id]?.definition !== measureDefinitionDigest(definition))
      throw new IdentityError(`the identity of measure '${id}' has another definition digest`);
    const { scorer } = definition;
    if (scorer === undefined || !("dimension" in scorer)) continue;
    const pin = instruments[scorer.instrument];
    if (pin === undefined || measures[id]?.implementation !== instrumentImplementation(pin))
      throw new IdentityError(
        `the implementation of measure '${id}' is not the pin of instrument '${scorer.instrument}'`,
      );
  }
  return digest({
    suite: { ...pick(parsed, MEASUREMENT_RULE.members), measures },
    sources: z.array(LockedSource).parse(pins.sources),
    instruments,
  });
}
