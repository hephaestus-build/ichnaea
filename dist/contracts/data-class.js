/**
 * The metadata key that carries a field's data policy, both in zod metadata and in the
 * generated JSON Schema (as an annotation keyword).
 */
export const DATA_POLICY_KEY = "x-ichnaea-data";
/** Personal-data classes, ordered from least to most sensitive. */
export const DATA_CLASSES = ["none", "pseudonymous", "personal", "special"];
/** What kind of identifier a field is, for redaction and release checks. */
export const IDENTIFIER_KINDS = ["none", "direct", "quasi", "content"];
/**
 * The purposes of processing (the governance purpose catalogue). PU-1 is offline evaluation on
 * synthetic, licensed or own data; PU-2 production sampling for automatic judging; PU-3 human
 * rating of production outputs; PU-4 promotion of confirmed production failures into cases; PU-5
 * research use including publication; PU-6 sharing outside the controller.
 */
export const PURPOSES = ["PU-1", "PU-2", "PU-3", "PU-4", "PU-5", "PU-6"];
/** The purpose wildcard: the field may leave for any purpose, within its class. */
export const ANY_PURPOSE = "*";
/**
 * Retention rules. `record`: the field lives as long as its record in its store. `subject`: the
 * field also goes when the person it refers to is erased, through the lineage closure.
 */
export const RETENTION_RULES = ["record", "subject"];
function withPolicy(schema, policy, extra = {}) {
    return schema.meta({ ...extra, [DATA_POLICY_KEY]: policy });
}
/**
 * Marks a closed enumeration, which readers do not widen: a value set fixed by its definition
 * (IEEE 754's non-finite values), or one whose unknown values must fail closed (the trial outcomes,
 * so no reader decides a run from an outcome it does not know). Tolerant readers widen every other
 * enumeration.
 */
export const CLOSED_KEY = "x-ichnaea-closed";
/** A field without personal data. It may leave for any purpose. */
export function none(schema, extra = {}) {
    return withPolicy(schema, { class: "none", identifier: "none", egress: [ANY_PURPOSE], retention: "record" }, extra);
}
/** Content whose class the enclosing record declares in `dataClass`. */
export function content(schema) {
    return withPolicy(schema, {
        class: "inherit",
        identifier: "content",
        egress: [ANY_PURPOSE],
        retention: "subject",
    });
}
/**
 * A quasi-identifying attribute whose class the record declares in `dataClass`, such as a slice
 * value: harmless on a synthetic case, identifying in combination on collected data.
 */
export function attribute(schema) {
    return withPolicy(schema, {
        class: "inherit",
        identifier: "quasi",
        egress: [ANY_PURPOSE],
        retention: "subject",
    });
}
/** A keyed pseudonym (still personal data). It leaves only for the listed purposes. */
export function pseudonym(schema, egress = []) {
    return withPolicy(schema, {
        class: "pseudonymous",
        identifier: "direct",
        egress,
        retention: "subject",
    });
}
/** A quasi-identifier such as a pointer into an application or a join key. */
export function quasi(schema, egress = []) {
    return withPolicy(schema, {
        class: "pseudonymous",
        identifier: "quasi",
        egress,
        retention: "subject",
    });
}
/** A direct identifier of a person, such as a name. It leaves only for the listed purposes. */
export function personal(schema, egress = []) {
    return withPolicy(schema, {
        class: "personal",
        identifier: "direct",
        egress,
        retention: "subject",
    });
}
/** Returns the rank of a class, for comparisons. */
export function classRank(dataClass) {
    return DATA_CLASSES.indexOf(dataClass);
}
//# sourceMappingURL=data-class.js.map