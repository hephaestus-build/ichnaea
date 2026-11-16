import * as z from "zod";

import {
  AaCitation,
  armNames,
  Case,
  caseDigest,
  CaseSet,
  caseSetDigest,
  Configuration,
  Plan,
  RunId,
  Schedule,
  Suite,
  Timestamp,
} from "../contracts/index.ts";
import { CORE_VERSION } from "../core/version.ts";
import { MAX_SEED, PlanError, resolvePlan, seedRecord } from "../core/planner.ts";
import { IntendedChange, intendedFactors } from "../core/pointers.ts";
import { measureId, type SuiteDefinition, suiteMeasures, type SuitePlan } from "../core/suite.ts";

import { planningPower } from "./planning.ts";

/** What one comparison of a suite compares: the base and candidate configurations. */
export interface PlanComparison {
  /** The ID of the run that carries out the plan. */
  readonly run: string;
  /** The configuration of the base arm, the version compared against. */
  readonly base: Configuration;
  /** The configuration of the candidate arm. For a noise check, the base configuration again. */
  readonly candidate: Configuration;
  /**
   * The parts of the configuration the change intends to change, as JSON Pointers (RFC 6901) into
   * its keyed view: `/models/<role>`, `/parameters/<name>`, `/prompts/<name>`, `/factors/<name>`
   * (the code is a factor, for example `/factors/code.commit`), or a whole member such as
   * `/prompts`. The arms may differ there and nowhere else; any other difference makes the run
   * INVALID. Absent means no change is intended.
   */
  readonly intendedChanges?: readonly string[];
  /**
   * The seed of the plan's generator, an integer from 0 to below 10^9. It decides which arm is
   * named `a` and which `b` (`armNames`), and each case's coin (which arm runs first), so a plan is
   * reproducible from it.
   */
  readonly seed: number;
  /** The plan's creation time, ISO 8601. The caller reads the clock; createPlan never does. */
  readonly createdAt: string;
  /** How many trials run at once and the endpoint they call. One trial per case needs it. */
  readonly schedule?: Plan["schedule"];
  /** The noise checks (A/A decisions) this plan cites, by run and decision digest. */
  readonly aa?: Plan["aa"];
}

/** A suite record as a definition gives it: the measure review date is optional there. */
const SuiteRecord = Suite.partial({ measureReviewDate: true });

const ComparisonSchema = z.strictObject({
  run: RunId,
  base: Configuration,
  candidate: Configuration,
  intendedChanges: z.array(IntendedChange).optional(),
  seed: z
    .int("the seed is an integer")
    .min(0, "the seed is at least 0")
    .lt(MAX_SEED, "the seed is below 10^9"),
  createdAt: Timestamp,
  schedule: Schedule.optional(),
  aa: z.strictObject({ decisions: z.array(AaCitation) }).optional(),
});

/**
 * Resolves a suite and a comparison into a locked plan, before any trial runs. It is pure: it does
 * no I/O and reads no clock, so the same suite and comparison, seed and creation time included,
 * give the same plan byte for byte.
 * It lists every planned trial: at one trial per case and arm, case by case in the order of each
 * case's seeded coin; otherwise in alternating batches by replicate. It resolves the cases each
 * measure applies to, tests each measure against its examples, states the planning power, and
 * gives the plan's mode with the reasons when it is estimate-only. What cannot be resolved throws
 * a PlanError that names the fix.
 *
 * The arms are named `a` and `b` by a coin from the seed, so no trial ID and no trial request
 * names its side; the plan records each name's role.
 *
 * The suite, its cases, its scorers and its limits are the BASE's: a change cannot judge
 * itself by a suite it edits. So the function takes one suite, and the arms differ only in their
 * configurations. A noise check compares a version with itself: pass the base configuration as
 * the candidate.
 */
export function createPlan<const S extends SuiteDefinition>(
  suite: S,
  comparison: PlanComparison,
): SuitePlan<S> {
  const checked = ComparisonSchema.safeParse(comparison);
  if (!checked.success)
    throw new PlanError(`the comparison is not valid:\n${z.prettifyError(checked.error)}`);
  const { base, candidate } = checked.data;
  const cases = suite.cases.map((c) => Case.parse(c));
  const entries = cases.map((c) => ({
    id: c.id,
    digest: caseDigest(c),
    pool: c.pool,
    ...(c.family === undefined ? {} : { family: c.family }),
  }));
  const digest = caseSetDigest(entries);
  const keys = Object.keys(suite.measures);
  const primary = Object.entries(suite.policy.primary).flatMap(([key, limit]) =>
    limit === undefined
      ? []
      : [
          {
            measure: measureId(suite, key),
            margin: limit.margin,
            marginStatus: limit.status ?? "registered",
            marginReason: limit.reason,
            marginOwner: limit.owner,
          },
        ],
  );
  const secondary = (
    suite.policy.secondary ?? keys.filter((k) => !Object.hasOwn(suite.policy.primary, k))
  ).map((k) => measureId(suite, k));
  const replicatesFor = Object.entries(suite.trials.bySlice ?? {}).map(([key, replicates]) => {
    const at = key.indexOf("=");
    const [slice, value] = [key.slice(0, at), key.slice(at + 1)];
    return {
      slice,
      value,
      replicates,
      reason: `the suite asks for ${replicates} trials per arm where ${slice} is ${value}`,
    };
  });
  const { card } = suite;
  const names = armNames(seedRecord(checked.data.seed));
  const plan = resolvePlan({
    suite: SuiteRecord.parse({
      schema: "ichnaea.suite/1",
      id: suite.id,
      version: suite.version,
      objective: card.objective,
      construct: card.construct,
      decision: card.decision,
      scope: card.scope,
      nonCoverage: card.nonCoverage,
      estimand: "fixed-cases",
      caseSet: { id: suite.id, path: "suite.cases", digest },
      replicates: suite.trials.default,
      ...(replicatesFor.length > 0 ? { replicatesFor } : {}),
      primary,
      secondary,
      budget: { maxCalls: suite.budget.calls, callsPerTrial: suite.budget.callsPerTrial },
      policy: {
        onRegression: suite.policy.onRegression,
        onInconclusive: suite.policy.onInconclusive,
        onEstimateOnly: suite.policy.onEstimateOnly,
      },
      threats: [...card.threats],
      ...(card.measureReviewDate === undefined
        ? {}
        : { measureReviewDate: card.measureReviewDate }),
    }),
    caseSet: CaseSet.parse({ schema: "ichnaea.caseSet/1", id: suite.id, digest, cases: entries }),
    cases,
    // Opaque names, so no trial ID or request tells a system which side it is on.
    arms: [
      { name: names.base, role: "base", configuration: base },
      { name: names.candidate, role: "candidate", configuration: candidate },
    ],
    measures: suiteMeasures(suite),
    gates: new Map(),
    // The intended changes are what the arms may vary; the trigger is descriptive only, so it is
    // the one that varies nothing by its kind.
    trigger: "manual",
    varies: intendedFactors(checked.data.intendedChanges ?? [], base, candidate),
    seed: checked.data.seed,
    now: checked.data.createdAt,
    ichnaea: CORE_VERSION,
    ...(checked.data.schedule === undefined ? {} : { schedule: checked.data.schedule }),
    ...(checked.data.aa === undefined ? {} : { aa: checked.data.aa }),
  });
  // The planning statement, as the decide plugin adds it to a plan: it may refuse a limit no run
  // can decide, or switch the plan to estimate-only, before any call.
  const { refuse, ...additions } = planningPower(plan);
  if (refuse !== undefined) throw new PlanError(refuse);
  return { suite, run: checked.data.run, record: Plan.parse({ ...plan, ...additions }) };
}
