import type * as z from "zod";
/** Permit new fields on the wire while requiring the parts we act on to be known. */
export declare function readWorkerRecord<T>(id: string, schema: z.ZodType<T>, value: unknown): T | undefined;
//# sourceMappingURL=worker-record.d.ts.map