import type * as z from "zod";
/** Stability level of a record schema (OpenTelemetry levels; names never encode the stage). */
export type Stability = "development" | "alpha" | "beta" | "stable";
/** One record contract: its schema identifier, zod schema and stability. */
export interface RecordContract {
    readonly name: string;
    readonly id: string;
    readonly schema: z.ZodType;
    readonly stability: Stability;
    readonly description: string;
}
/** Every record contract, by name. The generated JSON Schema files follow this list. */
export declare const RECORD_CONTRACTS: readonly RecordContract[];
/** Returns the contract for a schema identifier such as `ichnaea.trial/1`. */
export declare function contractFor(id: string): RecordContract | undefined;
//# sourceMappingURL=registry.d.ts.map