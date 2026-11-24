import { AnalysisLock, AnalysisPlan, type TrialReductionRegistration } from "../contracts/records/analysis-plan.ts";
import type { Case, CaseSet } from "../contracts/records/case.ts";
import type { MustNeverDeclaration } from "../contracts/records/must-never.ts";
import type { Configuration } from "../contracts/records/configuration.ts";
/** The smallest decision horizon with one extra block. */
export declare function defaultBlocks(primaryComparisons: number, alpha: number): number;
export declare function checkCases(caseSet: CaseSet, cases: readonly Case[]): void;
/** Planned calls for the block horizon, before any retries. */
export declare function blockCalls(cases: number, comparisons: number, blocks: number, replicates: number): number;
export interface AnalysisInput {
    readonly suite: string;
    readonly suiteDigest: string;
    readonly caseSet: CaseSet;
    readonly base: Configuration;
    readonly estimand?: AnalysisPlan["estimand"] | undefined;
    readonly alpha?: number | undefined;
    readonly blocks?: number | undefined;
    readonly replicates?: number | undefined;
    readonly primary: AnalysisPlan["primary"];
    readonly secondary: AnalysisPlan["secondary"];
    readonly hardGates: AnalysisPlan["hardGates"];
    readonly measures: AnalysisPlan["measures"];
    readonly applicability: AnalysisPlan["applicability"];
    readonly trialReduction?: TrialReductionRegistration | undefined;
    readonly mustNever?: readonly MustNeverDeclaration[] | undefined;
    readonly maxCalls?: number | undefined;
    readonly policy?: AnalysisPlan["policy"] | undefined;
    readonly ichnaea: string;
}
export declare function resolveAnalysis(input: AnalysisInput): AnalysisPlan;
export declare function lockFor(plan: AnalysisPlan): AnalysisLock;
//# sourceMappingURL=analysis.d.ts.map