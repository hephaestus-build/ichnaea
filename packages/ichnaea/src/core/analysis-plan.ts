import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { canonicalize, digest } from "../contracts/canonical.ts";
import { caseDigest, caseSetDigest, configurationIdentity } from "../contracts/identity.ts";
import { AnalysisLock, AnalysisPlan, AnalysisPrimary } from "../contracts/records/analysis-plan.ts";
import { Case, CaseSet } from "../contracts/records/case.ts";
import { Plan } from "../contracts/records/plan.ts";
import { SuiteLock } from "../contracts/records/lock.ts";
import { Configuration } from "../contracts/records/configuration.ts";
import { sha256Hex } from "../contracts/sha256.ts";
import {
  checkCases,
  DEFAULT_TRIAL_DEADLINE_MS,
  lockFor,
  resolveAnalysis,
} from "../plan/analysis.ts";
import type { RunRecords } from "../contracts/run-records.ts";
import { configurationDifferences } from "../plan/rules.ts";
import { planResolution } from "../plan/resolution.ts";
import { PlanError } from "../plan/resolve.ts";

import type { Host } from "./host.ts";
import { measurePin } from "./instrument-pin.ts";
import { testMeasure } from "./measures.ts";
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
  /** Book two base arms for a noise pilot. */
  readonly noise?: boolean;
  /** A legacy suite lock whose local case source to verify before pinning the new plan. */
  readonly legacyLock?: string;
}

/** The two records that the plan command writes. */
export interface PlannedSuite {
  /** The candidate-independent analysis. */
  readonly plan: AnalysisPlan;
  /** The case and instrument pins. */
  readonly lock: AnalysisLock;
}

async function jsonFile(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new PlanError(`${path}: invalid JSON`);
  }
}

export async function suiteCases(
  suite: SuiteDefinition,
  directory: string,
  bytes?: Uint8Array,
): Promise<{ readonly cases: readonly Case[]; readonly caseSet: CaseSet }> {
  const path = resolve(directory, suite.cases);
  const lines = (bytes ? Buffer.from(bytes).toString("utf8") : await readFile(path, "utf8")).split(
    "\n",
  );
  const cases = lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new PlanError("expected a case object");
      return [Case.parse({ schema: "ichnaea.case/1", ...suite.caseDefaults, ...value })];
    } catch (error) {
      throw new PlanError(
        `${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  const entries = cases.map((c) => ({
    id: c.id,
    digest: caseDigest(c),
    pool: c.pool,
    ...(c.family === undefined ? {} : { family: c.family }),
  }));
  const caseSet = suite.caseSet
    ? CaseSet.parse(await jsonFile(resolve(directory, suite.caseSet)))
    : CaseSet.parse({
        schema: "ichnaea.caseSet/1",
        id: suite.id,
        digest: caseSetDigest(entries),
        cases: entries,
      });
  checkCases(caseSet, cases, suite.purpose);
  return { cases, caseSet };
}

export async function armConfiguration(
  definition: ArmDefinition,
  directory: string,
): Promise<Configuration> {
  if (typeof definition === "string")
    return Configuration.parse(await jsonFile(resolve(directory, definition)));
  if ("schema" in definition) return Configuration.parse(definition);
  const parameters = Object.entries(definition.parameters ?? {});
  return Configuration.parse({
    schema: "ichnaea.configuration/1",
    description: "Suite arm",
    models: [
      {
        role: "answer",
        provider: { value: definition.provider ?? "unspecified", status: "declared" },
        id: { value: definition.model, status: "declared" },
      },
    ],
    parameters:
      parameters.length === 0
        ? [{ name: "generation.default", value: null, status: "uncontrollable", origin: "default" }]
        : parameters.map(([name, value]) => ({
            name,
            value,
            status: "declared",
            origin: "explicit",
          })),
    prompts: definition.prompt
      ? [
          {
            name: "answer",
            digest: `sha256:${sha256Hex(await readFile(resolve(directory, definition.prompt)))}`,
            status: "pinned",
          },
        ]
      : [],
    factors: {},
  });
}

async function measurePins(
  host: Host,
  ids: readonly string[],
  directory: string,
): Promise<AnalysisPlan["measures"]> {
  return Promise.all(
    ids.map(async (id) => {
      const measure = host.measures.get(id);
      if (!measure) throw new PlanError(`measure '${id}' is not provided by a plugin`);
      return AnalysisPlan.shape.measures.element.parse({
        id,
        version: measure.card.version,
        pin: await measurePin(measure, directory),
      });
    }),
  );
}

async function verifyLegacyLock(
  path: string,
  suite: SuiteDefinition,
  directory: string,
): Promise<Uint8Array> {
  if (resolve(path) === resolve(directory, "ichnaea.lock"))
    throw new PlanError("give the legacy lock a separate path before migrating it");
  const legacy = SuiteLock.parse(await jsonFile(path));
  const [source] = legacy.sources;
  if (legacy.suite !== suite.id) throw new PlanError("the legacy lock belongs to another suite");
  const casesPath = resolve(directory, suite.cases);
  if (
    legacy.sources.length !== 1 ||
    !source ||
    !("file" in source.origin) ||
    resolve(dirname(resolve(path)), source.origin.file) !== casesPath
  )
    throw new PlanError("the legacy lock must pin the suite's local case file");
  const bytes = await readFile(casesPath);
  if (source.bytes !== bytes.length || source.digest !== `sha256:${sha256Hex(bytes)}`)
    throw new PlanError("the case file differs from the legacy lock");
  return bytes;
}

/** Resolves the case and measure pins without reading or binding a candidate. */
export async function planSuite(input: PlanSuiteInput): Promise<PlannedSuite> {
  const suite = SuiteDefinition.parse(input.suite);
  const legacyBytes =
    input.legacyLock === undefined
      ? undefined
      : await verifyLegacyLock(input.legacyLock, suite, input.directory);
  const { cases, caseSet } = await suiteCases(suite, input.directory, legacyBytes);
  const { arms, ...rules } = suite;
  const primary = (suite.primary ?? []).map((entry) =>
    AnalysisPrimary.parse(typeof entry === "string" ? { measure: entry } : entry),
  );
  const secondary = suite.secondary ?? [];
  const hardGates = suite.hardGates ?? [];
  const reduction = suite.trialReduction;
  if (reduction && arms.candidate !== undefined)
    throw new PlanError("a trial reduction requires one arm");
  if (reduction) {
    const card = input.host.measures.get(reduction.measure)?.card;
    if (!card || card.valueType !== "binary" || card.composite || card.computedBy === "judge")
      throw new PlanError(
        `trial reduction '${reduction.measure}' needs a binary application measure`,
      );
  }
  const measureIds = new Set([...primary.map((p) => p.measure), ...secondary]);
  if (reduction) measureIds.add(reduction.measure);
  if (suite.mustNever && arms.candidate !== undefined)
    throw new PlanError("must-never counting requires one arm");
  for (const { measure, detector } of suite.mustNever ?? []) {
    const card = input.host.measures.get(measure)?.card;
    if (!card || card.valueType !== "binary" || card.composite || card.direction !== "lower")
      throw new PlanError(
        `must-never measure '${measure}' needs a binary measure with lower values better`,
      );
    if (card.computedBy === "judge" && detector.kind === "deterministic")
      throw new PlanError(`must-never measure '${measure}' needs a model detector`);
    measureIds.add(measure);
  }
  const measures = await measurePins(input.host, [...measureIds], input.directory);
  for (const gate of hardGates)
    if (!input.host.gates.has(gate))
      throw new PlanError(`hard gate '${gate}' is not provided by a plugin`);
  const applicability: AnalysisPlan["applicability"] = {};
  const byId = new Map(cases.map((record) => [record.id, record]));
  for (const { measure } of primary) {
    if (Object.hasOwn(applicability, measure))
      throw new PlanError(`duplicate primary comparison '${measure}'`);
    const definition = input.host.measures.get(measure);
    if (!definition) throw new PlanError(`measure '${measure}' is not provided by a plugin`);
    const { card } = definition;
    if (card.computedBy === "judge" || card.composite || card.valueType !== "binary")
      throw new PlanError(
        `primary measure '${measure}' needs a binary, non-composite application measure`,
      );
    if (card.computedBy === "ichnaea") {
      const tester = await testMeasure(definition, { directory: input.directory });
      if (measures.find((entry) => entry.id === measure)?.pin !== tester.digest)
        throw new PlanError(`primary measure '${measure}' changed during fixture qualification`);
      if (!tester.qualification)
        throw new PlanError(
          tester.failures[0] ??
            `primary measure '${measure}' needs good, bad, do-nothing and incomplete-capture fixtures`,
        );
    } else if (card.validation?.tester?.status !== "passed") {
      throw new PlanError(`primary measure '${measure}' needs a passing tester`);
    }
    const declared = caseSet.applicability?.[measure];
    applicability[measure] =
      declared ??
      caseSet.cases.flatMap(({ id }) => {
        const record = byId.get(id);
        if (!record) throw new PlanError(`case '${id}' is missing`);
        const applies = definition.appliesTo === undefined ? true : definition.appliesTo(record);
        if (typeof applies !== "boolean")
          throw new PlanError(`appliesTo for '${measure}' must return a boolean`);
        return applies ? [id] : [];
      });
  }
  const plan = resolveAnalysis({
    ...rules,
    suite: suite.id,
    suiteDigest: digest(rules),
    caseSet,
    base: await armConfiguration(arms.base, input.directory),
    primary,
    secondary,
    hardGates,
    measures,
    applicability,
    ichnaea: input.ichnaea,
    callsPerTrial: suite.callsPerTrial ?? 1,
    deadlineMs: suite.deadlineMs ?? DEFAULT_TRIAL_DEADLINE_MS,
  });
  const armsToBook = input.noise || arms.candidate !== undefined || primary.length > 0 ? 2 : 1;
  const resolved = AnalysisPlan.parse({
    ...plan,
    ...planResolution(plan, suite.blocks !== undefined, suite.maxCalls, input.pilot, armsToBook),
  });
  return { plan: resolved, lock: lockFor(resolved) };
}

export async function readLockedPlan(path: string, bytes?: Uint8Array): Promise<AnalysisPlan> {
  const plan = AnalysisPlan.parse(
    bytes === undefined
      ? await jsonFile(path)
      : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const lock = AnalysisLock.parse(await jsonFile(join(dirname(path), "ichnaea.lock")));
  if (digest(lock) !== digest(lockFor(plan)))
    throw new PlanError("the plan does not match ichnaea.lock");
  return plan;
}

/** Writes the authoring plan and the single lock beside the suite configuration. */
export async function writeAnalysis(
  directory: string,
  planned: PlannedSuite,
  frozen: boolean,
): Promise<void> {
  const path = join(directory, "plan.json");
  if (frozen) {
    if (digest(await readLockedPlan(path)) !== digest(planned.plan))
      throw new PlanError("the analysis plan has changed. Run ichnaea plan to update it");
    return;
  }
  const lockPath = join(directory, "ichnaea.lock");
  const scratch = randomUUID();
  const parts = [
    [path, planned.plan],
    [lockPath, planned.lock],
  ] as const;
  try {
    for (const [file, record] of parts)
      await writeFile(`${file}.${scratch}`, `${canonicalize(record)}\n`, { flag: "wx" });
    for (const [file] of parts) await rename(`${file}.${scratch}`, file);
  } finally {
    await Promise.all(parts.map(([file]) => rm(`${file}.${scratch}`, { force: true })));
  }
}

export interface LockedImport {
  readonly planPath: string;
  readonly definition: SuiteDefinition;
  readonly directory: string;
}

type BindingOptions = Pick<Plan, "trigger" | "varies" | "createdAt" | "ichnaea"> & {
  readonly seed: number | string;
};
type BoundPlan = { readonly cases: readonly Case[]; readonly plan: Plan };

export async function bindImportedPlan(
  input: LockedImport,
  host: Host,
  options: BindingOptions,
): Promise<BoundPlan> {
  return bindAnalysis(await readLockedPlan(input.planPath), input, host, options, undefined);
}

/** Binds the already checked analysis or plans an unanchored run from the current suite. */
export async function bindRunnerPlan(
  input: Omit<LockedImport, "planPath">,
  host: Host,
  options: BindingOptions,
  execution: { readonly analysis?: AnalysisPlan | undefined; readonly noise?: boolean },
): Promise<BoundPlan> {
  const analysis =
    execution.analysis ??
    (
      await planSuite({
        suite: input.definition,
        directory: input.directory,
        ichnaea: options.ichnaea,
        host,
        noise: execution.noise === true,
      })
    ).plan;
  return bindAnalysis(analysis, input, host, options, { noise: execution.noise === true });
}

async function bindAnalysis(
  analysis: AnalysisPlan,
  input: Omit<LockedImport, "planPath">,
  host: Host,
  options: BindingOptions,
  execution: { readonly noise: boolean } | undefined,
): Promise<BoundPlan> {
  const suite = SuiteDefinition.parse(input.definition);
  const { arms: definitions, ...rules } = suite;
  if (suite.trialReduction && definitions.candidate !== undefined)
    throw new PlanError("a trial reduction requires one arm");
  if (suite.mustNever && definitions.candidate !== undefined)
    throw new PlanError("must-never counting requires one arm");
  const { cases, caseSet } = await suiteCases(suite, input.directory);
  if (analysis.suiteDigest !== digest(rules) || analysis.caseSetDigest !== caseSet.digest)
    throw new PlanError("the suite or case set differs from the locked plan");
  if (
    digest(analysis.measures) !==
    digest(
      await measurePins(
        host,
        analysis.measures.map((m) => m.id),
        input.directory,
      ),
    )
  )
    throw new PlanError("the measure cards or instrument pins differ from the locked plan");
  const base = await armConfiguration(definitions.base, input.directory);
  const baseIdentity = configurationIdentity(base);
  if (baseIdentity !== analysis.base.identity)
    throw new PlanError("the base configuration differs from the locked plan");

  const armName = (role: string): string =>
    execution ? `arm-${digest(["worker-arm", options.seed, role]).slice(7, 23)}` : role;
  const runs = execution ? { runs: true } : {};
  const arms = [
    { ...runs, name: armName("base"), role: "base", identity: baseIdentity, configuration: base },
  ];
  const candidate = execution?.noise
    ? base
    : definitions.candidate === undefined
      ? undefined
      : await armConfiguration(definitions.candidate, input.directory);
  if (candidate) {
    arms.push({
      ...runs,
      name: armName("candidate"),
      role: "candidate",
      identity: configurationIdentity(candidate),
      configuration: candidate,
    });
  }
  const estimateReason =
    execution === undefined
      ? "the results were imported"
      : execution.noise
        ? "the noise run used the base configuration on both arms"
        : arms.length === 1
          ? "the run used one arm"
          : analysis.primary.length === 0 || analysis.method === "estimate-only"
            ? "the analysis plan supports estimates"
            : undefined;
  const trials = [];
  for (let block = 0; block < analysis.blocks; block++) {
    for (const entry of analysis.cases) {
      for (let index = 0; index < analysis.replicates; index++) {
        const replicate = block * analysis.replicates + index;
        for (const arm of arms) {
          trials.push({
            id: `${entry.id}/${arm.name}/r${replicate}`,
            case: entry.id,
            family: entry.family,
            arm: arm.name,
            replicate,
            block,
            batch: trials.length,
          });
        }
      }
    }
  }
  const plan = Plan.parse({
    ...options,
    ...(execution && candidate
      ? { varies: configurationDifferences(base, candidate).map(({ key }) => key) }
      : {}),
    schema: "ichnaea.plan/1",
    analysis,
    suite: analysis.suite,
    suiteVersion: suite.version ?? "1.0.0",
    suiteDigest: analysis.suiteDigest,
    caseSet: analysis.caseSet,
    caseSetDigest: analysis.caseSetDigest,
    mode: estimateReason === undefined ? "decision" : "estimate-only",
    modeReasons: estimateReason === undefined ? [] : [estimateReason],
    estimand: analysis.estimand,
    alpha: analysis.alpha,
    replicates: analysis.replicates,
    arms,
    measures: analysis.measures.map(({ id, version, pin }) => ({
      kind: "measure",
      id,
      version,
      digest: pin,
    })),
    primary: analysis.primary.map(({ targetDrop: _targetDrop, ...primary }) => ({
      ...primary,
      margin: primary.margin ?? 0,
      marginStatus: "registered",
      marginReason:
        primary.margin === undefined ? "No margin registered" : "From the analysis plan",
    })),
    secondary: analysis.secondary,
    hardGates: execution?.noise ? [] : analysis.hardGates,
    policy: analysis.policy,
    power: [],
    budget: {
      worstCaseCalls: execution === undefined ? 0 : trials.length * (analysis.callsPerTrial ?? 1),
      maxCalls: analysis.maxCalls,
      ...(execution === undefined ? {} : { callsPerTrial: analysis.callsPerTrial ?? 1 }),
    },
    trials,
    seed: { algorithm: "mt19937", value: String(options.seed) },
  });
  return { cases, plan };
}
