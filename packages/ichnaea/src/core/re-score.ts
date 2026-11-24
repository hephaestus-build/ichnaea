import { canonicalize } from "../contracts/canonical.ts";
import type { Plan } from "../contracts/records/plan.ts";
import { Trial } from "../contracts/records/trial.ts";

import { ImportError } from "./record-run.ts";
import type { StoredRun } from "./store.ts";

const key = (caseId: string, replicate: number, role: string): string =>
  canonicalize([caseId, replicate, role]);

/** Transfers captured evidence by case, replicate and arm role, without the old scores. */
export function reScoreTrials(source: StoredRun, plan: Plan, run: string): readonly Trial[] {
  if (plan.suite !== source.plan.suite || plan.caseSetDigest !== source.plan.caseSetDigest)
    throw new ImportError("the source run uses another suite or case set");
  const original = new Map(source.plan.arms.map((arm) => [arm.role, arm]));
  const bound = new Map(plan.arms.map((arm) => [arm.name, arm]));
  if (
    original.size !== bound.size ||
    plan.arms.some(({ role, identity }) => original.get(role)?.identity !== identity)
  )
    throw new ImportError("the source run uses different arm configurations");

  const byArm = new Map(source.plan.arms.map((arm) => [arm.name, arm]));
  const slots = new Map(
    plan.trials.map((slot) => [
      key(slot.case, slot.replicate, bound.get(slot.arm)?.role ?? ""),
      slot,
    ]),
  );
  const evidence = source.trials.flatMap((trial) => {
    if (!trial.case || !trial.arm) return [];
    const sourceArm = byArm.get(trial.arm);
    if (!sourceArm) throw new ImportError(`unknown source arm for trial '${trial.id}'`);
    const slot = slots.get(key(trial.case, trial.replicate, sourceArm.role));
    if (!slot) return [];
    return [
      Trial.parse({
        ...trial,
        id: slot.id,
        run,
        arm: slot.arm,
        analysisPlan: undefined,
        block: undefined,
        first: undefined,
        armOrderSeed: undefined,
        evidence: trial.evidence?.map(({ name, digest }) => ({ name, digest })),
      }),
    ];
  });
  if (evidence.length === 0) throw new ImportError("no captured source trials match the new plan");
  return evidence;
}
