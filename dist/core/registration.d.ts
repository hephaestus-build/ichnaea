import * as z from "zod";
import { Seed } from "../contracts/primitives.ts";
export interface RegistrationReceipt {
    readonly run: string;
    readonly base: string;
    readonly candidate?: string | undefined;
    readonly seed: z.infer<typeof Seed>;
    readonly at: string;
    readonly planPath: string;
    readonly planCommit: string;
    readonly planFileDigest: string;
    readonly remote: string;
    readonly ref: string;
    readonly remoteSha: string;
}
/** The receipt written before dispatch, bound to the arms and seed at run start. */
export declare const RegistrationReceiptSchema: z.ZodType<RegistrationReceipt>;
export type RegistrationLabel = "registered" | "unregistered" | "exploratory";
export declare function registrationLabel(source: "runner" | "import" | "re-score", randomized: boolean, receipt?: RegistrationReceipt): RegistrationLabel;
export declare function anchorAnalysisPlan(cwd: string, plan: string, anchor: string, arms: Pick<RegistrationReceipt, "run" | "base" | "candidate" | "seed" | "at">): Promise<RegistrationReceipt | undefined>;
//# sourceMappingURL=registration.d.ts.map