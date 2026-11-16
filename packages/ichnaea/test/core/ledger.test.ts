// REQ-86: the monthly call ledger. Every line must be a booking, so one corrupt line can never
// lower the month's total and let a run past the cap.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CallLedger, LedgerError, MonthlyCapError } from "../src/index.ts";

const AT = "2026-11-15T00:00:00Z";

/** A ledger whose November file holds these lines. */
async function ledgerWith(lines: readonly string[]): Promise<{ ledger: CallLedger; file: string }> {
  const root = await mkdtemp(join(tmpdir(), "ichnaea-ledger-"));
  const file = join(root, "ledger", "endpoint", "2026-11.jsonl");
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, lines.map((l) => `${l}\n`).join(""));
  return { ledger: new CallLedger(root), file };
}

const good = JSON.stringify({ run: "a", calls: 10, at: AT });

describe("call ledger lines (REQ-86)", () => {
  const corrupt: ReadonlyArray<readonly [string, string, RegExp]> = [
    ["a negative calls", JSON.stringify({ run: "x", calls: -1000, at: AT }), /calls/],
    ["a string calls", JSON.stringify({ run: "x", calls: "1000", at: AT }), /calls/],
    ["a non-integer calls", JSON.stringify({ run: "x", calls: 2.5, at: AT }), /calls/],
    ["a missing run", JSON.stringify({ calls: 5, at: AT }), /run/],
    ["a line that is not JSON", '{"run": "x", "calls": 5', /not JSON/],
  ];
  for (const [what, line, problem] of corrupt)
    it(`${what} stops the booking and names the file and the line`, async () => {
      const { ledger, file } = await ledgerWith([good, "", line]);
      const where = `call ledger ${file}, line 3: `;
      await expect(ledger.used("endpoint", AT)).rejects.toThrow(LedgerError);
      await expect(ledger.used("endpoint", AT)).rejects.toThrow(where);
      await expect(ledger.used("endpoint", AT)).rejects.toThrow(problem);
      // A refused ledger never counts as 0: the booking stops, and nothing is written.
      const before = await readFile(file, "utf8");
      await expect(ledger.reserve("endpoint", 100, { run: "b", calls: 1, at: AT })).rejects.toThrow(
        where,
      );
      expect(await readFile(file, "utf8")).toBe(before);
    });

  it("reads and counts a booking line with extra fields (REQ-05)", async () => {
    const { ledger } = await ledgerWith([
      JSON.stringify({
        run: "nightly-1",
        calls: 40,
        at: AT,
        commit: "abc123",
        event: "schedule",
        kind: "floor",
      }),
    ]);
    expect(await ledger.used("endpoint", AT)).toBe(40);
    await expect(ledger.reserve("endpoint", 100, { run: "b", calls: 60, at: AT })).resolves.toEqual(
      { used: 100, remaining: 0 },
    );
  });

  it("the cap still refuses a booking that would pass it", async () => {
    const { ledger } = await ledgerWith([good]);
    await expect(ledger.reserve("endpoint", 15, { run: "b", calls: 6, at: AT })).rejects.toThrow(
      MonthlyCapError,
    );
    expect(await ledger.used("endpoint", AT)).toBe(10);
  });

  it("refuses to write a booking that is not one", async () => {
    const { ledger, file } = await ledgerWith([good]);
    await expect(ledger.reserve("endpoint", 100, { run: "b", calls: -5, at: AT })).rejects.toThrow(
      LedgerError,
    );
    expect(await readFile(file, "utf8")).toBe(`${good}\n`);
  });
});
