// Runs the simulations off the main thread, so the page stays responsive while they run.
import {
  bestCaseFloor,
  detectableDecrease,
  regressionLimitations,
  simulateNoChange,
  type Design,
} from "./model.ts";

export interface PlannerRequest {
  readonly id: number;
  readonly design: Design;
  readonly seed: number;
}

export interface PlannerResult {
  readonly id: number;
  readonly floor: number;
  readonly limitations: readonly string[];
  readonly noChange: ReturnType<typeof simulateNoChange>;
  readonly detectable: number | undefined;
  readonly detectableRuns: number;
}

/** Runs per simulated setting. The page states both numbers next to the results. */
export const NO_CHANGE_RUNS = 200;
export const DETECTION_RUNS = 100;

self.addEventListener("message", (event: MessageEvent<PlannerRequest>) => {
  const { id, design, seed } = event.data;
  const result: PlannerResult = {
    id,
    floor: bestCaseFloor(design),
    limitations: regressionLimitations(design),
    noChange: simulateNoChange(design, NO_CHANGE_RUNS, seed),
    detectable: detectableDecrease(design, { power: 0.8, runs: DETECTION_RUNS, seed: seed + 1 }),
    detectableRuns: DETECTION_RUNS,
  };
  // A worker posts to its own page: there is no target origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  self.postMessage(result);
});
