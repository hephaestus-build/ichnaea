import * as z from "zod";

import { Digest, SemVer } from "./primitives.ts";

/** Digests of the inputs and the original decision. */
export const RunManifest: z.ZodType<RunManifest> = z.strictObject({
  schema: z.literal("ichnaea.run-manifest/1"),
  ichnaea: SemVer,
  inputs: z.strictObject({
    plan: Digest,
    run: Digest,
    trials: Digest,
    values: Digest,
    gates: Digest,
    aa: Digest,
  }),
  decision: Digest,
});

/** The manifest stored with the first decision. */
export interface RunManifest {
  readonly schema: "ichnaea.run-manifest/1";
  readonly ichnaea: string;
  readonly inputs: {
    readonly plan: string;
    readonly run: string;
    readonly trials: string;
    readonly values: string;
    readonly gates: string;
    readonly aa: string;
  };
  readonly decision: string;
}
