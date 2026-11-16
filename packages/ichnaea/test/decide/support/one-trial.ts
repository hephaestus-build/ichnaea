// Records for decisions at one trial per case and arm: trial timestamps in a chosen run order, and
// decided A/A runs to cite.
import { digest, type Decision, type Plan } from "../../../src/contracts/index.ts";
import { type AaEvidence, decide } from "../../../src/decide/index.ts";
import { configuration, type Scenario, scenario, type ScenarioOptions } from "./scenario.ts";

export const SCHEDULE: NonNullable<Plan["schedule"]> = { concurrency: 1, endpoint: "example" };

/** One trial per case and arm on 20 cases that always pass, with the schedule stated. */
export const ONE: ScenarioOptions = {
  cases: 20,
  replicates: 1,
  base: () => 1,
  candidate: () => 1,
  schedule: SCHEDULE,
};

const START = Date.UTC(2026, 10, 15, 10, 0, 0);
const at = (ms: number): string => new Date(START + ms).toISOString();

/**
 * Stamps the trials in `order` (default: the plan's order): the trial at position p starts at p
 * seconds and overlaps the next `concurrency` − 1 trials, so the records show `concurrency` trials
 * at once and the start ranks are the positions.
 */
export function timed(
  s: Scenario,
  concurrency = 1,
  order: readonly string[] = s.plan.trials.map((t) => t.id),
): Scenario {
  const position = new Map(order.map((id, p) => [id, p]));
  return {
    ...s,
    trials: s.trials.map((t) => {
      const p = position.get(t.id);
      if (p === undefined) return t;
      return {
        ...t,
        startedAt: at(p * 1000),
        endedAt: at(p * 1000 + (concurrency - 1) * 1000 + 500),
      };
    }),
  };
}

/** The trial IDs in plan order, with the trial at `from` moved to `to`. */
export function moved(s: Scenario, from: number, to: number): string[] {
  const ids = s.plan.trials.map((t) => t.id as string);
  const [id] = ids.splice(from, 1);
  ids.splice(to, 0, id as string);
  return ids;
}

export const decideAt = (s: Scenario, aa?: readonly AaEvidence[]): Promise<Decision> =>
  decide({
    ...s,
    ...(aa === undefined ? {} : { aa }),
    decidedAt: "2026-11-15T12:00:00Z",
    ichnaea: "0.0.0",
  });

/** A decided A/A run: both arms run the base configuration, timed in plan order. */
export async function aaRun(run: string, over: Partial<ScenarioOptions> = {}): Promise<AaEvidence> {
  const s = timed(
    await scenario({
      ...ONE,
      runId: run,
      candidateConfig: () => configuration("model-a", "a1"),
      ...over,
    }),
  );
  return { decision: await decideAt(s), plan: s.plan, run: s.run };
}

/** Two clean A/A runs of the suite of `ONE`. */
export const cleanAa = async (): Promise<AaEvidence[]> => [
  await aaRun("aa-1"),
  await aaRun("aa-2", { seed: 8 }),
];

/** The citations of A/A evidence, as `ichnaea import --aa` records them. */
export const cite = async (aa: readonly AaEvidence[]): Promise<NonNullable<Plan["aa"]>> => ({
  decisions: await Promise.all(
    aa.map(async (e) => ({ run: e.decision.run, digest: await digest(e.decision) })),
  ),
});
