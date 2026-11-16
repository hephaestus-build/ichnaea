import type { RecordContract } from "./registry.ts";
/** The JSON Schema `$id` of a record contract. Reader schemas add `:reader`. */
export declare function schemaUri(contract: RecordContract, variant?: "writer" | "reader"): string;
/**
 * Generates the normative writer JSON Schema 2020-12 of a record contract. Writers are strict: an
 * unknown member is an error, so a misspelt or misplaced member cannot pass unnoticed or leave an
 * identity unchanged. The reader schema (`toReaderJsonSchema`) accepts unknown members.
 */
export declare function toJsonSchema(contract: RecordContract): Record<string, unknown>;
/**
 * The reader variant of a record's JSON Schema (REQ-05): every enumeration of strings becomes a
 * plain string with the known values kept as the `x-ichnaea-known` annotation, and every tagged union
 * gains a fallback option for a kind a later minor version adds. Other constants (the `schema`
 * field) stay strict.
 */
export declare function toReaderJsonSchema(contract: RecordContract): Record<string, unknown>;
//# sourceMappingURL=json-schema.d.ts.map