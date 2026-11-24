import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { expect, it } from "vitest";

import { analyzeCalibration } from "../../src/calibration/analyze.ts";
import { projectForEgress } from "../../src/contracts/egress.ts";
import { RatingsImport } from "../../src/contracts/records/ratings.ts";
import { calibrationInput } from "../../src/core/ratings-calibration.ts";
import { digest } from "../../src/contracts/canonical.ts";
import { Judge } from "../../src/contracts/records/judge.ts";
import { MeasureValue } from "../../src/contracts/records/measure.ts";
import { FileStore, main } from "../../src/index.ts";
import { card, scenario } from "../decide/support/scenario.ts";

async function fixture(modify?: {
  id?: string;
  rating?: number;
  noJudge?: boolean;
  unexpectedKeyField?: boolean;
  wrongJudge?: boolean;
  judgeOutputKind?: "binary" | "level";
  wrongMeasure?: boolean;
  duplicateScale?: boolean;
  publicRatings?: boolean;
  noLineage?: boolean;
  mismatchedConfiguration?: boolean;
}) {
  const root = await mkdtemp(join(tmpdir(), "ichnaea-ratings-"));
  const ratings = [0, 1, 2, 3];
  const instrument = Judge.parse({
    schema: "ichnaea.judge/1",
    id: "app/rubric",
    version: "1.0.0",
    evaluatorKind: "model",
    model: { provider: "example", id: "rubric-model", version: "1" },
    endpointClass: "offline-test",
    promptDigest: digest("prompt"),
    rubricDigest: digest("rubric"),
    outputSchema: { type: "integer", enum: ratings },
    outputKind: modify?.judgeOutputKind ?? "level",
    parameters: { temperature: 0 },
    swapOrder: false,
    repeats: 1,
  });
  const judge = {
    id: instrument.id,
    digest: digest(instrument),
    measure: "app/judged",
    version: "1.0.0",
  };
  const records = await scenario({
    cases: 4,
    replicates: 1,
    base: () => 1,
    candidate: () => 1,
    secondary: [judge.measure],
  });
  const index = new Map(records.trials.map((trial, i) => [trial.id, i]));
  const values = records.values.flatMap((value) => {
    if (value.measure !== judge.measure) return [value];
    if (modify?.noLineage || (modify?.noJudge && value.trial === records.trials[0]?.id)) return [];
    const i = index.get(value.trial) ?? 0;
    return [
      MeasureValue.parse({
        ...value,
        source: "judge",
        value: { type: "level", level: String(ratings[i % ratings.length]) },
      }),
    ];
  });
  const suitePath = join(root, "suite.json");
  const caseSetPath = join(root, "case-set.json");
  const casesPath = join(root, "cases.jsonl");
  await Promise.all([
    writeFile(join(root, "ichnaea.config.ts"), ""),
    writeFile(suitePath, JSON.stringify(records.suite)),
    writeFile(caseSetPath, JSON.stringify(records.caseSet)),
    writeFile(casesPath, records.cases.map((record) => JSON.stringify(record)).join("\n")),
    ...records.plan.arms.map((arm) =>
      writeFile(join(root, `${arm.name}.json`), JSON.stringify(arm.configuration)),
    ),
  ]);
  const errors: string[] = [];
  const imported = await main(
    [
      "import",
      "--config",
      join(root, "ichnaea.config.ts"),
      "--importer",
      "app/runner",
      "--run",
      records.run.id,
      "--store",
      root,
      "--suite",
      suitePath,
      "--case-set",
      caseSetPath,
      "--cases",
      casesPath,
      "--seed",
      "7",
      ...records.plan.arms.flatMap((arm) => [
        "--arm",
        `${arm.name}:${arm.role}:${join(root, `${arm.name}.json`)}`,
      ]),
    ],
    () => undefined,
    async () => ({
      default: {
        plugins: [
          {
            id: "app",
            version: "1.0.0",
            measures: [
              card("app/correct"),
              {
                card: {
                  ...card(judge.measure, "level").card,
                  computedBy: "judge",
                  judge: judge.id,
                  tier: "secondary",
                },
              },
            ],
            importers: [
              {
                id: "app/runner",
                version: "1.0.0",
                description: "Import a synthetic run",
                run: async () => ({
                  trials: modify?.mismatchedConfiguration
                    ? records.trials.map((trial) => ({
                        ...trial,
                        observed: [
                          { name: "model", value: "other-model", expected: "planned-model" },
                        ],
                      }))
                    : records.trials,
                  values,
                  judges: modify?.noLineage ? [] : [instrument],
                }),
              },
            ],
          },
        ],
      },
    }),
    (line) => errors.push(line),
  );
  const key = Object.fromEntries(
    records.trials.map((trial, i) => [
      `opaque-${i}`,
      {
        trial: trial.id,
        ...(i === 0 && modify?.unexpectedKeyField ? { item: "forged-case" } : {}),
        stratum: "held-out",
        configuration: trial.arm,
      },
    ]),
  );
  const tasks = records.trials.map((_, i) => ({
    data: { item_id: (i === 0 && modify?.id) || `opaque-${i}`, text: "synthetic evidence to omit" },
    annotations: [
      {
        completed_by: { id: 20, email: "annotator@example.test" },
        result: [
          { from_name: "rating", type: "number", value: { number: ratings[i % ratings.length] } },
        ],
      },
      {
        completed_by: 10,
        result: [
          {
            from_name: "rating",
            type: "number",
            value: {
              number:
                i === 0 && modify?.rating !== undefined
                  ? modify.rating
                  : ratings[(i + 1) % ratings.length],
            },
          },
        ],
      },
    ],
  }));
  const registration = {
    study: "rating-study",
    control: "rating",
    dataClass: modify?.publicRatings ? "none" : "pseudonymous",
    scale: modify?.duplicateScale ? [0, 1, 1, 2] : ratings,
    judge: modify?.wrongMeasure
      ? { ...judge, measure: "app/correct" }
      : modify?.wrongJudge
        ? { ...judge, digest: `sha256:${"a".repeat(64)}` }
        : judge,
    raters: [
      { user: 10, measure: "eval/rating-a", version: "1.0.0" },
      { user: 20, measure: "eval/rating-b", version: "1.0.0" },
    ],
  };
  const input = {
    run: records.run.id,
    store: root,
    file: join(root, "export.json"),
    key: join(root, "key.json"),
    registration: join(root, "study.json"),
    runImport: { exit: imported, errors },
  };
  await Promise.all([
    writeFile(input.file, JSON.stringify(tasks)),
    writeFile(input.key, JSON.stringify(key)),
    writeFile(input.registration, JSON.stringify(registration)),
  ]);
  return input;
}

async function importRatings(input: Awaited<ReturnType<typeof fixture>>, ...flags: string[]) {
  expect(input.runImport.exit, input.runImport.errors.join("\n")).toBe(0);
  const output: string[] = [];
  const errors: string[] = [];
  const exit = await main(
    [
      "import-ratings",
      "--run",
      input.run,
      "--store",
      input.store,
      "--file",
      input.file,
      "--key",
      input.key,
      "--registration",
      input.registration,
      ...flags,
    ],
    (line) => output.push(line),
    undefined,
    (line) => errors.push(line),
  );
  return { exit, output, errors };
}

it("refuses an ordinal measure when its judge returns binary output", async () => {
  const input = await fixture({ judgeOutputKind: "binary" });
  try {
    expect(input.runImport.exit).toBe(2);
    expect(input.runImport.errors.join("\n")).toContain("needs a judge that returns levels");
    expect(await new FileStore(input.store).runs()).toEqual([]);
  } finally {
    await rm(input.store, { recursive: true, force: true });
  }
});

it("records judge bindings only for retained evidence", async () => {
  const input = await fixture({ mismatchedConfiguration: true });
  try {
    expect(input.runImport.exit, input.runImport.errors.join("\n")).toBe(0);
    const stored = await new FileStore(input.store).read(input.run);
    expect(stored.trials.map((trial) => trial.outcome)).toEqual(
      Array.from({ length: 8 }, () => "invalid_configuration"),
    );
    expect(stored.values).toEqual([]);
    expect(stored.run.lineage.filter((entry) => entry.kind === "judge")).toEqual([]);
  } finally {
    await rm(input.store, { recursive: true, force: true });
  }
});

it("refuses ratings on a run without matching recorded judge lineage", async () => {
  const input = await fixture({ noLineage: true });
  try {
    const result = await importRatings(input);
    expect(result.exit).toBe(2);
    expect(result.errors.join("\n")).toContain("recorded judge lineage");
    await expect(
      readFile(join(input.store, "runs", input.run, "ratings", "rating-study.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(input.store, { recursive: true, force: true });
  }
});

it.each([
  [{ wrongJudge: true }, "recorded judge lineage"],
  [{ wrongMeasure: true }, "recorded judge lineage"],
  [{ duplicateScale: true }, "registered scale repeats a rating"],
  [{ publicRatings: true }, "protected data class"],
  [{ id: "unregistered" }, "missing from the key file"],
  [{ rating: 4 }, "outside the registered scale"],
  [{ noJudge: true }, "needs a stored judge level"],
  [{ unexpectedKeyField: true }, "invalid record"],
] as const)("refuses invalid ratings input %j", async (settings, message) => {
  const input = await fixture(settings);
  try {
    const result = await importRatings(input);
    expect(result.exit).toBe(2);
    expect(result.errors.join("\n")).toContain(message);
    await expect(new FileStore(input.store).readRatings(input.run, "rating-study")).rejects.toThrow(
      "the run has no ratings for this study",
    );
  } finally {
    await rm(input.store, { recursive: true, force: true });
  }
});

it("imports one canonical value per rater and lets the report use the protected study", async () => {
  const input = await fixture();
  try {
    const store = new FileStore(input.store);
    expect(input.runImport.exit, input.runImport.errors.join("\n")).toBe(0);
    const prior = await store.read(input.run);
    const result = await importRatings(input, "--json");
    expect(result.exit, result.errors.join("\n")).toBe(0);
    expect(result.output).toEqual([JSON.stringify({ ratings: 16, units: 8 })]);
    expect(await store.read(input.run)).toEqual(prior);
    const record = await store.readRatings(input.run, "rating-study");
    expect(record.values).toHaveLength(16);
    expect(record.values[0]?.value.level).toBe("1");
    expect(record.units[0]?.judge).toBe("0");
    expect(record.units[0]).not.toHaveProperty("raters");
    const calibration = calibrationInput(record);
    expect(calibration.units[0]).toMatchObject({ raters: [2, 1], judge: 1 });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: record.scale.length }), (level) => {
        const updated = {
          ...record,
          values: record.values.map((value, index) =>
            index === 0
              ? { ...value, value: { ...value.value, level: String(record.scale[level - 1]) } }
              : value,
          ),
        };
        expect(calibrationInput(updated).units[0]?.raters[0]).toBe(level);
      }),
    );
    const mismatched = { ...record, values: record.values.slice(1) };
    expect(() => calibrationInput(mismatched)).toThrow("exactly two canonical rater values");
    expect(analyzeCalibration(calibration, { seed: 7, resamples: 100 })).toMatchObject({
      units: 8,
      items: 4,
    });
    const directory = join(input.store, "runs", input.run, "ratings");
    const sidecarPath = join(directory, "rating-study.json");
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(sidecarPath)).mode & 0o777).toBe(0o600);
    }
    const stored = await readFile(sidecarPath, "utf8");
    expect(stored).not.toContain("synthetic evidence to omit");
    expect(stored).not.toContain("annotator@example.test");
    expect(
      projectForEgress(RatingsImport, record, { purpose: "PU-5", maxClass: "none" }).dropped,
    ).toEqual(expect.arrayContaining(["/values", "/units", "/raters"]));

    const again = await importRatings(input);
    expect(again.exit).toBe(2);
    expect(again.errors.join("\n")).toContain("already has ratings for this study");
    const args = ["--run", input.run, "--store", input.store];
    const errors: string[] = [];
    const err = (line: string) => errors.push(line);
    expect(
      await main(["decide", ...args], () => undefined, undefined, err),
      errors.join("\n"),
    ).toBe(0);
    const output: string[] = [];
    expect(
      await main(
        ["report", ...args, "--json", "--ratings-study", "rating-study"],
        (line) => output.push(line),
        undefined,
        err,
      ),
      errors.join("\n"),
    ).toBe(0);
    const report: unknown = JSON.parse(output[0] ?? "null");
    expect(report).toMatchObject({
      agreement: {
        estimate: expect.any(Number),
        counts: { units: 8, raters: 2, pairedRatings: 16 },
        source: { sidecar: digest(record), registration: record.registration },
      },
    });
    expect(output[0]).not.toContain("app/rater");
    expect(output[0]).not.toContain("eval/rating-a");
    expect(output[0]).not.toContain("held-out");
    expect(
      await main(
        ["report", ...args, "--ratings-study", "rating-study"],
        () => undefined,
        undefined,
        err,
      ),
      errors.join("\n"),
    ).toBe(0);
    const summary = await readFile(
      join(input.store, "runs", input.run, "report", "summary.md"),
      "utf8",
    );
    expect(summary).toContain("Inter-rater agreement");
    expect(summary).toContain(digest(record));
    expect(summary).not.toContain("held-out");

    await writeFile(
      sidecarPath,
      JSON.stringify({
        ...record,
        judge: { ...record.judge, measure: "app/correct" },
      }),
    );
    await expect(store.readRatings(input.run, "rating-study")).rejects.toThrow(
      "recorded judge lineage",
    );
  } finally {
    await rm(input.store, { recursive: true, force: true });
  }
});
