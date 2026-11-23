import type { MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
import { neverClaim } from "../stats/never.ts";

/** Counts cases with a detector hit or missing evidence, then evaluates each declared ceiling. */
export function mustNeverResults(
  plan: Plan,
  trials: readonly Trial[],
  values: readonly MeasureValue[],
): Run["mustNever"] {
  if (!plan.mustNever || plan.arms.length !== 1) return undefined;
  const observed = new Set(
    trials.filter((t) => t.outcome === "completed" || t.outcome === "abstained").map((t) => t.id),
  );

  return plan.mustNever.map(({ measure, cases, ceiling, confidence, detector, population }) => {
    const counts = new Map(cases.map((id) => [id, { case: id, trials: 0, seen: 0, hit: false }]));
    const scored = new Map(
      values.filter((v) => v.measure === measure && v.applicable).map((v) => [v.trial, v.value]),
    );
    for (const trial of plan.trials) {
      const entry = counts.get(trial.case);
      if (!entry) continue;
      entry.trials++;
      const value = scored.get(trial.id);
      if (!observed.has(trial.id) || value?.type !== "binary") continue;
      entry.seen++;
      entry.hit ||= value.pass;
    }
    const populationCounts = [...counts.values()];
    const hits = populationCounts.filter((entry) => entry.hit).length;
    const missing = populationCounts.filter(
      (entry) => !entry.hit && entry.seen < entry.trials,
    ).length;
    const calibration = detector.kind === "model" ? detector.calibration : undefined;
    const measureDigest = plan.measures.find((item) => item.id === measure)?.digest;
    const splitConfidence = 1 - (1 - confidence) / 2;
    const sensitivityLower =
      calibration &&
      calibration.measureDigest === measureDigest &&
      calibration.population === population &&
      calibration.confidence >= splitConfidence
        ? calibration.sensitivityLower
        : null;
    const result = neverClaim({
      violations: detector.kind === "model" && sensitivityLower === null ? hits : hits + missing,
      cases: cases.length,
      ceiling,
      confidence,
      detector:
        detector.kind === "model" ? { kind: "model", sensitivityLower } : { kind: "deterministic" },
    });
    return {
      measure,
      hits,
      clean: cases.length - hits - missing,
      missing,
      cases: populationCounts.map((entry) => ({ case: entry.case, trials: entry.trials })),
      claim: {
        status: result.status,
        bound: result.status === "flagged-only" ? null : result.bound,
        level: result.level,
        method: result.method,
      },
    };
  });
}
