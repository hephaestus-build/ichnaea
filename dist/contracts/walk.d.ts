import * as z from "zod";
import { type DataPolicy } from "./data-class.ts";
/** The zod definition type of a schema, for structural walks. */
export declare function defType(schema: z.ZodType): string;
/** Returns the data policy recorded on a schema or on the schema it wraps (optional, nullable). */
export declare function policyOf(schema: z.ZodType): DataPolicy | undefined;
/** Returns the inner schema of an optional or nullable wrapper. */
export declare function wrapped(schema: z.ZodType): z.ZodType | undefined;
/** Removes optional, nullable and readonly wrappers. */
export declare function unwrap(schema: z.ZodType): z.ZodType;
/** Returns the children of a schema, with a label for error messages. */
export declare function children(schema: z.ZodType): Array<[string, z.ZodType]>;
//# sourceMappingURL=walk.d.ts.map