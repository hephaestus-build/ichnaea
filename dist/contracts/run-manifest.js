import * as z from "zod";
import { Digest, SemVer } from "./primitives.js";
/** Digests of the inputs and the original decision. */
export const RunManifest = z.strictObject({
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
//# sourceMappingURL=run-manifest.js.map