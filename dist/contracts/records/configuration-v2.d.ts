import * as z from "zod";
/**
 * An arm's configuration (`ichnaea.configuration/2`): the digest of the whole configuration file
 * that the arm's worker read, plus only the fields that the suite allow-lists in
 * `configuration.record`. The digest is SHA-256 over the file's RFC 8785 canonical JSON, never its
 * raw bytes, so files that differ only in comments or layout share it. Ichnaea sends the worker the
 * path of that canonical file, so the worker's `observed.configuration` equals this digest. A
 * configuration file holds no secret, so neither does this record.
 */
export declare const ConfigurationV2: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.configuration/2">;
    digest: z.ZodString;
    fields: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
/** An arm configuration at major 2. */
export type ConfigurationV2 = z.infer<typeof ConfigurationV2>;
//# sourceMappingURL=configuration-v2.d.ts.map