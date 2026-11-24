import * as z from "zod";
import { Verdict } from "../contracts/records/decision.ts";
type Purpose = "development" | "regression" | "confirmation";
type HistoryKey = {
    suite: string;
    caseSet: string;
    base: string;
};
type IndexEntry = HistoryKey & {
    run: string;
    candidate: string;
    decidedAt: string;
    verdict: z.infer<typeof Verdict> | null;
};
/** A checkout of the team's records repository. Rows contain class-none identifiers only. */
export declare class RecordsRepository {
    #private;
    private constructor();
    static open(path: string): Promise<RecordsRepository>;
    /** Records case use before dispatch. A failed run leaves every reservation it made spent. */
    recordReads(run: string, purpose: Purpose, digests: readonly string[]): Promise<void>;
    appendDecision(input: IndexEntry): Promise<void>;
    earlierCandidates(key: HistoryKey): Promise<IndexEntry[]>;
}
/** Use the configured checkout to reserve case reads before any worker dispatch. */
export declare function reserveCaseReads(records: string | undefined, run: string, purpose: Purpose, digests: readonly string[]): Promise<RecordsRepository | undefined>;
export {};
//# sourceMappingURL=records-repository.d.ts.map