// The job plan of a sharded statistics study (scripts/stats/study-plan.ts): which shards each job
// runs, the pilot, and the limits it refuses.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_PARALLEL,
  jobsOf,
  MAX_PARALLEL_CAP,
  maxParallelOf,
  MAX_MATRIX_JOBS,
  pilotOf,
  plan,
  prepare,
  PROCESSES,
  STUDIES,
} from "../../scripts/stats/study-plan.ts";

describe("the plan of a study", () => {
  it("gives job j the shards 4j to 4j + 3 of 4J, and the same for the second phase", () => {
    const p = plan({ study: "score-type-i", jobs: 40, secondJobs: 10, pilot: [] });
    expect(p.screen.include).toHaveLength(40);
    expect(p.screen.include[0]).toEqual({
      job: 0,
      shards: "0,1,2,3",
      count: 160,
      artifact: "score-type-i-screen-0",
    });
    expect(p.screen.include.at(-1)?.shards).toBe("156,157,158,159");
    expect(p.secondJobs.include).toHaveLength(10);
    expect(p.secondJobs.include[0]?.artifact).toBe("score-type-i-recheck-0");
    expect(p.secondCount).toBe(40);
    expect(p.pilot).toBe(false);
    const all = p.screen.include.flatMap((j) => j.shards.split(",").map(Number));
    expect(all).toEqual(Array.from({ length: 160 }, (_, i) => i));
  });

  it("names each study's scripts, second phase and points file", () => {
    const ni = plan({ study: "score-ni", jobs: 2, secondJobs: 2, pilot: [] });
    expect([ni.script, ni.collector, ni.second, ni.points]).toEqual([
      "scripts/stats/study-score-ni.ts",
      "scripts/stats/collect-score-ni.ts",
      "confirm",
      "confirm.json",
    ]);
    expect(JSON.parse(ni.prepare)).toEqual({
      commands: [
        ["scripts/stats/score-ni-seeds.ts", "validation/score-ni-seeds.json"],
        ["scripts/stats/collect-score-ni.ts", "structures"],
      ],
      artifacts: ["validation/score-ni-seeds.json"],
    });
    expect(ni.prepared).toBe(true);
    const ti = plan({ study: "score-type-i", jobs: 2, secondJobs: 2, pilot: [] });
    expect([ti.second, ti.points, ti.prepared]).toEqual(["recheck", "recheck.json", false]);
  });

  it("runs a pilot's shards one per job, at the full screen's count, with no second phase", () => {
    const p = plan({ study: "score-ni", jobs: 40, secondJobs: 40, pilot: [57, 0, 57] });
    expect(p.pilot).toBe(true);
    expect(p.screen.include).toEqual([
      { job: 0, shards: "0", count: 160, artifact: "score-ni-screen-0" },
      { job: 1, shards: "57", count: 160, artifact: "score-ni-screen-1" },
    ]);
    expect(p.secondJobs.include).toEqual([]);
  });

  it("refuses an unknown study, a pilot shard outside the screen, and too many jobs", () => {
    expect(() => plan({ study: "score", jobs: 1, secondJobs: 1, pilot: [] })).toThrow(
      /unknown study 'score'/,
    );
    expect(() => plan({ study: "score-ni", jobs: 40, secondJobs: 1, pilot: [160] })).toThrow(
      /not one of the 160 screen shards/,
    );
    expect(() => jobsOf(String(MAX_MATRIX_JOBS + 1), "jobs")).toThrow(/from 1 to 256/);
    expect(() => jobsOf("0", "jobs")).toThrow(/from 1 to 256/);
    expect(() => jobsOf("2.5", "jobs")).toThrow(/whole number/);
    expect(jobsOf("40", "jobs")).toBe(40);
    expect(() => pilotOf("0,x")).toThrow(/not a whole number/);
    expect(pilotOf(" ")).toEqual([]);
    expect(pilotOf("0, 57")).toEqual([0, 57]);
  });

  it("keeps every study to processes of 4 shards and paths inside the package", () => {
    expect(PROCESSES).toBe(4);
    for (const s of Object.values(STUDIES))
      for (const path of [s.script, s.collector, ...s.prepare.flat(), ...s.prepareArtifacts])
        expect(path.startsWith("/") || path.includes("..")).toBe(false);
  });

  it("prepares nothing for a study without prepare commands, and refuses an unknown one", () => {
    expect(prepare("score-type-i", "/nonexistent")).toEqual([]);
    expect(() => prepare("score", "/nonexistent")).toThrow(/unknown study/);
  });

  it("runs 12 jobs of a matrix at once by default and refuses more than 14", () => {
    expect([DEFAULT_MAX_PARALLEL, MAX_PARALLEL_CAP]).toEqual([12, 14]);
    expect(maxParallelOf(undefined)).toBe(12);
    expect(maxParallelOf("")).toBe(12);
    expect(maxParallelOf("14")).toBe(14);
    for (const bad of ["15", "20", "0", "2.5", "all"])
      expect(() => maxParallelOf(bad)).toThrow(
        /from 1 to 14, so that Ichnaea keeps within 20 runners of the shared pool/,
      );
    expect(plan({ study: "score-ni", jobs: 40, secondJobs: 40, pilot: [] }).maxParallel).toBe(12);
    expect(
      plan({ study: "score-ni", jobs: 40, secondJobs: 40, pilot: [], maxParallel: 8 }).maxParallel,
    ).toBe(8);
  });
});
