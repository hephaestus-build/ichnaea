// A study's shards must all run on one runtime (Node version, platform, CPU architecture): V8's Math
// is not bit-identical across platforms, so outputs compare byte for byte only within one. The
// collector (scripts/stats/collect-score-type-i.ts, `readPhase`) refuses shards from different
// runtimes and a sidecar that records none.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readPhase } from "../../scripts/stats/collect-score-type-i.ts";
import type { Runtime } from "../../scripts/stats/study-score-type-i.ts";

const COLUMNS = ["id", "value"] as const;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Two screen shards with the given runtimes (undefined: not recorded). */
function shards(runtimes: (Runtime | undefined)[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ichnaea-runtime-"));
  dirs.push(dir);
  runtimes.forEach((runtime, i) => {
    const file = join(dir, `screen-${i}-of-${runtimes.length}.tsv`);
    const text = `${COLUMNS.join("\t")}\np${i}\t0.05\n`;
    writeFileSync(file, text);
    writeFileSync(
      `${file}.meta.json`,
      JSON.stringify({
        commit: "c0ffee",
        files: {},
        complete: true,
        outputSha256: createHash("sha256").update(text).digest("hex"),
        phase: "screen",
        reps: 6000,
        confirmSe: 0.0005,
        shard: { index: i, count: runtimes.length },
        ...(runtime === undefined ? {} : { runtime }),
      }),
    );
  });
  return dir;
}

const linux: Runtime = { name: "node", version: "v24.22.2", platform: "linux", arch: "x64" };
const mac: Runtime = { name: "node", version: "v24.22.2", platform: "darwin", arch: "arm64" };

describe("the collector and the runtime", () => {
  it("accepts shards from one runtime and reports it", () => {
    const problems: string[] = [];
    const { runtime, rows } = readPhase(
      shards([linux, linux]),
      "screen",
      COLUMNS,
      6000,
      false,
      problems,
    );
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(runtime).toBe("node v24.22.2 linux x64");
  });

  it("refuses shards from different runtimes", () => {
    const problems: string[] = [];
    readPhase(shards([linux, mac]), "screen", COLUMNS, 6000, false, problems);
    // The refusal names both runtimes.
    expect(
      problems.some(
        (p) =>
          p.includes("different runtimes") &&
          p.includes("node v24.22.2 linux x64") &&
          p.includes("node v24.22.2 darwin arm64"),
      ),
    ).toBe(true);
  });

  it("refuses a sidecar that records no runtime", () => {
    const problems: string[] = [];
    readPhase(shards([linux, undefined]), "screen", COLUMNS, 6000, false, problems);
    expect(problems.some((p) => p.includes("records no runtime"))).toBe(true);
  });
});
