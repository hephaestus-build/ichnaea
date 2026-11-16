import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  clusterBootstrap,
  type ClusterObservation,
  type ClusterSchedule,
  createRng,
} from "../../src/stats/index.ts";

const observations: ClusterObservation[] = [
  { cluster: "a", value: 0 },
  { cluster: "a", value: 0 },
  { cluster: "a", value: 0 },
  { cluster: "b", value: 1 },
];
const schedule: ClusterSchedule = {
  clusterIds: ["a", "b"],
  draws: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  algorithm: "enumerated",
  seed: 0,
};

describe("descriptive cluster percentile bootstrap", () => {
  it("states that coverage is unestablished even with at least 40 clusters", () => {
    const result = clusterBootstrap(
      Array.from({ length: 40 }, (_, i) => ({ cluster: `case-${i}`, value: i % 2 })),
      { rng: createRng(42), resamples: 2000 },
    );
    expect(result.validated).toBe(false);
    expect(result.limitations).toContain(
      "nominal coverage is not established at any cluster count",
    );
    expect(result.limitations.join(" ")).not.toContain("fewer than 40");
  });
  it("resamples whole unequal clusters and retains row weights", () => {
    const result = clusterBootstrap(observations, { schedule, level: 0.5 });
    // The four means are 0, 1/4, 1/4, 1. Type-7 quartiles are 3/16 and 7/16.
    expect(result.estimate).toBe(0.25);
    expect(result.lower).toBe(3 / 16);
    expect(result.upper).toBe(7 / 16);
    expect(result).toMatchObject({
      estimateOnly: true,
      validated: false,
      clusters: 2,
      observations: 4,
      sampling: { mode: "replay" },
    });
  });

  it("retains missing clusters, omits empty resamples, and never calls null zero", () => {
    const result = clusterBootstrap(
      [
        { cluster: "a", value: null },
        { cluster: "b", value: 1 },
      ],
      { schedule },
    );
    expect(result).toMatchObject({
      estimate: 1,
      lower: 1,
      upper: 1,
      missing: 1,
      available: 1,
      omittedResamples: 1,
      intervalStatus: "degenerate",
    });
    expect(result.limitations.join(" ")).toContain("no coverage claim");
  });

  it("native draws equal a replay of the same seeded stream", () => {
    const rng = createRng(42);
    const draws = Array.from({ length: 2000 }, () =>
      Array.from({ length: 2 }, () => Math.floor(rng.uniform() * 2)),
    );
    const native = clusterBootstrap(observations, { rng: createRng(42), resamples: 2000 });
    const replay = clusterBootstrap(observations, {
      schedule: { ...schedule, algorithm: "mt19937", seed: 42, draws },
    });
    expect(native.lower).toBe(replay.lower);
    expect(native.upper).toBe(replay.upper);
    expect(native.sampling).toEqual({ mode: "native", algorithm: "mt19937", seed: 42 });
    expect(
      clusterBootstrap(observations.toReversed(), { rng: createRng(42), resamples: 2000 }),
    ).toEqual(native);
  });

  it("replays a schedule in its own cluster order, such as R's locale collation", () => {
    const input: ClusterObservation[] = [
      { cluster: "A", value: 1 },
      { cluster: "b", value: 0 },
      { cluster: "c", value: 0 },
      { cluster: "c", value: 0 },
    ];
    // Index 1 is "A" in the schedule's order ["b", "A", "c"]; in code-unit order it would be "b".
    const result = clusterBootstrap(input, {
      schedule: {
        clusterIds: ["b", "A", "c"],
        draws: [[1, 1, 1]],
        algorithm: "R-Mersenne-Twister/Inversion/Rejection",
        seed: 7,
      },
    });
    expect([result.lower, result.upper]).toEqual([1, 1]);
  });

  it("accepts any safe integer seed, as R's set.seed does, and refuses others", () => {
    const result = clusterBootstrap(observations, { schedule: { ...schedule, seed: -1 } });
    expect(result.sampling.seed).toBe(-1);
    for (const seed of [0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => clusterBootstrap(observations, { schedule: { ...schedule, seed } })).toThrow(
        /seed/,
      );
  });

  it("refuses mismatched cluster identities, malformed draws, and invalid numeric input", () => {
    for (const clusterIds of [["a"], ["a", "a"], ["a", "b", "c"], ["a", "c"]])
      expect(() =>
        clusterBootstrap(observations, { schedule: { ...schedule, clusterIds } }),
      ).toThrow(/cluster/);
    for (const draws of [[[0]], [[0, 2]], [[-1, 0]], [[0, 0.5]], []]) {
      expect(() => clusterBootstrap(observations, { schedule: { ...schedule, draws } })).toThrow();
    }
    for (const level of [0, 1, NaN, Infinity])
      expect(() => clusterBootstrap(observations, { schedule, level })).toThrow();
    for (const resamples of [0, -1, 0.5, Infinity])
      expect(() => clusterBootstrap(observations, { rng: createRng(1), resamples })).toThrow();
    for (const value of [NaN, Infinity, -Infinity])
      expect(() =>
        clusterBootstrap([{ cluster: "a", value }], { rng: createRng(1), resamples: 2 }),
      ).toThrow(/finite/);
    expect(() => clusterBootstrap([], { schedule })).toThrow(/observation/);
    expect(() =>
      clusterBootstrap([{ cluster: "a", value: null }], { rng: createRng(1), resamples: 2 }),
    ).toThrow(/no observed/);
    expect(() =>
      clusterBootstrap([{ cluster: " ", value: 1 }], { rng: createRng(1), resamples: 2 }),
    ).toThrow(/identifiers/);
    expect(() =>
      clusterBootstrap(
        [
          { cluster: "a", value: null },
          { cluster: "b", value: 1 },
        ],
        { schedule: { ...schedule, draws: [[0, 0]] } },
      ),
    ).toThrow(/every resample/);
  });

  it("matches base R mean and type-7 quantiles on its actual recorded cluster draws (absolute tolerance 1e-12)", () => {
    const lines = readFileSync(
      new URL("./reference-cluster-bootstrap.tsv", import.meta.url),
      "utf8",
    )
      .trim()
      .split("\n");
    for (const line of lines.slice(1)) {
      const [name, ids, values, seed, resamples, level, estimate, lower, upper, omitted, draws] =
        line.split("\t");
      const clusterIds = ids!.split(",");
      const input = values!.split(";").flatMap((group, index) =>
        group.split(",").map((value) => ({
          cluster: clusterIds[index]!,
          value: value === "NA" ? null : Number(value),
        })),
      );
      const result = clusterBootstrap(input, {
        level: Number(level),
        schedule: {
          clusterIds,
          seed: Number(seed),
          algorithm: "R-Mersenne-Twister/Inversion/Rejection",
          draws: draws!.split(";").map((draw) => draw.split(",").map(Number)),
        },
      });
      expect(result.resamples, name).toBe(Number(resamples));
      expect(result.omittedResamples, name).toBe(Number(omitted));
      for (const [actual, expected] of [
        [result.estimate, Number(estimate)],
        [result.lower, Number(lower)],
        [result.upper, Number(upper)],
      ])
        expect(Math.abs(actual! - expected!), name).toBeLessThanOrEqual(1e-12);
    }
  });
});
