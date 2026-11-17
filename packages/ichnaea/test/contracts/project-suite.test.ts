// The project config, the suite, the arm configuration and the lock (ichnaea.project/1, suite/2,
// configuration/2, suite.lock/1). They validate JSON values: a measure names a module, never a
// function. A value that is not plain JSON data is the loader's to refuse, by plainDataProblems.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigurationV2,
  contractFor,
  plainDataProblems,
  ProjectConfig,
  projectDigest,
  RECORD_CONTRACTS,
  schemaFileName,
  SuiteLock,
  suiteDigest,
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
const file = (id: string): string => schemaFileName(contractFor(id)!);
// Synthetic token bodies, built here so that no token-shaped literal sits in the source.
const body = (n: number): string => "x0".repeat(n).slice(0, n);
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
      ["ichnaea.project/1", ProjectConfig],
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

  it("names the files that editors read with their major, so a $schema never changes meaning", () => {
    expect(contractFor("ichnaea.project/1")?.name).toBe("project");
    expect(file("ichnaea.project/1")).toBe("project.1.schema.json");
    expect(schemaFileName(contractFor("ichnaea.project/1")!, "reader")).toBe(
      "project.1.reader.schema.json",
    );
    expect(file("ichnaea.suite/2")).toBe("suite.2.schema.json");
    expect(file("ichnaea.configuration/2")).toBe("configuration.2.schema.json");
    expect(file("ichnaea.suite.lock/1")).toBe("suite.lock.schema.json");
    expect(file("ichnaea.case/1")).toBe("case.schema.json");
  });
});

describe("the authored files", () => {
  it("accept the $schema pointer that a JSONC file carries for its editor", () => {
    expect(accepts("suite.2", { ...suite(), $schema: "../../schemas/suite.2.schema.json" })).toBe(
      true,
    );
    expect(accepts("project", { ...project(), $schema: "./schemas/project.1.schema.json" })).toBe(
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

  it("refuse a function value where a scorer belongs", () => {
    const s = suite();
    measures(s)["cites-page"]!["scorer"] = (output: string) => output.includes("http");
    expect(SuiteV2.safeParse(s).success).toBe(false);
  });

  it("validate JSON values only: the loader refuses a value that is not plain data first", () => {
    // zod drops an undefined member and reads a class instance as an object, so the record alone
    // cannot hold the plain-data rule. plainDataProblems names every such field.
    const s = suite();
    s["version"] = undefined;
    expect(SuiteV2.safeParse(s).success).toBe(true);
    expect(plainDataProblems(s)).toEqual(['"/version": undefined']);
  });

  it("digest a suite and a project config synchronously, without $schema, so the forms agree", () => {
    const s = suite();
    const jsonc = { $schema: "../../schemas/suite.2.schema.json", ...s };
    expect(suiteDigest(jsonc)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(suiteDigest(jsonc)).toBe(suiteDigest(s));
    expect(suiteDigest({ ...s, version: "5" })).not.toBe(suiteDigest(s));
    const p = project();
    expect(projectDigest(p)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(projectDigest({ ...p, $schema: "./schemas/project.1.schema.json" })).toBe(
      projectDigest(p),
    );
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

  it.each([
    [
      "a token in the user information",
      "https://x-access-token:ghp_abcdefghij0123456789@github.com/o/r.git",
    ],
    ["a user and password", "https://user:secret@example.com/o/r.git"],
    ["a query", "https://github.com/o/r.git?token=abc"],
    ["a password in an ssh URL", "ssh://git:secret@github.com/o/r.git"],
    ["a password in the scp form", "git:secret@github.com:o/r.git"],
    ["a token in the scp form", `git@github.com:o/ghp_${"x0".repeat(18)}`],
    ["an https URL read as the scp form", "https://user:secret@github.com/o/r.git"],
  ])("refuse a git repository URL with %s, in a dataset and in a suite", (_, repo) => {
    const p = project();
    (p["datasets"] as Record<string, { git: Rec }>)["answers-public"]!.git["repo"] = repo;
    expect(accepts("project", p)).toBe(false);
    const s = suite();
    delete (s["cases"] as Rec)["from"];
    (s["cases"] as Rec)["source"] = { git: { repo, commit: "a".repeat(40) } };
    expect(accepts("suite.2", s)).toBe(false);
  });

  it.each([
    "https://github.com/example/answers-eval",
    "git@github.com:example/answers-eval-private.git",
    "ssh://git@github.com/example/answers-eval.git",
    "git@github.com:/abs/repo",
    "github.com:a/b",
    "ssh://git@host/a@b",
    "ssh://git@github.com:2222/o/r.git",
  ])("accept the git repository %s", (repo) => {
    const p = project();
    (p["datasets"] as Record<string, { git: Rec }>)["answers-public"]!.git["repo"] = repo;
    expect(accepts("project", p)).toBe(true);
  });

  it.each([
    ["a GitHub token", `ghp_${body(36)}`],
    ["a GitHub OAuth token after =", `--token=gho_${body(36)}`],
    ["a fine-grained GitHub token", `github_pat_${body(22)}`],
    ["a GitLab personal token", `glpat-${body(20)}`],
    ["a GitLab pipeline trigger token", `glptt-${body(20)}`],
    ["a GitLab deploy token", `gldt-${body(20)}`],
    ["a Slack bot token", ["xoxb", "1234567890", "1234567890", body(24)].join("-")],
    ["a Slack app token", ["xapp", "1", "A0123BCDE", "1234567890123", body(32)].join("-")],
    ["a Hugging Face token", `hf_${body(34)}`],
    ["an OpenAI or Anthropic key", `sk-ant-api03-${body(20)}`],
    ["a Langfuse public key", `pk-lf-${body(20)}`],
    ["an AWS access key", `AKIA${"ABCDEFGHIJKLMNOP"}`],
    ["an AWS temporary key", `ASIA${"ABCDEFGHIJKLMNOP"}`],
    ["an authorization header", "Authorization: token abc"],
    ["an authorization header in capitals", "AUTHORIZATION: x"],
    ["an authorization header with a tab", "authorization\t:x"],
    ["a bearer value", "Bearer abc.def.ghi"],
    ["a bearer value after a tab", "bearer\tabc"],
  ])("refuse a command argument that holds %s", (_, argument) => {
    const p = project();
    (p["workers"] as Record<string, Rec>)["chatbot"]!["command"] = ["worker", argument];
    expect(accepts("project", p)).toBe(false);
  });

  it.each([
    "--task-id",
    "max_tokens=800",
    "--disk-cache",
    "skip-tests",
    "bearer.ts",
    "--sk-learn",
    "sk-1",
    "--seed=sk-1",
    "run-sk-2",
    "-sk-model",
    "hf_datasets/cache",
    `--model=my-sk-${body(24)}`,
    `cache-ghp_${body(36)}`,
  ])("accept the ordinary command argument %s", (argument) => {
    const p = project();
    (p["workers"] as Record<string, Rec>)["chatbot"]!["command"] = ["worker", argument];
    expect(accepts("project", p)).toBe(true);
  });

  it("refuse an import module outside the suite's tree", () => {
    const s = suite();
    delete s["worker"];
    s["import"] = { module: "importers/bench.ts" };
    expect(accepts("suite.2", s)).toBe(true);
    s["import"] = { module: "../importers/bench.ts" };
    expect(accepts("suite.2", s)).toBe(false);
  });

  it("give each pool its label, and only the validation pool a reuse budget", () => {
    const s = suite();
    const pools = (s["cases"] as Rec)["pools"] as Record<string, Rec>;
    expect(pools).toEqual({
      development: { label: "dev" },
      validation: { label: "test", maxReads: 40 },
    });
    pools["development"]!["maxReads"] = 40;
    expect(accepts("suite.2", s)).toBe(false);
  });

  it("give a judge its parameters as JSON scalars", () => {
    const s = suite();
    const judge = (s["instruments"] as Record<string, Rec>)["quality-judge"]!["judge"] as Rec;
    expect(judge["parameters"]).toEqual({ temperature: 0 });
    judge["parameters"] = { temperature: 0, stop: null, json: true, seed: "7" };
    expect(accepts("suite.2", s)).toBe(true);
    judge["parameters"] = { response: { type: "json" } };
    expect(accepts("suite.2", s)).toBe(false);
    judge["temperature"] = 0;
    delete judge["parameters"];
    expect(accepts("suite.2", s)).toBe(false);
  });

  it("give a level measure its levels, anchors, and equal spacing or a cut", () => {
    const s = suite();
    const level = {
      type: "level",
      levels: [0, 1, 2, 3],
      anchors: { "0": "wrong", "3": "complete" },
    };
    measures(s)["completeness"] = { ...level, spacing: "equal" };
    expect(accepts("suite.2", s)).toBe(true);
    measures(s)["completeness"] = { ...level, spacing: { cut: 2 } };
    expect(accepts("suite.2", s)).toBe(true);
    measures(s)["completeness"] = { ...level, spacing: "unequal" };
    expect(accepts("suite.2", s)).toBe(false);
    measures(s)["completeness"] = { type: "level", spacing: "equal" };
    expect(accepts("suite.2", s)).toBe(false);
  });

  it("map each attributed measure to its fidelity margin, inside (0, 1)", () => {
    const s = suite();
    s["attribute"] = { fidelityMargin: { grounded: 0.025 } };
    expect(accepts("suite.2", s)).toBe(true);
    s["attribute"] = { fidelityMargin: {} };
    expect(accepts("suite.2", s)).toBe(true);
    for (const margin of [0, 1]) {
      s["attribute"] = { fidelityMargin: { grounded: margin } };
      expect(accepts("suite.2", s)).toBe(false);
    }
    s["attribute"] = { fidelityMargin: 0.025 };
    expect(accepts("suite.2", s)).toBe(false);
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

  it("a lock copies the primary limits under limits", () => {
    const lock = fixture("suite.lock");
    expect(Object.keys(lock)).toContain("limits");
    expect(Object.keys(lock)).not.toContain("registration");
  });

  it.each([
    ["a host with user information", { host: "user:pw@example.com", path: "/cases.jsonl" }],
    ["a path with a query", { host: "example.com", path: "/cases.jsonl?sig=abc" }],
    ["a token in the path", { host: "example.com", path: `/t/hf_${"x0".repeat(17)}/cases.jsonl` }],
  ])("a lock refuses an https origin with %s", (_, https) => {
    const lock = fixture("suite.lock");
    (lock["sources"] as Rec[])[0]!["origin"] = { https };
    expect(accepts("suite.lock", lock)).toBe(false);
  });

  it("a lock pins a judge's parameters as JSON scalars", () => {
    const lock = fixture("suite.lock");
    const judge = (lock["instruments"] as Record<string, Rec>)["quality-judge"]!["judge"] as Rec;
    judge["parameters"] = { nested: { a: 1 } };
    expect(accepts("suite.lock", lock)).toBe(false);
  });

  it("a lock pins each instrument that is not a built-in", () => {
    const lock = fixture("suite.lock");
    const instruments = lock["instruments"] as Record<string, Rec>;
    expect(Object.keys(instruments).toSorted()).toEqual(["quality-judge", "ts-scorers"]);
    expect(instruments["quality-judge"]!["judge"]).toMatchObject({ model: expect.any(String) });
  });
});
