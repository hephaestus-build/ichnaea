import { type Case, type CaseSet, type Configuration, type FactorPart, Plan, type Suite } from "../contracts/index.ts";
import type { GateDefinition, MeasureDefinition } from "./plugin.ts";
/** Thrown when a suite cannot be resolved into a valid plan. The message names the fix. */
export declare class PlanError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "PlanError";
}
/** Everything a plan is resolved from. */
export interface PlanInput {
    /** The suite to resolve. */
    readonly suite: Suite;
    /** The case set that the suite runs on; its digest must match its entries. */
    readonly caseSet: CaseSet;
    /** The cases that the case set lists; each must match its entry's digest, pool and family. */
    readonly cases: readonly Case[];
    /** The arms to compare, each with its name, role and configuration. */
    readonly arms: ReadonlyArray<{
        readonly name: string;
        readonly role: "base" | "candidate" | "reference";
        readonly configuration: Configuration;
    }>;
    /** Arms whose trials will be run (not imported); their calls count against the budget. */
    readonly armsToRun?: readonly string[];
    /** The measures that the configuration defines, by card ID. */
    readonly measures: ReadonlyMap<string, MeasureDefinition>;
    /** The gates that the configuration defines, by gate ID. */
    readonly gates: ReadonlyMap<string, GateDefinition>;
    /**
     * The kind of change that the plan evaluates; it decides which configuration parts the arms may
     * vary.
     */
    readonly trigger: Plan["trigger"];
    /** Factor keys the change varies beyond what its trigger varies by kind (REQ-15). */
    readonly varies?: readonly string[];
    /** The seed recorded in the plan, for the `mt19937` generator. */
    readonly seed: number;
    /** The ISO 8601 timestamp recorded as the plan's `createdAt`. */
    readonly now: string;
    /** The Ichnaea version, a semantic version, recorded in the plan. */
    readonly ichnaea: string;
    /** Calls left this month on the endpoint, from the call ledger. */
    readonly monthlyRemaining?: number;
}
/** Fewest cases a fixed-cases decision is validated for (VALIDATED_FIXED_CASES in stats). */
export declare const MIN_DECISION_CASES = 5;
/**
 * The parts of a configuration that each trigger varies by its kind (REQ-15). Arms may differ in
 * these parts and in the factor keys a plan declares in `varies`; any other difference between the
 * arms makes the run INVALID. `null` marks a trigger that changes nothing in the system under
 * evaluation (a case set, a judge, the framework itself, a production signal), so its arms may not
 * differ at all and it cannot declare anything as varied. A code or dependency change varies the
 * code, including its lockfile; a prompt or setting it also changes must be declared.
 */
export declare const TRIGGER_VARIES: {
    readonly [K in Plan["trigger"]]: readonly FactorPart[] | null;
};
/**
 * Resolves a suite into a locked plan (REQ-16, REQ-19, REQ-21, REQ-49): every planned trial is
 * listed before the first call, with each case's trial count (the suite's, or more for the cases of
 * a `replicatesFor` slice), the worst-case calls are computed, and the estimand's conditions
 * are checked. What cannot be resolved is refused with a PlanError that names the fix. What can
 * be measured but not decided runs estimate-only, and `modeReasons` says why: no base and
 * candidate, no primary measure, a primary measure with values no validated method decides yet
 * (decision 0008), a placeholder margin (decision 0012), `sampled-cases` (no validated method yet),
 * one trial per case and arm, or fewer than 5 cases. A primary measure must have a primary card that
 * is not a composite (REQ-34).
 */
export declare function createPlan(input: PlanInput): Promise<Plan>;
//# sourceMappingURL=planner.d.ts.map