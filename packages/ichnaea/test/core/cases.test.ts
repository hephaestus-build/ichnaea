import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { CasesError, loadCases } from "../../src/core/index.ts";
import { caseOf } from "./support/library.ts";

const dir = mkdtempSync(join(tmpdir(), "ichnaea-cases-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, text: string): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};
const line = (value: unknown): string => JSON.stringify(value);

describe("loadCases", () => {
  it("reads JSON Lines from a file URL, skipping blank lines", () => {
    const path = file(
      "ok.jsonl",
      `${line(caseOf("a", "raise"))}\n\n${line(caseOf("b", "decline"))}\n`,
    );
    const cases = loadCases(pathToFileURL(path));
    expect(cases.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("reads a JSON array from a path", () => {
    const path = file("ok.json", JSON.stringify([caseOf("a", "raise")]));
    expect(loadCases(path).map((c) => c.id)).toEqual(["a"]);
  });

  it("names the line of a case that is not JSON", () => {
    const path = file("bad.jsonl", `${line(caseOf("a", "raise"))}\n{not json\n`);
    expect(() => loadCases(path)).toThrow(new RegExp(`${path}:2: not JSON`));
  });

  it("names the line and the field of an invalid case", () => {
    const broken = { ...caseOf("b", "raise"), pool: "nowhere" };
    const path = file("invalid.jsonl", `${line(caseOf("a", "raise"))}\n${line(broken)}\n`);
    expect(() => loadCases(path)).toThrow(CasesError);
    expect(() => loadCases(path)).toThrow(new RegExp(`${path}:2: invalid case[^]*pool`));
  });

  it("names both lines of a repeated case ID", () => {
    const path = file(
      "twice.jsonl",
      `${line(caseOf("a", "raise"))}\n${line(caseOf("a", "raise"))}\n`,
    );
    expect(() => loadCases(path)).toThrow(`${path}:2: case 'a' repeats the ID of line 1`);
  });

  it("names the element of an invalid case in a JSON array", () => {
    const path = file("invalid.json", JSON.stringify([caseOf("a", "raise"), { id: "b" }]));
    expect(() => loadCases(path)).toThrow(new RegExp(`${path}\\[1\\]: invalid case`));
  });

  it("refuses a file that holds no case, and an unknown extension", () => {
    expect(() => loadCases(file("empty.jsonl", "\n"))).toThrow(/holds no case/);
    expect(() => loadCases(file("cases.csv", "a,b"))).toThrow(/\.jsonl or \.json/);
  });
});
