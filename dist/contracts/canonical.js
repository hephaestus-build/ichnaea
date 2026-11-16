/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) and SHA-256 content digests.
 *
 * JCS sorts object members by the UTF-16 code units of their names and serialises numbers with
 * the ECMAScript Number-to-String algorithm, which `JSON.stringify` implements. Records hold
 * standard JSON only (REQ-04), so a non-finite number, `undefined`, a function, a symbol or a
 * bigint is an error here, never a silent `null`.
 */
/** Thrown when a value has no JSON representation. */
export class NonJsonValueError extends Error {
    name = "NonJsonValueError";
    /** The JSON pointer of the offending value. */
    path;
    constructor(path, what) {
        super(`Value at '${path || "/"}' is not JSON: ${what}. Encode non-finite numbers as { "nonFinite": "nan" | "inf" | "-inf" }.`);
        this.path = path;
    }
}
function escapePointer(segment) {
    return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
function serialise(value, path, seen) {
    if (value === null)
        return "null";
    switch (typeof value) {
        case "boolean":
            return value ? "true" : "false";
        case "string":
            if (!value.isWellFormed())
                throw new NonJsonValueError(path, "lone surrogate in string");
            return JSON.stringify(value);
        case "number":
            if (!Number.isFinite(value))
                throw new NonJsonValueError(path, String(value));
            return JSON.stringify(value);
        case "object":
            break;
        default:
            throw new NonJsonValueError(path, typeof value);
    }
    const object = value;
    if (seen.has(object))
        throw new NonJsonValueError(path, "circular reference");
    seen.add(object);
    let out;
    if (Array.isArray(object)) {
        const items = [];
        for (let index = 0; index < object.length; index++) {
            if (!Object.hasOwn(object, index))
                throw new NonJsonValueError(`${path}/${index}`, "hole in sparse array");
            items.push(serialise(object[index], `${path}/${index}`, seen));
        }
        out = `[${items.join(",")}]`;
    }
    else {
        const proto = Object.getPrototypeOf(object);
        if (proto !== Object.prototype && proto !== null) {
            throw new NonJsonValueError(path, `instance of ${object.constructor.name}`);
        }
        if (Object.getOwnPropertySymbols(object).length > 0)
            throw new NonJsonValueError(path, "symbol key");
        const entries = Object.entries(object).filter(([, v]) => v !== undefined);
        for (const [key] of entries) {
            if (!key.isWellFormed())
                throw new NonJsonValueError(path, "lone surrogate in member name");
        }
        // Default string comparison orders by UTF-16 code units, as RFC 8785 § 3.2.3 requires.
        entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        out = `{${entries
            .map(([k, v]) => `${JSON.stringify(k)}:${serialise(v, `${path}/${escapePointer(k)}`, seen)}`)
            .join(",")}}`;
    }
    seen.delete(object);
    return out;
}
/**
 * Returns the RFC 8785 canonical JSON text of a value.
 *
 * Object members whose value is `undefined` are omitted, as `JSON.stringify` does, because an
 * optional field that is absent and one that is `undefined` are the same record.
 */
export function canonicalize(value) {
    return serialise(value, "", new Set());
}
const encoder = new TextEncoder();
/**
 * Returns `sha256:<hex>` of the UTF-8 bytes of a string. A string with a lone surrogate has no
 * UTF-8 form (a text encoder would replace it with U+FFFD, so two different strings would share a
 * digest), so it throws a `TypeError`.
 */
export async function sha256(text) {
    if (!text.isWellFormed())
        throw new TypeError("cannot hash a string with a lone surrogate: it has no UTF-8 form");
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
    let hex = "";
    for (const byte of new Uint8Array(bytes))
        hex += byte.toString(16).padStart(2, "0");
    return `sha256:${hex}`;
}
/** Returns the canonical content digest of a JSON value: SHA-256 over its RFC 8785 form. */
export function digest(value) {
    return sha256(canonicalize(value));
}
//# sourceMappingURL=canonical.js.map