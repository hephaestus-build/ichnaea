// The whole path from the CLI: import another runner's results, decide, report. The example
// application is synthetic and uses only published Ichnaea parts (the substitution test).
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { FLOOR_NOT_SET_REASON, main } from "@hephaestus-build/ichnaea";
import { describe, expect, it } from "vitest";

const here = join(import.meta.dirname, "..");
const at = (path: string): string => resolve(here, path);

async function flow(
  candidateResults: string,
  varies: readonly string[] = ["prompt.answer"],
  trigger: string | null = "new-model",
  suite = at("data/suite.json"),
): Promise<{ store: string; out: string[]; codes: number[] }> {
  const store = await mkdtemp(join(tmpdir(), "ichnaea-e2e-"));
  const out: string[] = [];
  const log = (t: string): void => void out.push(t);
  const config = ["--config", at("ichnaea.config.ts")];
  const codes = [
    await main(
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
        `candidate:candidate:${at("configurations/candidate.json")}`,
        "--file",
        at("results/base.json"),
        "--file",
        at(candidateResults),
        "--run",
        "run-1",
        "--store",
        store,
        "--now",
        "2026-11-15T10:00:00Z",
        "--seed",
        "7",
        // The candidate is a new model with a new prompt: a new-model change varies the model, and
        // the prompt it also changes is declared.
        ...(trigger === null ? [] : ["--trigger", trigger]),
        ...varies.flatMap((v) => ["--vary", v]),
      ],
      log,
    ),
    await main(
      ["decide", ...config, "--store", store, "--run", "run-1", "--now", "2026-11-15T11:00:00Z"],
      log,
    ),
    await main(["report", ...config, "--store", store, "--run", "run-1"], log),
  ];
  return { store, out, codes };
}

describe("example application, end to end", () => {
  it("an unchanged candidate is INCONCLUSIVE while the margin floor is not set, and says why", async () => {
    const { store, out, codes } = await flow("results/candidate-same.json");
    // The suite reports an INCONCLUSIVE verdict without blocking.
    expect(codes).toEqual([0, 0, 0]);
    // The line decide prints names the floor, so a first run does not read as a broken setup.
    expect(out).toContain(`INCONCLUSIVE: ${FLOOR_NOT_SET_REASON}`);
    expect(out.join("\n")).not.toMatch(/^PASS/m);
    // The planner prints what a run of the plan can detect at best (REQ-54).
    expect(out.join("\n")).toMatch(
      /power: support\/facts-stated: smallest detectable drop \d+\.\d points \(planning: .*\), margin 15\.0 points, can decide/,
    );
    const verdict = JSON.parse(
      await readFile(join(store, "runs", "run-1", "verdict.json"), "utf8"),
    ) as { verdict: string; reason: string };
    expect(verdict).toMatchObject({ verdict: "INCONCLUSIVE", reason: FLOOR_NOT_SET_REASON });
    // The report gives the same reason next to the verdict, and labels the bound.
    const summary = await readFile(join(store, "runs", "run-1", "report", "summary.md"), "utf8");
    expect(summary).toContain(
      `**INCONCLUSIVE** on these 12 cases, beyond run-to-run noise: ${FLOOR_NOT_SET_REASON}`,
    );
    expect(summary).toMatch(/≥ [+−]?\d+\.\d pts \(not validated\)/);
  });

  it("blocks a regression and names the broken cases in the report", async () => {
    const { store, codes, out } = await flow("results/candidate-regressed.json");
    expect(codes[1]).toBe(1);
    expect(out.join("\n")).toMatch(/^REGRESSION: /m);
    const summary = await readFile(join(store, "runs", "run-1", "report", "summary.md"), "utf8");
    expect(summary).toMatch(/REGRESSION/);
    expect(summary).toContain("support-03");
    const html = await readFile(join(store, "runs", "run-1", "report", "report.html"), "utf8");
    expect(html).toContain("Lineage");
  });

  it("a lost capture counts as missing, never as a wrong answer or a failed gate (REQ-20)", async () => {
    const same = JSON.parse(await readFile(at("results/candidate-same.json"), "utf8")) as {
      runs: Array<{ answer?: string }>;
    };
    delete same.runs[0]?.answer;
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-e2e-lost-"));
    const lost = join(dir, "candidate-capture-lost.json");
    await writeFile(lost, JSON.stringify(same));
    const { store, codes, out } = await flow(lost);
    expect(codes, out.join("\n")).toEqual([0, 0, 0]);
    const decision = JSON.parse(
      await readFile(join(store, "runs", "run-1", "decision.json"), "utf8"),
    ) as {
      verdict: string;
      gates: Array<{ passed: boolean }>;
      measures: Array<{ arms: Array<{ arm: string; availability: { missing: number } }> }>;
    };
    expect(decision.verdict).not.toBe("REGRESSION");
    expect(decision.gates.every((g) => g.passed)).toBe(true);
    expect(
      decision.measures[0]?.arms.find((a) => a.arm === "candidate")?.availability.missing,
    ).toBe(1);
  });

  it("a prompt change the run does not declare makes the run INVALID (REQ-15)", async () => {
    const { codes, out } = await flow("results/candidate-same.json", []);
    expect(codes[1]).toBe(1);
    expect(out.join("\n")).toMatch(/INVALID: a new-model change may vary only the model part/);
  });

  it("a first run without --trigger new-model is INVALID, and the message names the flags that fix it", async () => {
    const { codes, out } = await flow("results/candidate-same.json", [], null);
    expect(codes[1]).toBe(1);
    const message = out.find((line) => line.startsWith("INVALID:")) ?? "";
    expect(message).toContain("the arms also differ in model.answer, prompt.answer");
    expect(message).toContain("model.answer: --trigger new-model or --vary model.answer");
    expect(message).toContain("prompt.answer: --vary prompt.answer");
  });

  it("a placeholder margin runs estimate-only, and import still prints the planning MDE (REQ-54)", async () => {
    const suite = JSON.parse(await readFile(at("data/suite.json"), "utf8")) as {
      primary: Array<{ marginStatus: string }>;
    };
    for (const p of suite.primary) p.marginStatus = "placeholder";
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-e2e-placeholder-"));
    const path = join(dir, "suite.json");
    await writeFile(path, JSON.stringify(suite));
    const { store, codes, out } = await flow(
      "results/candidate-same.json",
      undefined,
      undefined,
      path,
    );
    expect(codes, out.join("\n")).toEqual([0, 0, 0]);
    expect(out.join("\n")).toMatch(/plan estimate-only/);
    expect(out.join("\n")).toMatch(
      /power: support\/facts-stated: smallest detectable drop \d+\.\d points \(planning: .*\), margin 15\.0 points, within reach of the margin, but the plan is estimate-only/,
    );
    const decision = JSON.parse(
      await readFile(join(store, "runs", "run-1", "decision.json"), "utf8"),
    ) as { verdict: unknown; power: { planning: Array<{ computed: boolean }> } };
    expect(decision.verdict).toBeNull();
    expect(decision.power.planning).toEqual([expect.objectContaining({ computed: true })]);
  });

  it("without the decision plugin the plan has no power statement, and import says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ichnaea-e2e-no-decide-"));
    const config = join(dir, "ichnaea.config.ts");
    await writeFile(
      config,
      `import { support } from ${JSON.stringify(at("plugin.ts"))};\nexport default { plugins: [support], allowStability: ["alpha"] };\n`,
    );
    const out: string[] = [];
    const code = await main(
      [
        "import",
        "--config",
        config,
        "--importer",
        "support/results",
        "--suite",
        at("data/suite.json"),
        "--case-set",
        at("data/case-set.json"),
        "--cases",
        at("data/cases.jsonl"),
        "--arm",
        `base:base:${at("configurations/base.json")}`,
        "--arm",
        `candidate:candidate:${at("configurations/candidate.json")}`,
        "--file",
        at("results/base.json"),
        "--file",
        at("results/candidate-same.json"),
        "--run",
        "run-1",
        "--store",
        join(dir, "store"),
        "--now",
        "2026-11-15T10:00:00Z",
        "--trigger",
        "new-model",
        "--vary",
        "prompt.answer",
      ],
      (t) => void out.push(t),
    );
    expect(code, out.join("\n")).toBe(0);
    expect(out).toContain(
      "  power: not computed: no plugin in the configuration states one (decidePlugin() does)",
    );
  });

  it("the doctor passes: every measure's tester passes", async () => {
    const out: string[] = [];
    expect(
      await main(["doctor", "--config", at("ichnaea.config.ts")], (t) => void out.push(t)),
    ).toBe(0);
    expect(out.join("\n")).toMatch(/support\/facts-stated: tester passed/);
  });
});
