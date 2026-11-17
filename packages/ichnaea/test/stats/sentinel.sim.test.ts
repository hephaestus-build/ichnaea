import { describe, expect, it } from "vitest";

import { sentinelDetectableDrift } from "../../src/stats/index.ts";
import { sentinelPowerExact, sentinelPowerSimulated } from "../../src/stats/sentinel.ts";

// The simulated power of the drift guard against its exact power, at sizes where both run.
describe("the simulated power of the drift guard", () => {
  it("agrees with the exact power within 4 standard errors", () => {
    for (const [cases, stored, fresh] of [
      [15, 0.8, 0.425],
      [15, 0.5, 0.7],
      [30, 0.7, 0.45],
    ] as const) {
      const exact = sentinelPowerExact(cases, 2, stored, fresh);
      const simulated = sentinelPowerSimulated(cases, 2, stored, fresh, 10_000, 3);
      const se = Math.sqrt((exact * (1 - exact)) / 10_000);
      expect(Math.abs(simulated - exact), `${cases} ${stored} ${fresh}`).toBeLessThan(4 * se);
    }
  }, 60_000);

  it("finds the drift that the exact power finds, within its simulation error", () => {
    const result = sentinelDetectableDrift({ cases: 41, trials: 2, rate: 0.6, seed: 5 });
    const se = Math.sqrt((0.8 * 0.2) / 10_000);
    for (const [sign, direction] of [
      [-1, result.down],
      [1, result.up],
    ] as const) {
      const drift = direction.drift!;
      expect(sentinelPowerExact(41, 2, 0.6, 0.6 + sign * drift)).toBeGreaterThan(0.8 - 4 * se);
      expect(sentinelPowerExact(41, 2, 0.6, 0.6 + sign * (drift - 0.05))).toBeLessThan(
        0.8 + 4 * se,
      );
    }
  }, 300_000);
});
