import type * as z from "zod";
import { type DataClass } from "./data-class.ts";
/**
 * What a destination accepts: one purpose and the most sensitive class it may receive. `grants`
 * lets a deployment allow more purposes for named fields (JSON pointers into the record, `*` for
 * any array index or record key), for example after recording a basis for rater pseudonyms. A
 * grant never lifts the class limit.
 */
export interface EgressContext {
    /** The purpose for which the record leaves, such as `PU-2`. */
    readonly purpose: string;
    /** The most sensitive data class the destination may receive. */
    readonly maxClass: DataClass;
    /** Extra purposes that the deployment allows for the fields at the given JSON pointers. */
    readonly grants?: ReadonlyArray<{
        readonly path: string;
        readonly purposes: readonly string[];
    }>;
}
/** A record reduced to the fields that may cross a boundary, with the paths that were dropped. */
export interface EgressProjection {
    /** The projected record, or `undefined` when the record as a whole is dropped. */
    readonly value: unknown;
    /** The JSON pointers of the dropped values, `/` for the whole record. */
    readonly dropped: readonly string[];
}
/**
 * Projects a record onto the fields that may leave for one purpose (REQ-135).
 *
 * The projection is an allow-list walk of the schema. A value passes only where the schema
 * defines it, its data policy permits the purpose, its class is within the destination's maximum,
 * and it has the type the schema expects. Anything else is dropped: unknown members, members
 * without a policy, values of the wrong type, and union values that match no option. Content
 * fields take the class the record declares in `dataClass`; a record without one is treated as
 * `special`. Opaque content (a JSON payload) leaves whole only when its policy permits it.
 *
 * Use it with `maxClass: "special"` to filter by purpose alone at ingest.
 */
export declare function projectForEgress(schema: z.ZodType, record: unknown, context: EgressContext): EgressProjection;
//# sourceMappingURL=egress.d.ts.map