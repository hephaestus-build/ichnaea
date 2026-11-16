// One trial per case and arm from the CLI: two A/A runs are imported and decided, the change's
// plan cites them with --aa, and decide and report load them from the store (REQ-25).
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { main } from "@tumaet/ichnaea";
import { candidateRunsFirst, digest } from "@tumaet/ichnaea/contracts";
import { describe, expect, it } from "vitest";

const here = join(import.meta.dirname, "..");
const at = (path: string): string => resolve(here, path);

interface Answer {
  readonly case: string;
  readonly replicate: number;
  readonly outcome: string;
  readonly answer?: string;
}

/** The first run of each case from a result file, at one trial per case. */
async function firstRuns(file: string): Promise<Answer[]> {
  const parsed = JSON.parse(await readFile(at(file), "utf8")) as { runs: Answer[] };
  return parsed.runs.filter((r) => r.replicate === 0);
}

/**
 * Writes one result file per arm, each trial timed one after the other in the coin's order of its
 * case, as a runner at concurrency 1 runs the plan.
 */
async function results(
  dir: string,
  name: string,
  seed: number,
  base: readonly Answer[],
  candidate: readonly Answer[],
): Promise<string[]> {
  const START = Date.UTC(2026, 10, 15, 9, 0, 0);
  const time = (slot: number) => ({
    startedAt: new Date(START + slot * 1000).toISOString(),
    endedAt: new Date(START + slot * 1000 + 500).toISOString(),
  });
  const slots = new Map<string, number>();
  for (const [i, r] of base.entries()) {
    const candidateFirst = await candidateRunsFirst(
      { algorithm: "mt19937", value: String(seed) },
      r.case,
    );
    slots.set(`${r.case}/base`, 2 * i + (candidateFirst ? 1 : 0));
    slots.set(`${r.case}/candidate`, 2 * i + (candidateFirst ? 0 : 1));
  }
  const files: string[] = [];
  for (const [arm, runs] of [
    ["base", base],
    ["candidate", candidate],
  ] as const) {
    const file = join(dir, `${name}-${arm}.json`);
    await writeFile(
      file,
      JSON.stringify({
        arm,
        runs: runs.map((r) => ({ ...r, ...time(slots.get(`${r.case}/${arm}`) as number) })),
      }),
    );
    files.push(file);
  }
  return files;
}

describe("one trial per case and arm, from the CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ichnaea-one-trial-"));
  const store = join(dir, "store");
  const suite = join(dir, "suite.json");
  await writeFile(
    suite,
    JSON.stringify({
      ...(JSON.parse(await readFile(at("data/suite.json"), "utf8")) as object),
      replicates: 1,
    }),
  );
  const config = ["--config", at("ichnaea.config.ts")];
  const same = await firstRuns("results/candidate-same.json");
  // Half the cases lose their fact: an exact McNemar p-value of 0.5^6.
  const regressed = same.map((r, i) =>
    i < 6 ? { ...r, answer: "Please check our help centre." } : r,
  );
  const out: string[] = [];
  const log = (t: string): void => void out.push(t);
  const schedule = ["--concurrency", "1", "--endpoint", "example-provider"];

  async function importRun(
    run: string,
    seed: number,
    candidate: string,
    files: readonly string[],
    extra: readonly string[] = [],
  ): Promise<number> {
    return main(
      [
        "import",
        ...config,
        "--importer",
        "support/results",
        "--suite",
        suite,
        "--case-set",
        at("data/case-set.json"),
        "--cases",
        at("data/cases.jsonl"),
        "--arm",
        `base:base:${at("configurations/base.json")}`,
        "--arm",
        `candidate:candidate:${at(candidate)}`,
        ...files.flatMap((f) => ["--file", f]),
        "--run",
        run,
        "--store",
        store,
        "--now",
        "2026-11-15T10:00:00Z",
        "--seed",
        String(seed),
        ...extra,
      ],
      log,
    );
  }
  const decideRun = (run: string): Promise<number> =>
    main(
      ["decide", ...config, "--store", store, "--run", run, "--now", "2026-11-15T11:00:00Z"],
      log,
    );

  it("decides two A/A runs, cites them, and validates the change's REGRESSION", async () => {
    for (const [run, seed] of [
      ["aa-1", 11],
      ["aa-2", 12],
    ] as const) {
      const files = await results(dir, run, seed, same, same);
      expect(
        await importRun(run, seed, "configurations/base.json", files, schedule),
        out.join("\n"),
      ).toBe(0);
      expect(await decideRun(run), out.join("\n")).toBe(0);
    }
    const files = await results(dir, "run-1", 7, same, regressed);
    const cited = ["--aa", "aa-1", "--aa", "aa-2"];
    const vary = ["--trigger", "new-model", "--vary", "prompt.answer"];
    expect(
      await importRun("run-1", 7, "configurations/candidate.json", files, [
        ...schedule,
        ...cited,
        ...vary,
      ]),
      out.join("\n"),
    ).toBe(0);
    expect(out.join("\n")).toContain("import: run run-1: 24 trials");
    expect(await decideRun("run-1"), out.join("\n")).toBe(1);
    expect(out.join("\n")).toMatch(/^REGRESSION: Measure support\/facts-stated dropped/m);

    const read = async (run: string, name: string): Promise<Record<string, unknown>> =>
      JSON.parse(await readFile(join(store, "runs", run, name), "utf8")) as Record<string, unknown>;
    const plan = (await read("run-1", "plan.json")) as {
      aa: { decisions: { run: string; digest: string }[] };
      schedule: unknown;
    };
    expect(plan.schedule).toEqual({ concurrency: 1, endpoint: "example-provider" });
    expect(plan.aa.decisions).toEqual([
      { run: "aa-1", digest: await digest(await read("aa-1", "decision.json")) },
      { run: "aa-2", digest: await digest(await read("aa-2", "decision.json")) },
    ]);
    const decision = (await read("run-1", "decision.json")) as {
      measures: { comparisons: { regression: unknown }[] }[];
    };
    expect(decision.measures[0]?.comparisons[0]?.regression).toEqual({
      validated: true,
      limitations: [],
    });
    // The report recomputes the decision with the same A/A records.
    expect(
      await main(["report", ...config, "--store", store, "--run", "run-1"], log),
      out.join("\n"),
    ).toBe(0);
  });

  it("refuses --aa for a run without a decision, and a schedule given in half", async () => {
    const files = await results(dir, "run-2", 7, same, same);
    out.length = 0;
    expect(await importRun("run-2", 7, "configurations/base.json", files, ["--aa", "aa-9"])).toBe(
      2,
    );
    expect(out.join("\n")).toContain("--aa run 'aa-9' has no decision in the store");
    out.length = 0;
    expect(
      await importRun("run-2", 7, "configurations/base.json", files, ["--concurrency", "2"]),
    ).toBe(2);
    expect(out.join("\n")).toContain("import: --concurrency and --endpoint go together");
    out.length = 0;
    expect(
      await importRun("run-2", 7, "configurations/base.json", files, [
        "--concurrency",
        "0",
        "--endpoint",
        "e",
      ]),
    ).toBe(2);
    expect(out.join("\n")).toContain("import: --concurrency must be a whole number from 1");
  });
});
