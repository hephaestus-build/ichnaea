// VALIDATION.md, "Results of the CI gate", against what CI runs: the workflows, their repetitions
// and the study files. Each study checks its own row of the results table when it runs
// (test/stats/support/documented.ts); this test checks, in the unit suite, that the table has one row per
// study and names what the workflows run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DOCUMENTED_REPS, documentedRows, VALIDATION_PAGE } from "./support/documented.ts";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const section = VALIDATION_PAGE.split("\n## Results of the CI gate\n")[1]?.split("\n## ")[0] ?? "";
const studies = readdirSync(import.meta.dirname).filter((f) => f.endsWith(".sim.test.ts"));
const workflows = ["ci.yml", "nightly.yml"].map((file) => ({
  file,
  text: readFileSync(join(root, ".github", "workflows", file), "utf8"),
}));

describe("VALIDATION.md states what CI runs", () => {
  it("has one row per grid that a study judges, and no other", () => {
    const titles = studies.flatMap((f) =>
      [
        ...readFileSync(join(import.meta.dirname, f), "utf8").matchAll(
          /judge\(\s*[^;]*?,\s*(?:COVERAGE|TYPE_I),\s*"([^"]+)"\s*\)/g,
        ),
      ].map((m) => m[1] as string),
    );
    expect(titles.length).toBeGreaterThan(0);
    expect([...documentedRows().keys()].toSorted()).toEqual(titles.toSorted());
  });

  it("names every study file, and no other", () => {
    const named = [...section.matchAll(/`test\/stats\/([\w.-]+\.sim\.test\.ts)`/g)].map(
      (m) => m[1],
    );
    expect(named.toSorted()).toEqual(studies.toSorted());
  });

  it("gives each workflow's repetitions and command, and records the pull-request run", () => {
    for (const { file, text } of workflows) {
      const reps = /ICHNAEA_SIM_REPS: "(\d+)"/.exec(text)?.[1];
      expect(text).toContain("run: pnpm --filter @tumaet/ichnaea run test:sim:stats");
      const line = section.split("\n- ").find((item) => item.includes(`.github/workflows/${file}`));
      expect(line, file).toContain(`ICHNAEA_SIM_REPS=${reps}`);
      if (file === "ci.yml") expect(Number(reps)).toBe(DOCUMENTED_REPS);
    }
    expect(section).toContain("`pnpm --filter @tumaet/ichnaea run test:sim:stats`");
  });
});
