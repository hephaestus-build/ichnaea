import { AnalysisLock, AnalysisPlan } from "../contracts/records/analysis-plan.ts";
import { Case, CaseSet } from "../contracts/records/case.ts";
import { Plan } from "../contracts/records/plan.ts";
import { Configuration } from "../contracts/records/configuration.ts";
import type { RunRecords } from "../contracts/run-records.ts";
import type { Host } from "./host.ts";
import { type ArmDefinition, SuiteDefinition } from "../contracts/records/suite-definition.ts";
/** The configured inputs to a plan. */
export interface PlanSuiteInput {
    /** The suite and its arm definitions. */
    readonly suite: SuiteDefinition;
    /** The loaded measure and gate contributions. */
    readonly host: Host;
    /** The directory for paths in the suite configuration. */
    readonly directory: string;
    /** The version recorded in the analysis plan. */
    readonly ichnaea: string;
    /** Optional noise run used for the planning model. */
    readonly pilot?: RunRecords;
}
/** The two records that the plan command writes. */
export interface PlannedSuite {
    /** The candidate-independent analysis. */
    readonly plan: AnalysisPlan;
    /** The case and instrument pins. */
    readonly lock: AnalysisLock;
}
export declare function suiteCases(suite: SuiteDefinition, directory: string): Promise<{
    readonly cases: readonly Case[];
    readonly caseSet: CaseSet;
}>;
export declare function armConfiguration(definition: ArmDefinition, directory: string): Promise<Configuration>;
/** Resolves the case and measure pins without reading or binding a candidate. */
export declare function planSuite(input: PlanSuiteInput): Promise<PlannedSuite>;
export declare function readLockedPlan(path: string): Promise<AnalysisPlan>;
/** Writes the authoring plan and the single lock beside the suite configuration. */
export declare function writeAnalysis(directory: string, planned: PlannedSuite, frozen: boolean): Promise<void>;
export interface LockedImport {
    readonly planPath: string;
    readonly definition: SuiteDefinition;
    readonly directory: string;
}
export declare function bindImportedPlan(input: LockedImport, host: Host, options: Pick<Plan, "trigger" | "varies" | "createdAt" | "ichnaea"> & {
    readonly seed: number;
}): Promise<{
    readonly cases: readonly Case[];
    readonly plan: Plan;
}>;
//# sourceMappingURL=analysis-plan.d.ts.map