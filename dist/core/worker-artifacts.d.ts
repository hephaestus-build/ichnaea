import type { Trial } from "../contracts/records/trial.ts";
import type { TrialResult } from "../contracts/records/worker.ts";
type Saved = {
    readonly evidence: NonNullable<Trial["evidence"]>;
} | {
    readonly failure: NonNullable<TrialResult["failure"]>;
};
/** Store separate copies with safe relative references and digests of their contents. */
export declare function captureArtifacts(runDirectory: string, workdir: string, artifacts: NonNullable<TrialResult["artifacts"]>): Promise<Saved>;
export {};
//# sourceMappingURL=worker-artifacts.d.ts.map