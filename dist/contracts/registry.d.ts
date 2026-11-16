import type * as z from "zod";
/** Stability level of a record schema (OpenTelemetry levels; names never encode the stage). */
export type Stability = "development" | "alpha" | "beta" | "stable";
/** One record contract: its schema identifier, zod schema and stability. */
export interface RecordContract {
    /** The record's name, such as `caseSet`; it names the generated JSON Schema files. */
    readonly name: string;
    /**
     * The schema identifier, such as `ichnaea.case/1`, that a record of this kind carries in
     * `schema`.
     */
    readonly id: string;
    /** The zod schema that a writer validates the record against. */
    readonly schema: z.ZodType;
    /** The stability level of the schema. */
    readonly stability: Stability;
    /** One sentence that says what the record is, for the generated JSON Schema. */
    readonly description: string;
}
/** Every record contract, by name. The generated JSON Schema files follow this list. */
export declare const RECORD_CONTRACTS: readonly RecordContract[];
/** Returns the contract for a schema identifier such as `ichnaea.trial/1`. */
export declare function contractFor(id: string): RecordContract | undefined;
//# sourceMappingURL=registry.d.ts.map