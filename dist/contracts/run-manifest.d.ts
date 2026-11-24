import * as z from "zod";
/** Digests of the inputs and the original decision. */
export declare const RunManifest: z.ZodType<RunManifest>;
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
//# sourceMappingURL=run-manifest.d.ts.map