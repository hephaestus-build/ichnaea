import * as z from "zod";
import { digest as rawDigest, NonJsonValueError, sha256 } from "./canonical.js";
import { Case, CaseSetEntry } from "./records/case.js";
import { Configuration } from "./records/configuration.js";
import { InstrumentPin } from "./records/lock.js";
import { ProjectConfig } from "./records/project.js";
import { MeasureDefinition } from "./records/lock-vocabulary.js";
/** Thrown when a record cannot have a well-defined identity. */
export class IdentityError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "IdentityError";
}
/**
 * The digest projections (normative, frozen). Every member the writer schema defines is either in
 * `members` or in `excluded`, and a test holds that. A projection keeps the listed members as
 * written. The values of `provenance` (in a case) and of each prompt (in a configuration) are
 * projected by their own rule; every other value is hashed whole, so a member added inside it by a
 * later minor version changes the digest. Changing a rule is a new major version. Decisions 0002
 * (case digests) and 0003 (configuration identity) in docs/decisions give the reasons.
 */
export const DIGEST_RULES = {
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
            schema: "The major version. A major that keeps this projection keeps identities; one that changes it is listed in majors.json, and its migration recomputes them.",
            id: "Where the case sits in its set. A case copied under a new ID keeps its digest, so a screened case cannot pass as new; the set entry hashes the ID.",
            pool: "Where the case sits in its set. Moving a screened case into another pool keeps its digest; the set entry hashes the pool.",
            caseSet: "A pointer to the set that holds the case. The same case in another set, or in a renamed set, keeps its digest, so a case is traced by its digest across sets. The set's own digest covers its membership.",
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
            schema: "The major version. A major that keeps this projection keeps identities; one that changes it is listed in majors.json, and its migration recomputes them.",
            description: "Prose for people. Behaviour is pinned by models, parameters, prompts and factors.",
            label: "A name for people.",
            informational: "Values that do not decide behaviour, such as a provider fingerprint seen at resolution.",
        },
    },
    prompt: {
        members: ["name", "digest", "status"],
        excluded: {
            template: "The text that `digest` pins. A configuration with the text and one without it are the same configuration; verifyConfiguration checks the text against the digest.",
            uri: "Where the template was resolved from. Two resolutions of one template give one identity.",
        },
    },
};
function digest(value) {
    try {
        return rawDigest(value);
    }
    catch (error) {
        // A record can validate and still be unhashable (a lone surrogate in a string).
        if (error instanceof NonJsonValueError)
            throw new IdentityError(`the record has no canonical form: ${error.message}`);
        throw error;
    }
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Keeps only the listed own members. Object.fromEntries keeps a `__proto__` member as data. */
function pick(value, members) {
    if (!isObject(value))
        throw new IdentityError("a digested record must be a JSON object");
    return Object.fromEntries(members.filter((m) => Object.hasOwn(value, m)).map((m) => [m, value[m]]));
}
function compare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
function sortedUnique(items, key, what) {
    const list = items;
    const seen = new Set();
    for (const item of list) {
        const name = item[key];
        if (seen.has(name))
            throw new IdentityError(`duplicate ${what} '${name}': the identity would depend on order`);
        seen.add(name);
    }
    return list.toSorted((a, b) => compare(a[key], b[key]));
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
export function configurationIdentity(input) {
    const [mismatch] = verifyConfiguration(input);
    if (mismatch) {
        const template = mismatch.path.replace(/\/digest$/, "/template");
        throw new IdentityError(mismatch.problem === undefined
            ? `the template at ${template} does not match its digest`
            : `the template at ${template} cannot be hashed: ${mismatch.problem}`);
    }
    const projection = pick(input, DIGEST_RULES.configuration.members);
    projection["models"] = sortedUnique(projection["models"], "role", "model role");
    projection["parameters"] = sortedUnique(projection["parameters"], "name", "parameter");
    projection["prompts"] = sortedUnique(projection["prompts"].map((p) => pick(p, DIGEST_RULES.prompt.members)), "name", "prompt");
    return digest(projection);
}
/**
 * Returns the digest of a case (REQ-10): the case restricted to `DIGEST_RULES.case`, with its
 * provenance restricted to `DIGEST_RULES.provenance`. Everything that decides what a case asks, how
 * it is graded and which analysis it supports enters it; the author pointer and the review status
 * do not.
 */
export function caseDigest(input) {
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
export function caseSetDigest(entries) {
    if (entries.length === 0)
        throw new IdentityError("a case set has at least one case");
    for (const entry of entries)
        CaseSetEntry.parse(entry);
    const projected = entries.map((e) => pick(e, DIGEST_RULES.caseSetEntry.members));
    return digest(sortedUnique(projected, "id", "case id"));
}
/**
 * Checks the values a configuration records but does not hash: a prompt's `template`, when
 * present, must be well-formed Unicode and have the prompt's `digest`, the SHA-256 of the
 * template's UTF-8 bytes. A template with a lone surrogate has no UTF-8 form, so it never matches.
 */
export function verifyConfiguration(input, at = "") {
    const config = Configuration.parse(input);
    const errors = [];
    for (const [i, prompt] of config.prompts.entries()) {
        if (prompt.template === undefined)
            continue;
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
        if (computed !== prompt.digest)
            errors.push({ path, stored: prompt.digest, computed });
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
export function verifyArms(arms, at = "/arms") {
    const errors = [];
    for (const [i, arm] of arms.entries()) {
        const path = `${at}/${i}`;
        try {
            const templates = verifyConfiguration(arm.configuration, `${path}/configuration`);
            errors.push(...templates);
            if (templates.length > 0)
                continue;
            const computed = configurationIdentity(arm.configuration);
            if (computed !== arm.identity)
                errors.push({ path: `${path}/identity`, stored: arm.identity, computed });
        }
        catch (error) {
            if (!(error instanceof IdentityError || error instanceof z.ZodError))
                throw error;
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
function withoutSchemaPointer(record) {
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$schema"));
}
/**
 * The digest of a project config (`ichnaea.project/1`): SHA-256 over the RFC 8785 canonical JSON
 * of the record without its `$schema` member, as for a suite.
 */
export function projectDigest(input) {
    return digest(withoutSchemaPointer(ProjectConfig.parse(input)));
}
/**
 * The digest of a measure's definition: SHA-256 over the RFC 8785 canonical JSON of the measure's
 * definition pinned by the legacy lock, which holds its value type, what computes it and the cases
 * it applies to. It is the first part of a measure's identity; `implementation` is the second.
 */
export function measureDefinitionDigest(definition) {
    return digest(MeasureDefinition.parse(definition));
}
/**
 * The implementation digest of a measure that an instrument process computes: the digest of the
 * instrument's pin in the lock, so a change to its files, its image or its judge identity changes
 * it.
 */
export function instrumentImplementation(pin) {
    return digest(InstrumentPin.parse(pin));
}
//# sourceMappingURL=identity.js.map