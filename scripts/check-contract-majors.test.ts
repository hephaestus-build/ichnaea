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

describe("two majors of one record, both registered", () => {
  const both = [
    { name: "suite", id: "ichnaea.suite/1" },
    { name: "suite.2", id: "ichnaea.suite/2" },
  ];
  it("needs no migration while the previous major is still registered beside the new one", () => {
    expect(majorProblems(both, { suite: { "1": null, "2": null } }, () => true)).toEqual([]);
  });
  it("lists the majors under the record's name from its schema ID, not under the file name", () => {
    expect(majorProblems(both, { suite: { "1": null } }, () => true)).toEqual([
      "suite: the contract is at major 2, majors.json lists up to 1",
    ]);
  });
  it("needs the migration again once the previous major leaves the registry", () => {
    expect(majorProblems([both[1]!], { suite: { "1": null, "2": null } }, () => true)).toEqual([
      "suite: major 2 has no migration from major 1",
    ]);
  });
  it("refuses a registered major that majors.json does not list", () => {
    expect(
      majorProblems(both, { suite: { "2": "src/migrations/suite-1-2.ts" } }, () => true),
    ).toEqual(["suite: major 1 is registered, majors.json does not list it"]);
  });
});
