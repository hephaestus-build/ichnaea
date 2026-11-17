/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) and SHA-256 content digests.
 *
 * JCS sorts object members by the UTF-16 code units of their names and serialises numbers with
 * the ECMAScript Number-to-String algorithm, which `JSON.stringify` implements. Records hold
 * standard JSON only (REQ-04), so a non-finite number, `undefined`, a function, a symbol or a
 * bigint is an error here, never a silent `null`.
 */
/** Thrown when a value has no JSON representation. */
export declare class NonJsonValueError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "NonJsonValueError";
    /** The JSON pointer of the offending value. */
    readonly path: string;
    constructor(path: string, what: string);
}
/**
 * Returns the RFC 8785 canonical JSON text of a value.
 *
 * Object members whose value is `undefined` are omitted, as `JSON.stringify` does, because an
 * optional field that is absent and one that is `undefined` are the same record.
 */
export declare function canonicalize(value: unknown): string;
/**
 * Returns `sha256:<hex>` of the UTF-8 bytes of a string. A string with a lone surrogate has no
 * UTF-8 form (a text encoder would replace it with U+FFFD, so two different strings would share a
 * digest), so it throws a `TypeError`.
 */
export declare function sha256(text: string): `sha256:${string}`;
/** Returns the canonical content digest of a JSON value: SHA-256 over its RFC 8785 form. */
export declare function digest(value: unknown): `sha256:${string}`;
//# sourceMappingURL=canonical.d.ts.map