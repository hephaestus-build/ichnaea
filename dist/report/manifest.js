import { digest } from "../contracts/canonical.js";
/** Use canonical record digests so formatting does not affect replay identity. */
export function runManifest(records, decision, aa = []) {
    return {
        schema: "ichnaea.run-manifest/1",
        ichnaea: decision.ichnaea,
        inputs: {
            plan: digest(records.plan),
            run: digest(records.run),
            trials: digest(records.trials),
            values: digest(records.values),
            gates: digest(records.gates),
            aa: digest(aa),
        },
        decision: digest(decision),
    };
}
/** A later calculation has a reproducible identity and retains its original manifest. */
export function recalculation(manifest, decision) {
    const source = digest(manifest);
    return {
        schema: "ichnaea.recalculation/1",
        identity: digest({ manifest: source, ichnaea: decision.ichnaea, decision: digest(decision) }),
        manifest: source,
        decision,
    };
}
//# sourceMappingURL=manifest.js.map