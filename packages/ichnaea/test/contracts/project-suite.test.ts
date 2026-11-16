// The project config, the suite, the arm configuration and the lock (ichnaea.config/1, suite/2,
// configuration/2, suite.lock/1). They are plain JSON data: a measure names a module, never a
// function, and a value that JSON cannot hold is refused.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigurationV2,
  contractFor,
  ProjectConfig,
  RECORD_CONTRACTS,
  SuiteLock,
  SuiteV2,
} from "../../src/contracts/index.ts";
import { ajvValidate, createAjv } from "./support/ajv.ts";

type Rec = Record<string, unknown>;
const fixture = (name: string): Rec =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "fixtures", "valid", `${name}.json`),
      "utf8",
    ),
  ) as Rec;
const ajv = createAjv();
const suite = (): Rec => structuredClone(fixture("suite.2"));
const project = (): Rec => structuredClone(fixture("project"));
const measures = (s: Rec): Record<string, Rec> => s["measures"] as Record<string, Rec>;

/** zod and ajv must give the same answer, so every claim is checked in both. */
function accepts(name: string, value: unknown): boolean {
  const contract = RECORD_CONTRACTS.find((c) => c.name === name)!;
  const zod = contract.schema.safeParse(value).success;
  expect(ajvValidate(ajv, name, value)).toBe(zod);
  return zod;
}

describe("the record inventory", () => {
  it("registers the four records at their majors, each alpha", () => {
    for (const [id, schema] of [
      ["ichnaea.config/1", ProjectConfig],
      ["ichnaea.suite/2", SuiteV2],
      ["ichnaea.configuration/2", ConfigurationV2],
      ["ichnaea.suite.lock/1", SuiteLock],
    ] as const) {
      expect(contractFor(id)?.schema).toBe(schema);
      expect(contractFor(id)?.stability).toBe("alpha");
    }
  });

  it("keeps suite/1 and configuration/1 for the code that reads them today", () => {
    expect(contractFor("ichnaea.suite/1")?.name).toBe("suite");
    expect(contractFor("ichnaea.configuration/1")?.name).toBe("configuration");
  });

  it("names the files that editors read: project.schema.json and suite.2.schema.json", () => {
    expect(contractFor("ichnaea.config/1")?.name).toBe("project");
    expect(contractFor("ichnaea.suite/2")?.name).toBe("suite.2");
  });
});

describe("the authored files", () => {
  it("accept the $schema pointer that a JSONC file carries for its editor", () => {
    expect(accepts("suite.2", { ...suite(), $schema: "../../schemas/suite.2.schema.json" })).toBe(
      true,
    );
    expect(accepts("project", { ...project(), $schema: "./schemas/project.schema.json" })).toBe(
      true,
    );
  });

  it("machine-written records take no $schema pointer", () => {
    expect(accepts("suite.lock", { ...fixture("suite.lock"), $schema: "x.json" })).toBe(false);
    expect(accepts("configuration.2", { ...fixture("configuration.2"), $schema: "x.json" })).toBe(
      false,
    );
  });

  it("name a TypeScript measure by its module and export", () => {
    const scorer = measures(suite())["cites-page"]!["scorer"];
    expect(scorer).toEqual({
      instrument: "ts-scorers",
      module: "scorers/cites.ts",
      export: "citesPage",
    });
  });

  it.each([
    ["an absolute path", "/abs/scorers/cites.ts"],
    ["a path out of the instrument", "../scorers/cites.ts"],
    ["a parent segment inside the path", "scorers/../../cites.ts"],
    ["a module that is not JavaScript or TypeScript", "scorers/cites.py"],
  ])("refuse a module reference with %s", (_, module) => {
    const s = suite();
    (measures(s)["cites-page"]!["scorer"] as Rec)["module"] = module;
    expect(accepts("suite.2", s)).toBe(false);
  });

  it("refuse a function value, so a suite stays data that JSON can hold", () => {
    const s = suite();
    measures(s)["cites-page"]!["scorer"] = (output: string) => output.includes("http");
    expect(SuiteV2.safeParse(s).success).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a Date", new Date("2026-11-16T00:00:00Z")],
    ["a Map", new Map([["limit", 0.05]])],
  ])("refuse %s where a limit belongs", (_, value) => {
    const s = suite();
    ((s["policy"] as Rec)["primary"] as Record<string, Rec>)["grounded"]!["limit"] = value;
    expect(SuiteV2.safeParse(s).success).toBe(false);
  });

  it("take one case source: a list of dataset files or one source, never both", () => {
    const s = suite();
    (s["cases"] as Rec)["source"] = { file: "cases.jsonl" };
    expect(accepts("suite.2", s)).toBe(false);
    delete (s["cases"] as Rec)["from"];
    expect(accepts("suite.2", s)).toBe(true);
  });

  it.each([
    ["a query", "https://example.com/cases.jsonl?token=abc"],
    ["a fragment", "https://example.com/cases.jsonl#part"],
    ["user information", "https://user:pass@example.com/cases.jsonl"],
    ["plain http", "http://example.com/cases.jsonl"],
  ])("refuse an https source with %s", (_, url) => {
    const s = suite();
    delete (s["cases"] as Rec)["from"];
    (s["cases"] as Rec)["source"] = { https: { url }, digest: `sha256:${"a".repeat(64)}` };
    expect(accepts("suite.2", s)).toBe(false);
  });

  it("pin a git source to a full commit, never a branch or a short hash", () => {
    const p = project();
    const datasets = p["datasets"] as Record<string, { git: Rec }>;
    datasets["answers-public"]!.git["commit"] = "main";
    expect(accepts("project", p)).toBe(false);
    datasets["answers-public"]!.git["commit"] = "9e2c1f0";
    expect(accepts("project", p)).toBe(false);
  });

  it.each(["P7D", "PT10M", "PT120S", "P3Y", "P1DT12H"])("read %s as a duration", (value) => {
    const p = project();
    (p["baselines"] as Rec)["freshness"] = value;
    expect(accepts("project", p)).toBe(true);
  });

  it.each(["7d", "P", "PT", "P1DT", "10 minutes"])("refuse %s as a duration", (value) => {
    const p = project();
    (p["baselines"] as Rec)["freshness"] = value;
    expect(accepts("project", p)).toBe(false);
  });

  it("keep a secret out of the file: an environment entry names the variable, never its value", () => {
    const p = project();
    const worker = (p["workers"] as Record<string, Rec>)["chatbot"]!;
    worker["env"] = [{ name: "LLM_API_KEY", value: "sk-live-0123456789" }];
    expect(accepts("project", p)).toBe(false);
  });
});

describe("the arm configuration and the lock", () => {
  it("an arm configuration keeps the file's digest and only the allow-listed fields", () => {
    expect(Object.keys(fixture("configuration.2")).toSorted()).toEqual([
      "digest",
      "fields",
      "schema",
    ]);
  });

  it("a lock pins each instrument that is not a built-in", () => {
    const lock = fixture("suite.lock");
    const instruments = lock["instruments"] as Record<string, Rec>;
    expect(Object.keys(instruments).toSorted()).toEqual(["quality-judge", "ts-scorers"]);
    expect(instruments["quality-judge"]!["judge"]).toMatchObject({ model: expect.any(String) });
  });
});
