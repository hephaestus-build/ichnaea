// The trial outcome is a closed enumeration: a reader of this version refuses an outcome it does
// not know, instead of reading it as missing and deciding the run.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contractFor, readRecord } from "../../src/contracts/index.ts";

const fixtures = join(import.meta.dirname, "..", "..", "fixtures", "valid");
const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(fixtures, `${name}.json`), "utf8")) as Record<string, unknown>;

describe("the trial outcome", () => {
  it("is closed: the reader schema refuses an unknown outcome on a trial", () => {
    const trial = { ...read("trial"), outcome: "partial" };
    expect(readRecord(contractFor("ichnaea.trial/1")!, trial).ok).toBe(false);
    expect(readRecord(contractFor("ichnaea.trial/1")!, { ...trial, outcome: "completed" }).ok).toBe(
      true,
    );
  });

  it("is closed in a run's ledger too", () => {
    const run = read("run") as { ledger: Array<Record<string, unknown>> };
    const later = { ...run, ledger: run.ledger.map((e) => ({ ...e, outcome: "partial" })) };
    expect(readRecord(contractFor("ichnaea.run/1")!, later).ok).toBe(false);
    expect(readRecord(contractFor("ichnaea.run/1")!, run).ok).toBe(true);
  });
});
