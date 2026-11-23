import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeCalibration } from "../../src/calibration/analyze.ts";
import { projectForEgress } from "../../src/contracts/egress.ts";
import { MeasureValue } from "../../src/contracts/records/measure.ts";
import {
  ImportedHumanValue,
  RatingJudge,
  RatingsImport,
} from "../../src/contracts/records/ratings.ts";
import {
  FileStore,
  importLabelStudio,
  main,
  type ImportRatingsInput,
} from "../../src/core/index.ts";
import { scenario } from "../decide/support/scenario.ts";

async function fixture(modify?: {
  id?: string;
  rating?: number;
  noJudge?: boolean;
  wrongCase?: boolean;
  wrongJudge?: boolean;
}): Promise<ImportRatingsInput> {
  const root = await mkdtemp(join(tmpdir(), "ichnaea-ratings-"));
  const store = new FileStore(root);
  const ratings = [0, 1, 2, 3];
  const judge = RatingJudge.parse({
    id: "eval/rubric",
    digest: `sha256:${"d".repeat(64)}`,
    measure: "eval/judged",
    version: "1.0.0",
  });
  const records = await scenario({
    cases: 4,
    replicates: 1,
    base: () => 1,
    candidate: () => 1,
    secondary: [judge.measure],
  });
  const index = new Map(records.trials.map((trial, i) => [trial.id, i]));
  await store.createRun({
    ...records,
    run: {
      ...records.run,
      lineage: [
        ...records.run.lineage,
        { kind: "judge", id: judge.id, version: judge.version, digest: judge.digest },
      ],
    },
    values: records.values.flatMap((value) => {
      if (value.measure !== judge.measure) return [value];
      if (modify?.noJudge && value.trial === records.trials[0]?.id) return [];
      const i = index.get(value.trial) ?? 0;
      return [
        MeasureValue.parse({
          ...value,
          source: "judge",
          value: { type: "level", level: String(ratings[i % ratings.length]) },
        }),
      ];
    }),
  });
  const key = Object.fromEntries(
    records.trials.map((trial, i) => [
      `opaque-${i}`,
      {
        trial: trial.id,
        ...(i === 0 && modify?.wrongCase ? { item: "forged-case" } : {}),
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
    dataClass: "pseudonymous",
    scale: ratings,
    judge: modify?.wrongJudge ? { ...judge, digest: `sha256:${"a".repeat(64)}` } : judge,
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
  };
  await Promise.all([
    writeFile(input.file, JSON.stringify(tasks)),
    writeFile(input.key, JSON.stringify(key)),
    writeFile(input.registration, JSON.stringify(registration)),
  ]);
  return input;
}

describe("Label Studio rating import", () => {
  it("imports each score, maps the scale and writes inputs the calibration analyzer accepts", async () => {
    const input = await fixture();
    const base = await new FileStore(input.store).read(input.run);
    const out: string[] = [];
    expect(
      await main(
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
        ],
        (line) => {
          out.push(line);
        },
      ),
      out.join("\n"),
    ).toBe(0);
    const store = new FileStore(input.store);
    const record = await store.readRatings(input.run, "rating-study");
    expect(record.values).toHaveLength(16);
    expect(record.values.slice(0, 2)).toMatchObject([
      { measure: "eval/rating-a", source: "human", value: { type: "level", level: "2" } },
      { measure: "eval/rating-b", source: "human", value: { type: "level", level: "1" } },
    ]);
    expect(record.calibration.units[0]).toMatchObject({ raters: [2, 1], judge: 1 });
    expect(record.scale).toEqual([0, 1, 2, 3]);
    expect(record.judge).toMatchObject({
      id: "eval/rubric",
      measure: "eval/judged",
      version: "1.0.0",
    });
    expect(analyzeCalibration(record.calibration, { seed: 7, resamples: 100 })).toMatchObject({
      units: 8,
      items: 4,
    });
    expect(await store.read(input.run)).toEqual(base);
    await expect(importLabelStudio(input)).rejects.toThrow("already has ratings from study");
  });

  it.each([
    [{ id: "opaque-unknown" }, "item 'opaque-unknown' is missing from the key file"],
    [{ rating: 4 }, "item 'opaque-0' has a rating outside the registered scale"],
    [{ noJudge: true }, "item 'opaque-0' needs a stored judge level"],
    [{ wrongCase: true }, "invalid record"],
    [{ wrongJudge: true }, "the judge does not match the stored run lineage"],
  ] as const)("refuses bad input before creating ratings", async (modify, error) => {
    const input = await fixture(modify);
    await expect(importLabelStudio(input)).rejects.toThrow(error);
    await expect(
      new FileStore(input.store).readRatings(input.run, "rating-study"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps study-classified ratings, calibration inputs and copied task content from egress", async () => {
    const input = await fixture();
    const record = await importLabelStudio(input);
    expect(record.values.every((value) => value.dataClass === "pseudonymous")).toBe(true);
    const stored = await readFile(
      join(input.store, "runs", input.run, "ratings", "rating-study.json"),
      "utf8",
    );
    expect(stored).not.toContain("synthetic evidence to omit");
    expect(stored).not.toContain("annotator@example.test");
    const context = { purpose: "PU-5", maxClass: "none" } as const;
    expect(projectForEgress(RatingsImport, record, context).dropped).toEqual([
      "/values",
      "/calibration",
    ]);
    expect(projectForEgress(ImportedHumanValue, record.values[0], context).dropped).toContain(
      "/value",
    );
  });
});
