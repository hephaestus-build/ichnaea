import { describe, expect, it } from "vitest";

import { majorProblems } from "./check-contract-majors.ts";

describe("contract majors (REQ-07)", () => {
  const contracts = [{ name: "trial", id: "ichnaea.trial/2" }];
  it("refuses a new major without a migration", () => {
    expect(majorProblems(contracts, { trial: { "1": null } }, () => true)).toEqual([
      "trial: the contract is at major 2, majors.json lists up to 1",
    ]);
    expect(majorProblems(contracts, { trial: { "1": null, "2": null } }, () => true)).toEqual([
      "trial: major 2 has no migration from major 1",
    ]);
    expect(
      majorProblems(
        contracts,
        { trial: { "1": null, "2": "src/migrations/trial-1-2.ts" } },
        () => false,
      )[0],
    ).toMatch(/does not exist/);
  });
  it("accepts a major with an existing migration", () => {
    expect(
      majorProblems(
        contracts,
        { trial: { "1": null, "2": "src/migrations/trial-1-2.ts" } },
        () => true,
      ),
    ).toEqual([]);
  });
});
