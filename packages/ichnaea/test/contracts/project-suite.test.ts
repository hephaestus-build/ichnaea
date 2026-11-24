// The project config and the legacy suite lock keep their v1 contracts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  contractFor,
  ProjectConfig,
  projectDigest,
  RECORD_CONTRACTS,
  schemaFileName,
  SuiteLock,
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
const project = (): Rec => structuredClone(fixture("project"));
const file = (id: string): string => schemaFileName(contractFor(id)!);
// Synthetic token bodies, built here so that no token-shaped literal sits in the source.
const body = (n: number): string => "x0".repeat(n).slice(0, n);

/** zod and ajv must give the same answer, so every claim is checked in both. */
function accepts(name: string, value: unknown): boolean {
  const contract = RECORD_CONTRACTS.find((c) => c.name === name)!;
  const zod = contract.schema.safeParse(value).success;
  expect(ajvValidate(ajv, name, value)).toBe(zod);
  return zod;
}

describe("the record inventory", () => {
  it("registers the project and legacy lock records", () => {
    for (const [id, schema] of [
      ["ichnaea.project/1", ProjectConfig],
      ["ichnaea.suite.lock/1", SuiteLock],
    ] as const) {
      expect(contractFor(id)?.schema).toBe(schema);
      expect(contractFor(id)?.stability).toBe("alpha");
    }
  });

  it("keeps suite/1 and configuration/1 and withdraws their unwritten v2 records", () => {
    expect(contractFor("ichnaea.suite/1")?.name).toBe("suite");
    expect(contractFor("ichnaea.configuration/1")?.name).toBe("configuration");
    expect(contractFor("ichnaea.suite/2")).toBeUndefined();
    expect(contractFor("ichnaea.configuration/2")).toBeUndefined();
  });

  it("names the files that editors read with their major, so a $schema never changes meaning", () => {
    expect(contractFor("ichnaea.project/1")?.name).toBe("project");
    expect(file("ichnaea.project/1")).toBe("project.1.schema.json");
    expect(schemaFileName(contractFor("ichnaea.project/1")!, "reader")).toBe(
      "project.1.reader.schema.json",
    );
    expect(file("ichnaea.suite.lock/1")).toBe("suite.lock.schema.json");
    expect(file("ichnaea.case/1")).toBe("case.schema.json");
  });
});

describe("the authored files", () => {
  it("accepts an editor schema pointer without changing the project digest", () => {
    const p = project();
    const jsonc = { ...p, $schema: "./schemas/project.1.schema.json" };
    expect(accepts("project", jsonc)).toBe(true);
    expect(projectDigest(p)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(projectDigest(jsonc)).toBe(projectDigest(p));
  });

  it("refuses an editor schema pointer in a machine-written lock", () => {
    expect(accepts("suite.lock", { ...fixture("suite.lock"), $schema: "x.json" })).toBe(false);
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
    (p["workers"] as Record<string, Rec>)["assistant"]!["command"] = ["worker", argument];
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
    (p["workers"] as Record<string, Rec>)["assistant"]!["command"] = ["worker", argument];
    expect(accepts("project", p)).toBe(true);
  });

  it("keep a secret out of the file: an environment entry names the variable, never its value", () => {
    const p = project();
    const worker = (p["workers"] as Record<string, Rec>)["assistant"]!;
    worker["env"] = [{ name: "LLM_API_KEY", value: "sk-live-0123456789" }];
    expect(accepts("project", p)).toBe(false);
  });
});

describe("the legacy lock", () => {
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
