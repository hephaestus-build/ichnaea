import type { ConfigurationIdentity, Digest } from "./primitives.ts";
/** Thrown when a record cannot have a well-defined identity. */
export declare class IdentityError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "IdentityError";
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
export declare const DIGEST_RULES: {
    readonly case: DigestRule;
    readonly provenance: DigestRule;
    readonly caseSetEntry: DigestRule;
    readonly configuration: DigestRule;
    readonly prompt: DigestRule;
};
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
export declare function configurationIdentity(input: unknown): ConfigurationIdentity;
/**
 * Returns the digest of a case (REQ-10): the case restricted to `DIGEST_RULES.case`, with its
 * provenance restricted to `DIGEST_RULES.provenance`. Everything that decides what a case asks, how
 * it is graded and which analysis it supports enters it; the author pointer and the review status
 * do not.
 */
export declare function caseDigest(input: unknown): Digest;
/**
 * Returns the digest of a case set (REQ-10): SHA-256 of the RFC 8785 form of its entries, each
 * restricted to `id`, `digest`, `pool` and `family`, sorted by `id`. Changing any case changes its
 * digest and so the set's digest. Duplicate IDs and an empty set are errors.
 */
export declare function caseSetDigest(entries: readonly unknown[]): Digest;
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
export declare function verifyConfiguration(input: unknown, at?: string): LinkError[];
/**
 * Checks that every arm's stored identity is the identity of its configuration, and that each
 * configuration's recorded templates match their digests. Plans and runs carry both; a reader that
 * trusts the stored identity can check it once here. It reports every problem and does not throw:
 * an arm that is not a valid configuration, or that has no identity (an empty `models`, a duplicate
 * role), is reported with a null `computed` and its `problem`.
 */
export declare function verifyArms(arms: ReadonlyArray<{
    identity: string;
    configuration: unknown;
}>, at?: string): LinkError[];
/**
 * The digest of a suite (`ichnaea.suite/2`): SHA-256 over the RFC 8785 canonical JSON of the
 * record without its `$schema` member, so the TypeScript and JSONC forms of one suite share a
 * digest. Comments and layout of a JSONC file never reach the record.
 */
export declare function suiteDigest(input: unknown): Digest;
/**
 * The digest of a project config (`ichnaea.project/1`): SHA-256 over the RFC 8785 canonical JSON
 * of the record without its `$schema` member, as for a suite.
 */
export declare function projectDigest(input: unknown): Digest;
/**
 * The digest of a measure's definition: SHA-256 over the RFC 8785 canonical JSON of the measure's
 * entry in a suite (`ichnaea.suite/2`), which holds its value type, what computes it and the cases
 * it applies to. It is the first part of a measure's identity; `implementation` is the second.
 */
export declare function measureDefinitionDigest(definition: unknown): Digest;
/**
 * The implementation digest of a measure that an instrument process computes: the digest of the
 * instrument's pin in the lock, so a change to its files, its image or its judge identity changes
 * it.
 */
export declare function instrumentImplementation(pin: unknown): Digest;
/**
 * The members of a suite that the measurement digest hashes: the parts that change what is
 * measured. `measures` enters as each measure's identity, which covers its definition and its
 * code. Every member of `ichnaea.suite/2` is either hashed or excluded with its reason, and a test
 * holds that.
 */
export declare const MEASUREMENT_RULE: DigestRule;
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
export declare function measurementDigest(suite: unknown, pins: MeasurementPins): Digest;
//# sourceMappingURL=identity.d.ts.map