import { describe, expect, it } from "vitest";

import { findViolations } from "./check-purity.ts";

describe("framework purity check", () => {
  it.each([
    ["an application name", 'const target = "Hephaestus";'],
    ["an application concept", "// counts the practice review stops"],
    ["an application path", 'run("./gradlew test")'],
  ])("fails on %s", (_, line) => {
    expect(findViolations([{ path: "packages/x/src/a.ts", text: line }])).toHaveLength(1);
  });

  it("allows the npm scope", () => {
    expect(
      findViolations([{ path: "p.json", text: '"@hephaestus-build/ichnaea-contracts"' }]),
    ).toEqual([]);
  });
});
