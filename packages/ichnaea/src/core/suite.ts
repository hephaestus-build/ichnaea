import * as z from "zod";

import {
  CalendarDate,
  Case,
  type Configuration,
  Json,
  PolicyAction,
  SemVer,
  Text,
  Trial,
  type Unit,
} from "../contracts/index.ts";

import type { MeasureDefinition, MeasureExample } from "./plugin.ts";

/** A case as a suite lists it: a case record, as `loadCases` returns it or as written inline. */
export type SuiteCase = z.input<typeof Case>;

/**
 * Scores one trial of a binary measure from the trial's raw output: `true` passes, `false` fails,
 * and `undefined` gives the trial no value, so it counts as missing. The output is whatever the
 * system returned, as JSON, so stored outputs can be scored again with no model call. It is
 * `undefined` when the trial recorded only a pointer to its output.
 */
export type BinaryScorer = (output: unknown, c: Case) => boolean | undefined;

/** A known-good or known-bad output of a binary measure, for its tester (REQ-33). */
export interface BinaryExample {
  /** The example's name, which the tester's failure messages quote. */
  readonly name: string;
  /** The case that the example scores. */
  readonly case: SuiteCase;
  /** The raw output that the scorer reads. */
  readonly output: unknown;
  /** What the measure must give: a pass, a fail, or not applicable to the case. */
  readonly expected: boolean | "not-applicable";
}

/** The prose of a binary measure's card. Each field has a default that states the mechanism. */
export interface BinaryCardText {
  /** What the measure stands for. */
  readonly construct?: string;
  /** How a trial passes. */
  readonly operationalDefinition?: string;
  /** Why the measure matters. */
  readonly justification?: string;
  /** How the scorer can be wrong. */
  readonly errorModel?: string;
  /** Which cases the measure applies to. */
  readonly applicability?: string;
  /** What a pass establishes, and what it does not. */
  readonly establishes?: string;
}

/** What `binary` takes. */
export interface BinaryOptions {
  /** Scores one trial from its raw output. */
  readonly score: BinaryScorer;
  /** Whether the measure applies to a case. Absent means it applies to every case. */
  readonly appliesTo?: (c: Case) => boolean;
  /**
   * Known-good and known-bad outputs. A primary measure needs at least one of each, and every
   * example must give its expected value, or the plan is refused (REQ-33).
   */
  readonly examples?: {
    readonly good: readonly BinaryExample[];
    readonly bad: readonly BinaryExample[];
  };
  /** The measure's version, a semantic version, recorded in the plan. Default `1.0.0`. */
  readonly version?: string;
  /** The prose of the measure's card. */
  readonly card?: BinaryCardText;
}

/** A binary measure of a suite: pass or fail per trial, scored by Ichnaea from the raw output. */
export interface BinaryMeasure extends BinaryOptions {
  /** The value type of the measure. */
  readonly valueType: "binary";
}

/**
 * Defines a binary measure. It describes the measure only: `createPlan` builds its card under the
 * ID `<suite id>/<measure key>`, with tier `primary` when the policy gives it a limit, and tests
 * its examples.
 */
export function binary(options: BinaryOptions): BinaryMeasure {
  return { ...options, valueType: "binary" };
}

/**
 * The suite card: what the evaluation is for and what it cannot show. Every field is required,
 * because the report and its readers need them to judge what a verdict means.
 */
export interface SuiteCard {
  /** What the suite checks, in one sentence. */
  readonly objective: string;
  /** The decision the suite informs, for example "merge or hold a change to the composer". */
  readonly decision: string;
  /** The quality the measures stand for. */
  readonly construct: string;
  /** The inputs the cases cover. */
  readonly scope: string;
  /** What the suite does not cover. */
  readonly nonCoverage: string;
  /** What could make a verdict wrong. */
  readonly threats: readonly string[];
  /** When the measures must next be reviewed, `YYYY-MM-DD`. */
  readonly measureReviewDate?: string;
}

/**
 * The limit of a primary measure: the largest drop in its pass rate that still counts as no
 * regression, with the reason it was set to this value. The records call it the margin.
 */
export interface Limit {
  /** The largest accepted drop, as a proportion below 1, for example 0.1. */
  readonly margin: number;
  /** Why the limit has this value, in one sentence. */
  readonly reason: string;
  /**
   * Whether the measure's owner registered the limit, or it is a placeholder. A placeholder gives
   * no verdict: the plan is estimate-only. Default `registered`.
   */
  readonly status?: "registered" | "placeholder";
}

/** What a suite does with each kind of result in CI (REQ-26, REQ-27). INVALID always blocks. */
export interface SuitePolicy<Measure extends string = string> {
  /** The primary measures, each with its limit. A PASS needs every one of them. */
  readonly primary: { readonly [K in Measure]?: Limit };
  /**
   * The secondary measures, reported but never deciding. Absent means every measure without a
   * limit.
   */
  readonly secondary?: readonly Measure[];
  /** What a REGRESSION does: `block` fails the check, `report` only reports it. */
  readonly onRegression: "block" | "report";
  /** What an INCONCLUSIVE result does. */
  readonly onInconclusive: "block" | "report";
  /** What an estimate-only result does. */
  readonly onEstimateOnly: "block" | "report";
}

/** An evaluation suite: one plain object, with no I/O, read from the base arm. */
export interface SuiteDefinition<Measure extends string = string> {
  /** The suite's ID: lowercase letters, digits and hyphens. It namespaces the measure IDs. */
  readonly id: string;
  /** The suite's version. A change to the cases, the measures or the limits is a new version. */
  readonly version: string;
  /** What the evaluation is for and what it cannot show. */
  readonly card: SuiteCard;
  /** The cases, at least one, with unique IDs. */
  readonly cases: readonly SuiteCase[];
  /** The measures, by key: lowercase letters, digits, `.`, `_` and `-`. */
  readonly measures: { readonly [K in Measure]: BinaryMeasure };
  /** The limits of the primary measures and the CI policy. */
  readonly policy: SuitePolicy<NoInfer<Measure>>;
  /**
   * Trials per case and arm: `default`, or more for the cases of a slice, keyed `slice=value`, for
   * example `{ "expected=decline": 3 }`. A case that several keys match runs the largest count.
   */
  readonly trials: {
    readonly default: number;
    readonly bySlice?: Readonly<Record<string, number>>;
  };
  /** The call budget: the most calls a run may make, and the most one trial may make. */
  readonly budget: { readonly calls: number; readonly callsPerTrial: number };
  /** Resolves the configuration of the arm checked out at `root`. */
  readonly configuration: (root: string) => Configuration | Promise<Configuration>;
  /**
   * Maps the paths that a change touches to the parts of the configuration it intends to change,
   * as JSON Pointers (RFC 6901) for `createPlan`'s `intendedChanges`.
   */
  readonly changes: (paths: readonly string[]) => readonly string[];
  /** How trials are collected. Opaque here; collection reads it. */
  readonly worker?: unknown;
}

/** Thrown when a suite definition is not valid. The message names the field and the fix. */
export class SuiteError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "SuiteError";
}

const SUITE_ID = /^[a-z0-9][a-z0-9-]*$/;
const MEASURE_KEY = /^[a-z0-9][a-z0-9._-]*$/;
const SLICE_KEY = /^([^=]+)=(.+)$/;

const fn = (what: string): z.ZodType<(...args: never[]) => unknown> =>
  z.custom<(...args: never[]) => unknown>(
    (v) => typeof v === "function",
    `${what} must be a function`,
  );

const Example = z.strictObject({
  name: Text,
  case: Case,
  output: Json.optional(),
  expected: z.union([z.boolean(), z.literal("not-applicable")]),
});

const Measure = z.strictObject({
  valueType: z.literal("binary", "only binary measures are supported; build one with binary()"),
  score: fn("score"),
  appliesTo: fn("appliesTo").optional(),
  examples: z.strictObject({ good: z.array(Example), bad: z.array(Example) }).optional(),
  version: SemVer.optional(),
  card: z
    .strictObject({
      construct: Text.optional(),
      operationalDefinition: Text.optional(),
      justification: Text.optional(),
      errorModel: Text.optional(),
      applicability: Text.optional(),
      establishes: Text.optional(),
    })
    .optional(),
});

const Key = z.string().regex(MEASURE_KEY, "a measure key holds lowercase letters, digits, . _ -");

const Definition = z
  .strictObject({
    id: z.string().regex(SUITE_ID, "the suite ID holds lowercase letters, digits and hyphens"),
    version: Text,
    card: z.strictObject({
      objective: Text,
      decision: Text,
      construct: Text,
      scope: Text,
      nonCoverage: Text,
      threats: z.array(Text),
      measureReviewDate: CalendarDate.optional(),
    }),
    cases: z.array(Case).min(1, "a suite has at least one case"),
    measures: z.record(Key, Measure),
    policy: z.strictObject({
      primary: z.record(
        Key,
        z.strictObject({
          margin: z.number().min(0).lt(1, "a limit is a proportion below 1"),
          reason: Text,
          status: z.enum(["registered", "placeholder"]).optional(),
        }),
      ),
      secondary: z.array(Key).optional(),
      onRegression: PolicyAction,
      onInconclusive: PolicyAction,
      onEstimateOnly: PolicyAction,
    }),
    trials: z.strictObject({
      default: z.int().min(1),
      bySlice: z
        .record(z.string().regex(SLICE_KEY, "a bySlice key reads slice=value"), z.int().min(1))
        .optional(),
    }),
    budget: z.strictObject({ calls: z.int().min(0), callsPerTrial: z.int().min(1) }),
    configuration: fn("configuration"),
    changes: fn("changes"),
    worker: z.unknown().optional(),
  })
  .superRefine((suite, ctx) => {
    const keys = new Set(Object.keys(suite.measures));
    if (keys.size === 0)
      ctx.addIssue({
        code: "custom",
        path: ["measures"],
        message: "a suite has at least one measure",
      });
    const ids = new Set<string>();
    for (const [i, c] of suite.cases.entries()) {
      if (ids.has(c.id))
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "id"],
          message: `duplicate case ID '${c.id}'`,
        });
      ids.add(c.id);
    }
    for (const key of Object.keys(suite.policy.primary)) {
      const measure = suite.measures[key];
      if (!measure) {
        ctx.addIssue({
          code: "custom",
          path: ["policy", "primary", key],
          message: `'${key}' is not a measure of the suite`,
        });
        continue;
      }
      if (
        !measure.examples ||
        measure.examples.good.length === 0 ||
        measure.examples.bad.length === 0
      )
        ctx.addIssue({
          code: "custom",
          path: ["measures", key, "examples"],
          message: `primary measure '${key}' needs at least one known-good and one known-bad example (REQ-33)`,
        });
    }
    for (const [i, key] of (suite.policy.secondary ?? []).entries()) {
      if (!keys.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["policy", "secondary", i],
          message: `'${key}' is not a measure of the suite`,
        });
      else if (Object.hasOwn(suite.policy.primary, key))
        ctx.addIssue({
          code: "custom",
          path: ["policy", "secondary", i],
          message: `'${key}' has a limit, so it is primary, not secondary`,
        });
    }
    for (const key of Object.keys(suite.trials.bySlice ?? {})) {
      const [, slice, value] = SLICE_KEY.exec(key) ?? [];
      if (!suite.cases.some((c) => slice !== undefined && c.slices?.[slice] === value))
        ctx.addIssue({
          code: "custom",
          path: ["trials", "bySlice", key],
          message: `'${key}' matches no case; check the slice name and value`,
        });
    }
  });

/**
 * Checks a suite definition and returns it unchanged, keeping its literal measure keys, so the
 * policy can name only measures the suite defines. It does no I/O. A definition that is not valid
 * throws a SuiteError that lists every problem with its field.
 */
export function defineSuite<const Measure extends string>(
  suite: SuiteDefinition<Measure>,
): SuiteDefinition<Measure> {
  const checked = Definition.safeParse(suite);
  if (!checked.success)
    throw new SuiteError(
      `suite '${typeof suite.id === "string" ? suite.id : "?"}' is not valid:\n${z.prettifyError(checked.error)}`,
    );
  return suite;
}

/** The ID of a suite's measure in the records: `<suite id>/<measure key>`. */
export function measureId(suite: Pick<SuiteDefinition, "id">, key: string): string {
  return `${suite.id}/${key}`;
}

/** A placeholder identity for the trials of a measure's examples, which ran no configuration. */
const EXAMPLE_IDENTITY = `sha256:${"0".repeat(64)}`;

/**
 * Builds today's measure definitions of a suite, by measure ID: each binary measure's card and
 * scoring function, and its examples as the tester runs them. A measure with a limit is primary.
 */
export function suiteMeasures(suite: SuiteDefinition): Map<string, MeasureDefinition> {
  const unit: Unit = Case.parse(suite.cases[0]).unit;
  const out = new Map<string, MeasureDefinition>();
  for (const [key, measure] of Object.entries<BinaryMeasure>(suite.measures)) {
    const id = measureId(suite, key);
    const text = measure.card ?? {};
    const example = (e: BinaryExample): MeasureExample => {
      const c = Case.parse(e.case);
      return {
        name: e.name,
        case: c,
        trial: Trial.parse({
          schema: "ichnaea.trial/1",
          id: "example",
          source: "offline",
          case: c.id,
          unit: c.unit,
          configuration: EXAMPLE_IDENTITY,
          replicate: 0,
          outcome: "completed",
          dataClass: c.dataClass,
          ...(e.output === undefined ? {} : { output: e.output }),
        }),
        expected:
          e.expected === "not-applicable" ? e.expected : { type: "binary", pass: e.expected },
      };
    };
    out.set(id, {
      card: {
        id,
        version: measure.version ?? "1.0.0",
        construct: text.construct ?? `Whether a trial passes the scorer of '${key}'.`,
        operationalDefinition:
          text.operationalDefinition ??
          "A scoring function over the trial's raw output gives pass or fail, or no value.",
        valueType: "binary",
        unit: "trials that pass",
        direction: "higher",
        justification: text.justification ?? suite.card.objective,
        errorModel:
          text.errorModel ??
          "The scorer can misjudge an output; its known-good and known-bad examples test it.",
        applicability:
          text.applicability ??
          (measure.appliesTo ? "The cases that its appliesTo function selects." : "Every case."),
        tier: Object.hasOwn(suite.policy.primary, key) ? "primary" : "secondary",
        unitOfEvaluation: unit,
        establishes: text.establishes ?? suite.card.construct,
        computedBy: "ichnaea",
      },
      ...(measure.appliesTo ? { appliesTo: measure.appliesTo } : {}),
      score: (trial, c) => {
        const pass = measure.score(trial.output, c);
        return pass === undefined ? undefined : { type: "binary", pass };
      },
      ...(measure.examples
        ? {
            examples: {
              good: measure.examples.good.map(example),
              bad: measure.examples.bad.map(example),
            },
          }
        : {}),
    });
  }
  return out;
}
