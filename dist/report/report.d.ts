import { type RatingSet } from "../calibration/ratings-agreement.ts";
import type { RunManifest } from "../contracts/run-manifest.ts";
import type { Run } from "../contracts/records/run.ts";
import { type Recalculation } from "./manifest.ts";
import { type DecisionRecords } from "./recompute.ts";
import { type DecisionView } from "./view.ts";
/** Thrown when the decision cannot be verified or its report breaks the wording rules. */
export declare class ReportError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "ReportError";
}
/** What `report` renders. */
export interface ReportOptions {
    /** `markdown` for a summary, `html` for a page, `json` for the view model that both render. */
    readonly format: "markdown" | "html" | "json";
    /** The suite's name in the title. Default: the run, as `run <id>`. */
    readonly suite?: string;
    /** The run's lineage, shown in the footer. Default: none beyond the decision's own. */
    readonly lineage?: Run["lineage"];
    /** Canonical ratings for a descriptive agreement section. */
    readonly ratings?: RatingSet;
}
/** A run and its sealed digests, if they were recorded by the deciding engine. */
export interface ReportRecords extends DecisionRecords {
    /** Sealed digests of the input records and the original decision. */
    readonly manifest?: RunManifest;
}
/** Verify the inputs before creating any public view, using the current engine when requested. */
export declare function verifiedReport(records: ReportRecords, options?: Omit<ReportOptions, "format">, engine?: string): {
    view: DecisionView;
    neutral: DecisionView;
    recalculation?: Recalculation;
};
/** Build the public view after replay or digest verification. */
export declare function decisionView(records: ReportRecords): DecisionView;
/** Render a verified decision synchronously, with no file access. */
export declare function report(records: ReportRecords, options: ReportOptions): string;
/** Render one of the outputs from the verified view and its wording check. */
export declare function renderReport({ view, neutral }: Pick<ReturnType<typeof verifiedReport>, "view" | "neutral">, format: ReportOptions["format"]): string;
//# sourceMappingURL=report.d.ts.map