import type { StoredRun } from "../core/store.ts";

import type { ReportTable } from "./render.ts";
import { percent } from "./view.ts";

/** The evidence and scope of the one-arm must-never claims. */
export function mustNeverTables(stored: StoredRun, text: (value: string) => string): ReportTable[] {
  const registrations = new Map(stored.plan.mustNever?.map((r) => [r.measure, r]));
  return (stored.run.mustNever ?? []).flatMap(({ measure, claim, hits, missing, clean, cases }) => {
    const registration = registrations.get(measure);
    if (!registration) return [];
    const { detector, population, ceiling, confidence } = registration;
    const scope = detector.kind === "deterministic" ? detector.pattern : detector.scope;
    let result: string;
    if (claim.status === "flagged-only") {
      result = "No ceiling. No matching absolute sensitivity bound at the required confidence.";
    } else if (claim.bound === null) {
      result = "No ceiling. The calibrated lower bound on sensitivity is zero.";
    } else {
      const shown = claim.status === "shown" ? "shown" : "not shown";
      result = `Ceiling ${percent(ceiling)} ${shown}. The one-sided ${percent(confidence)} upper bound is ${percent(claim.bound)} (${claim.method}).`;
    }
    return [
      {
        title: `Must-never measure ${text(measure)}`,
        note: `Population: ${text(population)}. Detector (${detector.kind}): ${text(scope)}. This claim covers the listed cases at their planned trial counts. ${result}`,
        columns: ["Cases", "Clean", "Hits", "Missing without a hit", "Observed flagged rate"],
        rows: [[cases.length, clean, hits, missing, percent(hits / cases.length)]],
      },
      {
        title: `Trial counts for ${text(measure)}`,
        columns: ["Case", "Planned trials"],
        rows: cases.map((c) => [text(c.case), c.trials]),
      },
    ];
  });
}
