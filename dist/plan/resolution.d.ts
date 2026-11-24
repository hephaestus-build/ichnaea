import { Resolution } from "../contracts/records/resolution.ts";
import type { AnalysisPlan } from "../contracts/records/analysis-plan.ts";
import type { RunRecords } from "../contracts/run-records.ts";
/** Locks planning resolution using a matching A/A pilot or the default simulation model. */
export declare function planResolution(analysis: AnalysisPlan, fixedBlocks: boolean, maxCalls: number | undefined, pilot: RunRecords | undefined): Pick<AnalysisPlan, "blocks" | "maxCalls" | "resolution" | "pilot">;
/** Computes the run-time statement from the observed base arm if the plan had no pilot. */
export declare function runResolution(analysis: AnalysisPlan, rates: (measure: string) => ReadonlyMap<string, number>, invalid: boolean): Resolution[];
/** Renders the estimate and its model in one line. */
export declare function resolutionLine(entry: Resolution, measure?: string): string;
//# sourceMappingURL=resolution.d.ts.map