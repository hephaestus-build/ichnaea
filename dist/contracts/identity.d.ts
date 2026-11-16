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
export declare function configurationIdentity(input: unknown): Promise<ConfigurationIdentity>;
/**
 * Returns the digest of a case (REQ-10): the case restricted to `DIGEST_RULES.case`, with its
 * provenance restricted to `DIGEST_RULES.provenance`. Everything that decides what a case asks, how
 * it is graded and which analysis it supports enters it; the author pointer and the review status
 * do not.
 */
export declare function caseDigest(input: unknown): Promise<Digest>;
/**
 * Returns the digest of a case set (REQ-10): SHA-256 of the RFC 8785 form of its entries, each
 * restricted to `id`, `digest`, `pool` and `family`, sorted by `id`. Changing any case changes its
 * digest and so the set's digest. Duplicate IDs and an empty set are errors.
 */
export declare function caseSetDigest(entries: readonly unknown[]): Promise<Digest>;
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
export declare function verifyConfiguration(input: unknown, at?: string): Promise<LinkError[]>;
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
}>, at?: string): Promise<LinkError[]>;
//# sourceMappingURL=identity.d.ts.map