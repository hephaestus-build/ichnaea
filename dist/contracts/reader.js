import * as z from "zod";
import { toReaderJsonSchema } from "./json-schema.js";
/** Whether a tolerantly read tagged value has one of the kinds this version knows. */
export function isKnownKind(value, tag, known) {
    return known.includes(value[tag]);
}
const readers = new Map();
/**
 * The reader zod schema of a contract, built from the reader JSON Schema so that zod and every
 * other validator of the reader schema agree by construction.
 */
export function readerSchema(contract) {
    let reader = readers.get(contract.id);
    if (!reader) {
        reader = z.fromJSONSchema(toReaderJsonSchema(contract));
        readers.set(contract.id, reader);
    }
    return reader;
}
function hasLoneSurrogate(value) {
    if (typeof value === "string")
        return !value.isWellFormed();
    if (Array.isArray(value))
        return value.some(hasLoneSurrogate);
    if (value && typeof value === "object")
        return Object.entries(value).some(([k, v]) => !k.isWellFormed() || hasLoneSurrogate(v));
    return false;
}
/**
 * Reads a record tolerantly (REQ-05). It validates against the reader schema: unknown members are
 * ignored, a string outside a known enumeration and a tagged-union kind the writer schema does not
 * know are accepted and reported in `unknownValues`, and unknown members in `unknownMembers`. The `schema` field and other constants stay
 * strict. Strings must be well-formed Unicode, because a record must stay hashable.
 *
 * A schema cannot compare two values, so reading does not check a prompt template against its
 * digest or a stored identity against its configuration. `verifyConfiguration` and `verifyArms`
 * do.
 */
export function readRecord(contract, value) {
    const read = readerSchema(contract).safeParse(value);
    if (!read.success)
        return { ok: false, error: read.error };
    if (hasLoneSurrogate(value)) {
        return {
            ok: false,
            error: new z.ZodError([
                { code: "custom", path: [], message: "lone surrogate in a string", input: value },
            ]),
        };
    }
    const strict = contract.schema.safeParse(value);
    const issues = strict.success ? [] : meantIssues(strict.error.issues);
    const unknownMembers = issues.flatMap((i) => i.code === "unrecognized_keys" ? i.keys.map((k) => [...i.path, k]) : []);
    const unknownValues = issues
        .filter((i) => i.code !== "unrecognized_keys")
        .map((i) => ({ path: i.path, value: valueAt(value, i.path) }));
    return { ok: true, record: structuredClone(value), unknownValues, unknownMembers };
}
/** How many unknown members a union option's issues name. */
function unknownCount(option) {
    return option.reduce((n, i) => n + (i.code === "unrecognized_keys" ? i.keys.length : 0), 0);
}
/**
 * The issues of the option that a value meant, inside an untagged union. Of the options that fail
 * only on unknown members, the one that leaves the fewest members unknown is the one meant, when
 * exactly one does. Its unknown members are reported as such, with the union's path in front.
 * Otherwise the union stays one issue: an unknown value.
 */
function meantIssues(issues) {
    return issues.flatMap((issue) => {
        if (issue.code !== "invalid_union")
            return [issue];
        const near = issue.errors.filter((option) => option.every((i) => i.code === "unrecognized_keys"));
        const fewest = Math.min(...near.map(unknownCount));
        const meant = near.filter((option) => unknownCount(option) === fewest);
        if (meant.length !== 1)
            return [issue];
        return meantIssues(meant[0].map((i) => ({ ...i, path: [...issue.path, ...i.path] })));
    });
}
function valueAt(root, path) {
    let node = root;
    for (const key of path)
        node = node?.[key];
    return node;
}
//# sourceMappingURL=reader.js.map