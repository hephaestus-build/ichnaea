import * as z from "zod";
import { CLOSED_KEY, none } from "../data-class.js";
import { Digest } from "../primitives.js";
import { MeasureOutcome, Validity } from "./decision.js";
const text = () => none(z.string());
const count = () => none(z.int().nonnegative());
const noise = MeasureOutcome.shape.noise.unwrap();
/** The exit-2 document that a CLI consumer can handle without parsing a diagnostic. */
export const CliErrorRecord = z.strictObject({
    schema: none(z.literal("ichnaea.cli.error/1")),
    code: none(z.enum(["USAGE", "CONFIGURATION", "RECOMPUTE_MISMATCH", "RECORDS", "COMMAND_FAILED"]), {
        [CLOSED_KEY]: true,
    }),
    message: text(),
});
/** The argument grammar that Ichnaea shows to a CLI consumer. */
export const CliHelp = z.strictObject({
    schema: none(z.literal("ichnaea.help/1")),
    commands: z.array(z.strictObject({
        name: text(),
        description: text(),
        positionals: none(z.array(z.string())),
        optionalPositionals: count(),
        options: z.array(z.strictObject({
            name: text(),
            description: text(),
            type: none(z.enum(["boolean", "string"])),
            required: none(z.boolean()).optional(),
            multiple: none(z.boolean()).optional(),
            choices: none(z.array(z.string())).optional(),
        })),
        together: none(z.array(z.string()).min(2).max(2)).optional(),
        worker: none(z.literal(true)).optional(),
    })),
    exitCodes: z.strictObject({
        success: none(z.literal(0)),
        blocked: none(z.literal(1)),
        error: none(z.literal(2)),
    }),
});
/** Configuration and tester status without diagnostic messages. */
export const CliDoctor = z.strictObject({
    schema: none(z.literal("ichnaea.doctor/1")),
    plugins: none(z.array(z.string())),
    measures: z.array(z.strictObject({ id: text(), status: text() })),
    problems: count(),
});
/** The verified, class-none view of a decision that the CLI prints as JSON. */
export const ReportView = z.strictObject({
    schema: none(z.literal("ichnaea.reportView/1")),
    title: text(),
    verdict: text(),
    claim: text(),
    reason: text(),
    method: text(),
    measures: z.array(z.strictObject({
        measure: text(),
        tier: text(),
        verdict: text(),
        estimand: text(),
        arms: z.array(z.strictObject({
            arm: text(),
            rate: text(),
            interval: text(),
            n: text(),
            missing: count(),
            denominators: z.strictObject({
                observedCases: none(z.int().nonnegative().nullable()),
                plannedCases: none(z.int().nonnegative().nullable()),
                observedTrials: count(),
                plannedTrials: count(),
                caseCountsReason: text().optional(),
            }),
            estimand: text(),
            method: text(),
            level: none(z.number()),
            sidedness: text(),
            validity: Validity,
        })),
        difference: z
            .strictObject({
            estimate: text(),
            bound: text(),
            margin: text(),
            method: text(),
            sidedness: text(),
            level: none(z.number()),
            negativeFlips: count(),
            positiveFlips: count(),
            validated: none(z.boolean()),
            axis: z
                .strictObject({
                estimate: none(z.number()),
                lower: none(z.number()),
                margin: none(z.number()),
                validated: none(z.boolean()),
            })
                .optional(),
        })
            .optional(),
        blocks: MeasureOutcome.shape.blocks,
        noise: noise
            .extend({ arms: z.array(noise.shape.arms.element.extend({ arm: text() })) })
            .optional(),
        notes: none(z.array(z.string())),
    })),
    trialReduction: z
        .strictObject({
        measure: text(),
        k: none(z.int().positive()),
        /** Case, observed trials, all pass, any pass and availability. */
        rows: none(z.array(z.array(z.string()).length(5))),
    })
        .optional(),
    gates: z.array(z.strictObject({ gate: text(), result: text() })),
    flips: z.array(z.strictObject({
        measure: text(),
        case: text(),
        direction: text(),
        base: text(),
        candidate: text(),
    })),
    power: z.array(z.strictObject({
        statement: none(z.enum(["planning", "this run"])),
        measure: text(),
        cases: count(),
        replicates: count(),
        floor: text(),
        mde: text(),
        margin: text(),
        reach: text(),
        assumption: text(),
    })),
    resolution: none(z.array(z.string())).optional(),
    sensitivity: z.array(z.strictObject({
        measure: text(),
        imputation: text(),
        difference: text(),
        bound: text(),
        validated: none(z.boolean()),
        verdict: text(),
        changes: text(),
    })),
    agreement: z
        .strictObject({
        statistic: none(z.literal("krippendorff-alpha")),
        source: z.strictObject({ sidecar: none(Digest), registration: none(Digest) }).optional(),
        metric: none(z.enum(["nominal", "ordinal", "interval"])),
        estimate: none(z.number().nullable()),
        counts: z.strictObject({
            items: count(),
            units: count(),
            pairedUnits: count(),
            pairedItems: count(),
            raters: count(),
            ratings: count(),
            pairedRatings: count(),
        }),
        interval: z.strictObject({
            method: none(z.literal("item-cluster-percentile")),
            level: none(z.literal(0.95)),
            validated: none(z.literal(false)),
            seed: count(),
            algorithm: text(),
            lower: none(z.number().nullable()),
            upper: none(z.number().nullable()),
            resamples: count(),
            omittedResamples: count(),
            unavailableReason: none(z.string().nullable()),
        }),
    })
        .optional(),
    missingness: text(),
    differingFactors: none(z.array(z.string())),
    limitations: none(z.array(z.string())),
    mustNever: z
        .array(z.strictObject({
        measure: text(),
        note: text(),
        counts: none(z.array(z.int().nonnegative()).length(4)),
        details: none(z.array(z.string())),
    }))
        .optional(),
    lineage: z.array(z.strictObject({ label: text(), value: text() })),
});
//# sourceMappingURL=cli.js.map