import { readFile } from "node:fs/promises";

import {
  Case,
  CaseSet,
  Configuration,
  digest,
  type Plan,
  Suite,
} from "@hephaestus-build/ichnaea-contracts";

import type { Host } from "./host.ts";
import { scoreTrials } from "./measures.ts";
import { createPlan } from "./planner.ts";
import { FileStore } from "./store.ts";

/** What `ichnaea import` needs. */
export interface ImportRunInput {
  readonly host: Host;
  readonly store: string;
  readonly run: string;
  readonly importer: string;
  readonly suite: string;
  readonly caseSet: string;
  readonly cases: string;
  readonly arms: ReadonlyArray<{
    readonly name: string;
    readonly role: "base" | "candidate" | "reference";
    readonly configuration: string;
  }>;
  readonly files: readonly string[];
  readonly trigger: Plan["trigger"];
  readonly seed: number;
  readonly now: string;
  readonly ichnaea: string;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Import mode (REQ-22): resolves the plan, runs an importer over another runner's result files,
 * scores the measures Ichnaea computes, and stores plan, trials, values, gates and the run with its
 * ledger. Import mode makes no model call, so its worst-case calls are zero. Every trial must be a
 * planned trial, and a planned trial the importer does not return is recorded as not run.
 */
export async function importRun(
  input: ImportRunInput,
): Promise<{ plan: Plan; trials: number; values: number }> {
  const importer = input.host.importers.get(input.importer);
  if (!importer)
    throw new Error(
      `no importer '${input.importer}'; the plugins provide: ${[...input.host.importers.keys()].join(", ") || "none"}`,
    );
  const suite = Suite.parse(await json(input.suite));
  const caseSet = CaseSet.parse(await json(input.caseSet));
  const cases = (await readFile(input.cases, "utf8"))
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      const parsed = Case.safeParse(JSON.parse(l));
      if (!parsed.success)
        throw new Error(
          `${input.cases}:${i + 1}: invalid case: ${parsed.error.issues[0]?.message ?? ""}`,
        );
      return parsed.data;
    });
  const arms = await Promise.all(
    input.arms.map(async (a) => ({
      name: a.name,
      role: a.role,
      configuration: Configuration.parse(await json(a.configuration)),
    })),
  );
  const planned = await createPlan({
    suite,
    caseSet,
    cases,
    arms,
    armsToRun: [],
    measures: input.host.measures,
    trigger: input.trigger,
    seed: input.seed,
    now: input.now,
    ichnaea: input.ichnaea,
  });
  const plan = await input.host.planCreated(planned);

  const result = await importer.run({
    files: input.files,
    options: {
      arms: plan.arms.map((a) => ({ name: a.name, identity: a.identity })),
      run: input.run,
    },
  });
  const plannedIds = new Set(plan.trials.map((t) => t.id as string));
  const unplanned = result.trials.filter((t) => !plannedIds.has(t.id));
  if (unplanned.length > 0)
    throw new Error(
      `the importer returned ${unplanned.length} trial(s) the plan does not list, for example '${unplanned[0]?.id}'`,
    );
  const identities = new Map(plan.arms.map((a) => [a.name as string, a.identity as string]));
  for (const t of result.trials) {
    if (t.arm === undefined || identities.get(t.arm) !== t.configuration)
      throw new Error(`trial '${t.id}' does not carry the identity of its arm '${t.arm ?? "?"}'`);
  }
  const byCase = new Map(cases.map((c) => [c.id as string, c]));
  const values = [
    ...result.values,
    ...scoreTrials([...input.host.measures.values()], result.trials, byCase),
  ];

  const store = new FileStore(input.store);
  await store.writePlan(input.run, plan);
  await store.appendTrials(input.run, result.trials);
  await store.appendValues(input.run, values);
  await store.appendGates(input.run, result.gates ?? []);
  const recorded = new Map(result.trials.map((t) => [t.id as string, t.outcome]));
  await store.writeRun({
    schema: "ichnaea.run/1",
    id: input.run,
    plan: await digest(plan),
    exploratory: false,
    environment: {
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
      ichnaea: input.ichnaea,
    },
    arms: plan.arms,
    lineage: [
      ...input.host.plugins.map((p) => ({ kind: "plugin" as const, id: p.id, version: p.version })),
      { kind: "plugin" as const, id: importer.id, version: importer.version },
      ...[...input.host.measures.values()].map((m) => ({
        kind: "measure" as const,
        id: m.card.id,
        version: m.card.version,
      })),
    ],
    ledger: plan.trials.map((t) => {
      const outcome = recorded.get(t.id);
      return outcome
        ? { trial: t.id, state: "recorded", outcome }
        : { trial: t.id, state: "recorded", outcome: "not_run" };
    }),
    startedAt: input.now,
    completedAt: input.now,
  } as never);
  return { plan, trials: result.trials.length, values: values.length };
}
