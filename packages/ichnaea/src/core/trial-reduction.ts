import type { MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { RunReduction } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
import { reduceTrials } from "../stats/reduce.ts";

/** Applies the locked reduction to one arm, under REQ-20's binary outcome rules. */
export function runReduction(
  plan: Plan,
  recorded: readonly Trial[],
  values: readonly MeasureValue[],
): RunReduction | undefined {
  const registration = plan.trialReduction;
  if (!registration || plan.arms.length !== 1) return undefined;
  const { measure, k } = registration;
  const observed = new Map(recorded.map((t) => [t.id, t.outcome]));
  const scored = new Map(values.filter((v) => v.measure === measure).map((v) => [v.trial, v]));
  const byCase = new Map(
    registration.cases.map((id) => [id, { trials: 0, binary: [] as number[] }]),
  );
  for (const planned of plan.trials) {
    const counts = byCase.get(planned.case);
    if (!counts) continue;
    counts.trials++;
    const value = scored.get(planned.id);
    if (value?.applicable === false) continue;
    const outcome = observed.get(planned.id);
    if (outcome === "system_failure" || outcome === "budget_exceeded") counts.binary.push(0);
    if ((outcome === "completed" || outcome === "abstained") && value?.value?.type === "binary")
      counts.binary.push(Number(value.value.pass));
  }

  const cases = [...byCase].map(([id, { trials, binary }]): RunReduction["cases"][number] => {
    const counts = { case: id, plannedTrials: trials, validTrials: binary.length };
    if (binary.length < k) return { ...counts, status: "missing" };
    return {
      ...counts,
      status: binary.length === k ? "observed" : "estimate-only",
      passAll: reduceTrials(binary, { all: { k } }),
      passAny: reduceTrials(binary, { any: { k } }),
    };
  });
  const available = cases.filter((c) => c.status !== "missing");
  return {
    cases,
    overall:
      available.length < cases.length
        ? { status: "missing" }
        : {
            status: available.some((c) => c.status === "estimate-only")
              ? "estimate-only"
              : "observed",
            passAll: available.reduce((sum, c) => sum + c.passAll, 0) / available.length,
            passAny: available.reduce((sum, c) => sum + c.passAny, 0) / available.length,
          },
  };
}
