import type { Plan } from "../contracts/records/plan.ts";
import type { RunReduction } from "../contracts/records/run.ts";
import type { StoredRun } from "../core/store.ts";

import { mustNeverTables } from "./never.ts";

import type { ReportTable, RunView } from "./render.ts";
import { percent } from "./view.ts";

function reductionCells(row: RunReduction["overall"]): readonly [string, string, string] {
  return row.status === "missing"
    ? ["Missing", "Missing", "missing"]
    : [percent(row.passAll), percent(row.passAny), row.status];
}

function reductionTable(stored: StoredRun, id: (value: string) => string): ReportTable[] {
  const registration = stored.plan.trialReduction;
  const reduction = stored.run.trialReduction;
  if (!registration || !reduction) return [];
  const { k, measure } = registration;
  const { cases, overall } = reduction;
  return [
    {
      title: "Trial reductions",
      note: `${id(measure)} defines success. k = ${k}. The overall row weights each registered case equally and requires a value for every case. These are descriptive results without confidence intervals.`,
      columns: ["Case", "Valid trials", "pass^k", "pass@k", "Result"],
      rows: [
        ...cases.map((c) => [
          id(c.case),
          `${c.validTrials} of ${c.plannedTrials}`,
          ...reductionCells(c),
        ]),
        [
          "Overall",
          `${cases.filter((c) => c.status !== "missing").length} of ${cases.length} cases`,
          ...reductionCells(overall),
        ],
      ],
    },
  ];
}

function quantityValues(
  stored: StoredRun | undefined,
  measure: NonNullable<Plan["quantities"]>[number],
): ReadonlyMap<string, string> {
  if (!stored) return new Map();
  const observed = new Map(stored.trials.map((t) => [t.id, t.outcome]));
  const values = new Map(
    stored.values.filter((v) => v.measure === measure.measure).map((v) => [v.trial, v]),
  );
  const cases = new Map<string, string[]>();
  for (const trial of stored.plan.trials) {
    const outcome = observed.get(trial.id);
    const record = values.get(trial.id);
    const scores = cases.get(trial.case) ?? [];
    const value = record?.value;
    scores.push(
      record?.applicable === false
        ? "Not applicable"
        : (outcome === "completed" || outcome === "abstained") && value?.type === "quantity"
          ? `${value.value} ${measure.unit}`
          : "Missing",
    );
    cases.set(trial.case, scores);
  }
  return new Map([...cases].map(([key, scores]) => [key, scores.join(", ")]));
}

/** Builds the descriptive tables from stored values and the locked case and measure identities. */
export function oneArmView(
  stored: StoredRun,
  previous: StoredRun | undefined,
  neutral = false,
): RunView {
  const id = (value: string): string => (neutral ? "id" : value);
  const { plan, run } = stored;
  const tables = [...reductionTable(stored, id), ...mustNeverTables(stored, id)];

  for (const measure of plan.quantities ?? []) {
    const before = previous?.plan.measures.find((m) => m.id === measure.measure);
    const current = plan.measures.find((m) => m.id === measure.measure);
    const comparable = before && current && before.digest === current.digest ? previous : undefined;
    const old = quantityValues(comparable, measure);
    const now = quantityValues(stored, measure);
    tables.push({
      title: `Quantity: ${id(measure.measure)}`,
      note: "Values are listed in planned trial order.",
      columns: [
        "Case",
        "This run",
        comparable ? `Previous run (${id(comparable.run.id)})` : "Previous run",
      ],
      rows: [...now].map(([key, value]) => [
        id(key),
        neutral ? "values" : value,
        old.has(key) && neutral ? "values" : (old.get(key) ?? "Unavailable"),
      ]),
    });
  }
  if (!stored.decision && stored.gates.length > 0)
    tables.push({
      title: "Hard gates",
      columns: ["Gate", "Result"],
      rows: stored.gates.map((gate) => [
        id(gate.gate),
        gate.passed ? "passed" : `failed (${gate.failures})`,
      ]),
    });

  return {
    title: `Ichnaea run: ${id(plan.suite)}`,
    details: stored.trials.some((t) => t.outcome === "protocol_failure")
      ? "A trial reported a protocol failure. These descriptive results give no verdict."
      : "One arm. These descriptive results give no verdict.",
    tables,
    lineage: [
      ["Run", id(run.id)],
      ["Plan", id(run.plan)],
      ["Suite", id(plan.suiteDigest)],
      ...plan.arms.map((a) => [`Arm ${id(a.name)}`, id(a.identity)] as const),
      ...run.lineage.map(
        (l) => [id(l.id), id(l.digest ? `${l.version} (${l.digest})` : l.version)] as const,
      ),
      ["Seed", id(plan.seed.value)],
      ["Ichnaea", id(plan.ichnaea)],
    ] as const,
  };
}
