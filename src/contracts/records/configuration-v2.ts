import * as z from "zod";

import { none } from "../data-class.ts";
import { Digest, Json, Text } from "../primitives.ts";

/**
 * An arm's configuration (`ichnaea.configuration/2`): the digest of the whole configuration file
 * that the arm's worker read, plus only the fields that the suite allow-lists in
 * `configuration.record`. The digest is SHA-256 over the file's RFC 8785 canonical JSON, never its
 * raw bytes, so files that differ only in comments or layout share it. Ichnaea sends the worker the
 * path of that canonical file, so the worker's `observed.configuration` equals this digest. A
 * configuration file holds no secret, so neither does this record.
 */
export const ConfigurationV2 = z.strictObject({
  schema: none(
    z.literal("ichnaea.configuration/2").describe("The record type and its major version."),
  ),
  digest: none(
    Digest.describe("SHA-256 over the RFC 8785 canonical JSON of the whole configuration file."),
  ),
  fields: none(
    z
      .record(Text, Json)
      .describe("The allow-listed fields of the file, such as model, temperature or prompt."),
  ),
});
/** An arm configuration at major 2. */
export type ConfigurationV2 = z.infer<typeof ConfigurationV2>;
