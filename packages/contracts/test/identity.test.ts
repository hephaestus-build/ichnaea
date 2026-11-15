// REQ-148, REQ-14, REQ-10: configuration identity, required factors, case and case-set digests.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  Case as CaseSchema,
  caseDigest,
  caseSetDigest,
  type Configuration,
  Configuration as ConfigurationSchema,
  configurationIdentity,
  contractFor,
  DIGEST_RULES,
  IdentityError,
  Plan,
  readRecord,
  sha256,
  Trial,
  verifyArms,
  verifyConfiguration,
} from "../src/index.ts";
import { committedSchema } from "./support/ajv.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "valid", `${name}.json`), "utf8"),
  ) as T;

const uniq = <T>(items: readonly T[], key: (t: T) => string): T[] => [
  ...new Map(items.map((i) => [key(i), i])).values(),
];

/** Removes duplicate roles and names, which have no defined identity. */
function dedupe(config: Configuration): Configuration {
  return {
    ...config,
    models: uniq(config.models, (m) => m.role),
    parameters: uniq(config.parameters, (p) => p.name),
    // A generated template does not match its generated digest; templates have their own test.
    prompts: uniq(config.prompts, (p) => p.name).map(({ template: _t, ...p }) => p),
  };
}

describe("configuration identity", () => {
  const base = ConfigurationSchema.parse(fixture("configuration"));

  it("is stable across two resolutions of the same configuration", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryFor(ConfigurationSchema), async (generated) => {
        const config = dedupe(ConfigurationSchema.parse(generated));
        const again: Configuration = {
          ...structuredClone(config),
          models: config.models.toReversed(),
          parameters: config.parameters.toReversed(),
          prompts: config.prompts.toReversed(),
          factors: Object.fromEntries(Object.entries(config.factors).toReversed()),
        };
        expect(await configurationIdentity(again)).toBe(await configurationIdentity(config));
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });

  it.each<[string, (c: Configuration) => void]>([
    ["only the model ID", (c) => (c.models[0]!.id.value = "example-model-2026-11")],
    ["only the provider", (c) => (c.models[0]!.provider.value = "other-provider")],
    ["only a parameter value", (c) => (c.parameters[0]!.value = 0.3)],
    ["only a parameter's origin", (c) => (c.parameters[0]!.origin = "default")],
    [
      "only an application setting",
      (c) =>
        (c.factors["setting.answerLength"] = {
          value: "short",
          status: "declared",
          part: "setting",
        }),
    ],
    [
      "only the model version",
      (c) => (c.models[0]!.version = { value: "2026-10-01", status: "pinned" }),
    ],
    [
      "only the model route",
      (c) => (c.models[0]!.route = { value: "fallback", status: "declared" }),
    ],
    ["only a prompt digest", (c) => (c.prompts[0]!.digest = `sha256:${"9".repeat(64)}`)],
    ["only a factor status", (c) => (c.factors["data.helpCentre"]!.status = "pinned")],
    [
      "only the data digest",
      (c) => (c.factors["data.helpCentre"]!.value = `sha256:${"8".repeat(64)}`),
    ],
  ])("changes when %s changes", async (_, change) => {
    const changed = structuredClone(base);
    change(changed);
    expect(await configurationIdentity(changed)).not.toBe(await configurationIdentity(base));
  });

  it("records a prompt's template and uri without hashing them", async () => {
    const template = "Answer from the help centre only.";
    const declared = structuredClone(base);
    declared.prompts[0]!.digest = await sha256(template);
    const resolved = structuredClone(declared);
    resolved.prompts[0]!.template = template;
    resolved.prompts[0]!.uri = "file:prompts/answer.txt";
    expect(await configurationIdentity(resolved)).toBe(await configurationIdentity(declared));
    expect(await verifyConfiguration(resolved)).toEqual([]);
    const edited = structuredClone(resolved);
    edited.prompts[0]!.template = `${template} Be brief.`;
    expect(await verifyConfiguration(edited, "/c")).toEqual([
      {
        path: "/c/prompts/0/digest",
        stored: declared.prompts[0]!.digest,
        computed: await sha256(edited.prompts[0]!.template!),
      },
    ]);
    await expect(configurationIdentity(edited)).rejects.toThrow(
      "the template at /prompts/0/template does not match its digest",
    );
    const identity = await configurationIdentity(resolved);
    expect(await verifyArms([{ identity, configuration: edited }])).toEqual([
      {
        path: "/arms/0/configuration/prompts/0/digest",
        stored: declared.prompts[0]!.digest,
        computed: await sha256(edited.prompts[0]!.template!),
      },
    ]);
  });

  it("hashes a template as the bytes it was written with, trailing newline included", async () => {
    const candidate = structuredClone(
      (
        fixture<{ arms: Array<{ configuration: Configuration }> }>("plan").arms[1] as {
          configuration: Configuration;
        }
      ).configuration,
    );
    const prompt = candidate.prompts[0]!;
    expect(prompt.template).toMatch(/\n$/);
    expect(prompt.digest).toBe(await sha256(prompt.template!));
    expect(await verifyConfiguration(candidate)).toEqual([]);
    const trimmed = structuredClone(candidate);
    trimmed.prompts[0]!.template = prompt.template!.trim();
    expect(await verifyConfiguration(trimmed)).toHaveLength(1);
    await expect(configurationIdentity(trimmed)).rejects.toThrow(IdentityError);
  });

  it("reading a plan does not check its templates, and verifyArms does", async () => {
    const plan = structuredClone(
      fixture<{ arms: Array<{ identity: string; configuration: Configuration }> }>("plan"),
    );
    plan.arms[1]!.configuration.prompts[0]!.template = "not the digested text";
    expect(Plan.safeParse(plan).success).toBe(true);
    expect(readRecord(contractFor("ichnaea.plan/1")!, plan).ok).toBe(true);
    expect(await verifyArms(plan.arms)).toEqual([
      expect.objectContaining({ path: "/arms/1/configuration/prompts/0/digest" }),
    ]);
  });

  it("refuses a template with a lone surrogate, which has no UTF-8 form", async () => {
    const lone = "Answer from \ud800the help centre.";
    await expect(sha256(lone)).rejects.toThrow("lone surrogate");
    // The replacement character is what a text encoder would write for the lone surrogate.
    const replaced = await sha256("Answer from \ufffdthe help centre.");
    const config = structuredClone(base);
    config.prompts[0] = { ...config.prompts[0]!, digest: replaced, template: lone };
    expect(ConfigurationSchema.safeParse(config).success).toBe(true);
    const problem = {
      path: "/prompts/0/digest",
      stored: replaced,
      computed: null,
      problem: "the template has a lone surrogate, so it has no UTF-8 form",
    };
    expect(await verifyConfiguration(config)).toEqual([problem]);
    await expect(configurationIdentity(config)).rejects.toThrow(
      "the template at /prompts/0/template cannot be hashed: the template has a lone surrogate",
    );
    expect(await verifyArms([{ identity: replaced, configuration: config }])).toEqual([
      { ...problem, path: "/arms/0/configuration/prompts/0/digest" },
    ]);
  });

  it("does not change with the human label", async () => {
    expect(await configurationIdentity({ ...base, label: "candidate B" })).toBe(
      await configurationIdentity(base),
    );
  });

  it("refuses unknown members, so a misspelt or misplaced member cannot leave the identity unchanged", async () => {
    await expect(
      configurationIdentity({ ...structuredClone(base), tools: ["search"] }),
    ).rejects.toThrow();
    const misspelt = {
      ...structuredClone(base),
      models: base.models.map((m) => ({ ...m, versoin: { value: "x", status: "pinned" } })),
    };
    await expect(configurationIdentity(misspelt)).rejects.toThrow();
  });

  it("ignores the description and informational values, such as a provider fingerprint", async () => {
    const described = {
      ...structuredClone(base),
      description: "renamed",
      informational: { "provider.fingerprint": "fp_123" },
    };
    expect(await configurationIdentity(described)).toBe(await configurationIdentity(base));
  });

  it("a per-trial fingerprint lives in the trial, so it never touches the identity", async () => {
    const before = await configurationIdentity(base);
    const trial = Trial.parse({
      schema: "ichnaea.trial/1",
      id: "t",
      source: "offline",
      case: "c",
      unit: "turn",
      configuration: before,
      replicate: 0,
      outcome: "completed",
      dataClass: "none",
      observed: [{ name: "provider.fingerprint", value: "fp_new" }],
    });
    expect(trial.configuration).toBe(before);
    expect(await configurationIdentity(base)).toBe(before);
  });

  it("keeps a __proto__ member as data in the identity", async () => {
    const withProto = JSON.parse(
      JSON.stringify(base).replace(
        '"factors":{',
        '"factors":{"__proto__":{"value":"x","status":"pinned","part":"other"},',
      ),
    ) as unknown;
    expect(Object.hasOwn((withProto as { factors: object }).factors, "__proto__")).toBe(true);
    expect(await configurationIdentity(withProto)).not.toBe(await configurationIdentity(base));
  });

  it("verifies that stored arm identities match their configurations", async () => {
    const identity = await configurationIdentity(base);
    expect(await verifyArms([{ identity, configuration: base }])).toEqual([]);
    const wrong = await verifyArms([{ identity: `sha256:${"0".repeat(64)}`, configuration: base }]);
    expect(wrong).toEqual([
      { path: "/arms/0/identity", stored: `sha256:${"0".repeat(64)}`, computed: identity },
    ]);
  });

  it("reports an arm that has no identity instead of throwing", async () => {
    const identity = await configurationIdentity(base);
    const duplicated = structuredClone(base);
    duplicated.models.push(structuredClone(duplicated.models[0]!));
    const noModels = { ...structuredClone(base), models: [] };
    const notARecord = "not a configuration";
    const errors = await verifyArms([
      { identity, configuration: base },
      { identity, configuration: duplicated },
      { identity, configuration: noModels },
      { identity, configuration: notARecord },
    ]);
    expect(errors.map((e) => [e.path, e.stored, e.computed])).toEqual([
      ["/arms/1/configuration", identity, null],
      ["/arms/2/configuration", identity, null],
      ["/arms/3/configuration", identity, null],
    ]);
    expect(errors[0]!.problem).toContain("duplicate model role 'answer'");
    expect(errors[1]!.problem).toContain("models");
    expect(errors[2]!.problem).toBeTruthy();
  });

  it.each([
    ["model role", (c: Configuration) => c.models.push(structuredClone(c.models[0]!))],
    ["parameter", (c: Configuration) => c.parameters.push(structuredClone(c.parameters[0]!))],
    ["prompt", (c: Configuration) => c.prompts.push(structuredClone(c.prompts[0]!))],
  ])("refuses a duplicate %s, whose identity would depend on order", async (_, add) => {
    const duplicated = structuredClone(base);
    add(duplicated);
    await expect(configurationIdentity(duplicated)).rejects.toThrow(IdentityError);
  });

  it.each<[string, (c: Record<string, unknown>) => void]>([
    ["without models", (c) => delete c["models"]],
    ["without parameters", (c) => delete c["parameters"]],
    ["with no parameter", (c) => (c["parameters"] = [])],
    [
      "with an empty model ID",
      (c) => ((c["models"] as Array<{ id: { value: unknown } }>)[0]!.id.value = ""),
    ],
    [
      "with a null model ID",
      (c) => ((c["models"] as Array<{ id: { value: unknown } }>)[0]!.id.value = null),
    ],
    ["without a description", (c) => delete c["description"]],
  ])("a configuration %s fails validation and has no identity (REQ-14)", async (_, breakIt) => {
    const broken: Record<string, unknown> = structuredClone(base);
    breakIt(broken);
    expect(ConfigurationSchema.safeParse(broken).success).toBe(false);
    await expect(configurationIdentity(broken)).rejects.toThrow();
  });
});

describe("case and case-set digests", () => {
  const record = CaseSchema.parse(fixture("case"));

  it("a case digest refuses members the schema does not define", async () => {
    await expect(caseDigest({ ...record, futureField: [1] })).rejects.toThrow();
  });

  it("changes when any one case changes (REQ-10)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryFor(CaseSchema), { minLength: 1, maxLength: 5 }),
        fc.nat(),
        async (generated, pick) => {
          const cases = generated.map((g, i) => ({ ...CaseSchema.parse(g), id: `c-${i}` }));
          const entries = await Promise.all(
            cases.map(async (c) => ({ id: c.id, digest: await caseDigest(c), pool: c.pool })),
          );
          const index = pick % cases.length;
          const changed = { ...cases[index]!, input: { ...cases[index]!.input, extra: "changed" } };
          const changedEntries = [...entries];
          changedEntries[index] = {
            id: changed.id,
            digest: await caseDigest(changed),
            pool: changed.pool,
          };
          expect(await caseSetDigest(changedEntries as never)).not.toBe(
            await caseSetDigest(entries as never),
          );
          expect(await caseSetDigest(entries.toReversed() as never)).toBe(
            await caseSetDigest(entries as never),
          );
        },
      ),
      { seed: 20261115, numRuns: 100 },
    );
  });

  it("ignores the author pointer, the review status and the case set pointer", async () => {
    const reviewed = {
      ...structuredClone(record),
      validation: { status: "validated" },
      provenance: { ...record.provenance, author: "someone else" },
      caseSet: "another-set",
    };
    expect(await caseDigest(reviewed)).toBe(await caseDigest(record));
    await expect(caseSetDigest([])).rejects.toThrow(IdentityError);
  });

  it.each<[string, (c: Record<string, unknown>) => void]>([
    ["criticality", (c) => (c["criticality"] = "critical")],
    ["slices", (c) => (c["slices"] = { language: "fr" })],
    ["selection", (c) => ((c["provenance"] as Record<string, unknown>)["selection"] = "random")],
    ["exposure", (c) => ((c["provenance"] as Record<string, unknown>)["exposure"] = "sealed")],
    ["data class", (c) => (c["dataClass"] = "personal")],
    ["pool", (c) => (c["pool"] = "sealed")],
    ["family", (c) => (c["family"] = "another-family")],
    ["licence", (c) => ((c["provenance"] as Record<string, unknown>)["licence"] = "MIT")],
  ])("changes the case and case-set digest when the %s changes", async (_, change) => {
    const changed: Record<string, unknown> = structuredClone(record);
    change(changed);
    expect(await caseDigest(changed)).not.toBe(await caseDigest(record));
    const entry = async (c: unknown): Promise<unknown> => ({
      id: record.id,
      digest: await caseDigest(c),
      pool: record.pool,
    });
    expect(await caseSetDigest([await entry(changed)])).not.toBe(
      await caseSetDigest([await entry(record)]),
    );
  });

  it("changes when a case moves to another pool, and refuses duplicate IDs", async () => {
    const entry = { id: record.id, digest: await caseDigest(record), pool: record.pool };
    expect(await caseSetDigest([{ ...entry, pool: "sealed" }])).not.toBe(
      await caseSetDigest([entry]),
    );
    await expect(caseSetDigest([entry, entry])).rejects.toThrow(IdentityError);
  });
});

type Rec = Record<string, unknown>;
const member = (value: unknown, key: string): Rec => (value as Rec)[key] as Rec;

/**
 * What each digest hashes and what it leaves out, written out by hand. The tests below hold
 * `DIGEST_RULES` and the digest functions to this list. Nothing here is read from the rules, so a
 * member that moves in or out of a rule fails a test here, whichever way the rule file is
 * regenerated. `schema` is a one-value literal: it is excluded and nothing can change it.
 */
const SPEC = {
  case: {
    hashed: [
      "id",
      "unit",
      "dataClass",
      "input",
      "turns",
      "fixtures",
      "references",
      "family",
      "slices",
      "criticality",
      "provenance",
      "pool",
    ],
    excluded: ["schema", "caseSet", "validation"],
  },
  provenance: {
    hashed: [
      "source",
      "selection",
      "created",
      "collected",
      "licence",
      "exposure",
      "generator",
      "reusedDataset",
      "finding",
    ],
    excluded: ["author"],
  },
  caseSetEntry: { hashed: ["id", "digest", "pool", "family"], excluded: [] },
  configuration: {
    hashed: ["models", "parameters", "prompts", "factors"],
    excluded: ["schema", "description", "label", "informational"],
  },
  prompt: { hashed: ["name", "digest", "status"], excluded: ["template", "uri"] },
} as const;

/** One member of a digest, a change to it, and whether the digest must follow. */
interface Row {
  readonly label: string;
  readonly hashed: boolean;
  readonly base: () => Rec;
  readonly change: (record: Rec) => void;
}
const row = (label: string, hashed: boolean, base: () => Rec, change: (r: Rec) => void): Row => ({
  label,
  hashed,
  base,
  change,
});

const authored = (): Rec => structuredClone(fixture<Rec>("case"));
const withProvenance = (members: Rec) => (): Rec => {
  const c = authored();
  c["provenance"] = { ...member(c, "provenance"), ...members };
  return c;
};
const generated = withProvenance({
  source: "generated",
  generator: { method: "template expansion", model: "generator-1", seedSource: "fixed" },
});
const reused = withProvenance({
  source: "reused",
  reusedDataset: { name: "public support questions", version: "2", limits: "English only" },
});
const collected = withProvenance({ source: "collected", collected: "2026-10-20" });
const promoted = withProvenance({ source: "promoted", finding: "finding-17" });
const provenanceOf = (c: Rec): Rec => member(c, "provenance");

const CASE_ROWS: readonly Row[] = [
  row("id", true, authored, (c) => (c["id"] = "refund-window-de-2")),
  row("unit", true, authored, (c) => (c["unit"] = "turn")),
  row("dataClass", true, authored, (c) => (c["dataClass"] = "personal")),
  row("input", true, authored, (c) => (member(c, "input")["lang"] = "fr")),
  row("turns", true, authored, (c) => ((c["turns"] as Rec[])[0]!["content"] = "Und ohne Bon?")),
  row("fixtures", true, authored, (c) => ((c["fixtures"] as Rec[])[0]!["name"] = "policy-2.md")),
  row("references", true, authored, (c) => (c["references"] = { facts: [] })),
  row("family", true, authored, (c) => (c["family"] = "another-family")),
  row("slices", true, authored, (c) => (member(c, "slices")["lang"] = "fr")),
  row("criticality", true, authored, (c) => (c["criticality"] = "low")),
  row("pool", true, authored, (c) => (c["pool"] = "sealed")),
  // A change of the arm alone: both records carry `collected`, only `source` differs.
  row(
    "provenance.source",
    true,
    withProvenance({ collected: "2026-10-20" }),
    (c) => (provenanceOf(c)["source"] = "collected"),
  ),
  row("provenance.selection", true, authored, (c) => (provenanceOf(c)["selection"] = "random")),
  row("provenance.created", true, authored, (c) => (provenanceOf(c)["created"] = "2026-11-02")),
  row(
    "provenance.collected",
    true,
    collected,
    (c) => (provenanceOf(c)["collected"] = "2026-10-21"),
  ),
  row("provenance.licence", true, authored, (c) => (provenanceOf(c)["licence"] = "MIT")),
  row("provenance.exposure", true, authored, (c) => (provenanceOf(c)["exposure"] = "sealed")),
  row(
    "provenance.generator",
    true,
    generated,
    (c) => (member(provenanceOf(c), "generator")["method"] = "paraphrase"),
  ),
  row(
    "provenance.reusedDataset",
    true,
    reused,
    (c) => (member(provenanceOf(c), "reusedDataset")["limits"] = "German only"),
  ),
  row("provenance.finding", true, promoted, (c) => (provenanceOf(c)["finding"] = "finding-18")),
  row("caseSet", false, authored, (c) => (c["caseSet"] = "another-set")),
  row("caseSet", false, authored, (c) => delete c["caseSet"]),
  row("validation", false, authored, (c) => (c["validation"] = { status: "suspect", note: "x" })),
  row("provenance.author", false, authored, (c) => (provenanceOf(c)["author"] = "another person")),
  row("provenance.author", false, authored, (c) => delete provenanceOf(c)["author"]),
];

const base = (): Rec => structuredClone(fixture<Rec>("configuration"));
/** The plan's candidate arm: its prompt carries a template and a URI. */
const templated = (): Rec =>
  structuredClone(member((fixture<{ arms: Rec[] }>("plan").arms[1] as Rec)!, "configuration"));
const promptOf = (c: Rec): Rec => (c["prompts"] as Rec[])[0]!;

const CONFIGURATION_ROWS: readonly Row[] = [
  row("models", true, base, (c) => (member((c["models"] as Rec[])[0], "id")["value"] = "other")),
  row("parameters", true, base, (c) => ((c["parameters"] as Rec[])[0]!["value"] = 0.9)),
  row("prompts.name", true, base, (c) => (promptOf(c)["name"] = "answer-2")),
  row("prompts.digest", true, base, (c) => (promptOf(c)["digest"] = `sha256:${"9".repeat(64)}`)),
  row("prompts.status", true, base, (c) => (promptOf(c)["status"] = "declared")),
  row("factors", true, base, (c) => (member(member(c, "factors"), "code.commit")["value"] = "abc")),
  row("description", false, base, (c) => (c["description"] = "another description")),
  row("label", false, base, (c) => (c["label"] = "another label")),
  row("informational", false, base, (c) => (c["informational"] = { "provider.fingerprint": "x" })),
  row("prompts.template", false, templated, (c) => delete promptOf(c)["template"]),
  row("prompts.uri", false, templated, (c) => (promptOf(c)["uri"] = "file:prompts/other.txt")),
];

const entry = (): Rec => ({
  id: "refund-window-de",
  digest: `sha256:${"a".repeat(64)}`,
  pool: "development",
  family: "refund-window",
});
const ENTRY_ROWS: readonly Row[] = [
  row("id", true, entry, (e) => (e["id"] = "refund-window-fr")),
  row("digest", true, entry, (e) => (e["digest"] = `sha256:${"b".repeat(64)}`)),
  row("pool", true, entry, (e) => (e["pool"] = "sealed")),
  row("family", true, entry, (e) => (e["family"] = "another-family")),
];

/** The member names a writer schema object defines, over every arm of a union. */
const membersOf = (node: Record<string, unknown>): string[] => {
  const arms = (node["oneOf"] ?? node["anyOf"] ?? [node]) as Array<Record<string, unknown>>;
  return [
    ...new Set(arms.flatMap((a) => Object.keys((a["properties"] ?? {}) as object))),
  ].toSorted();
};

const listed = (rule: { members: readonly string[]; excluded: object }): string[] =>
  [...rule.members, ...Object.keys(rule.excluded)].toSorted();

const labels = (rows: readonly Row[]): string[] =>
  [...new Set(rows.map((r) => r.label))].toSorted();
const specLabels = (kind: "case" | "configuration"): string[] => {
  const [top, nested, nestedKey] =
    kind === "case"
      ? (["case", "provenance", "provenance"] as const)
      : (["configuration", "prompt", "prompts"] as const);
  const own = [...SPEC[top].hashed, ...SPEC[top].excluded].filter((m) => m !== "schema");
  const inner = [...SPEC[nested].hashed, ...SPEC[nested].excluded];
  return [...own.filter((m) => m !== nestedKey), ...inner.map((m) => `${nestedKey}.${m}`)]
    .filter((l) => !(kind === "case" && l === "provenance"))
    .toSorted();
};

describe("the digest rules, held to the list of what each digest hashes", () => {
  it.each(Object.entries(SPEC))(
    "DIGEST_RULES.%s hashes and excludes exactly the listed members",
    (name, spec) => {
      const rule = DIGEST_RULES[name as keyof typeof DIGEST_RULES];
      expect([...rule.members].toSorted()).toEqual([...spec.hashed].toSorted());
      expect(Object.keys(rule.excluded).toSorted()).toEqual([...spec.excluded].toSorted());
    },
  );

  it("has a behaviour test for every listed member, and no other", () => {
    expect(labels(CASE_ROWS)).toEqual(specLabels("case"));
    expect(labels(CONFIGURATION_ROWS)).toEqual(specLabels("configuration"));
    expect(labels(ENTRY_ROWS)).toEqual([...SPEC.caseSetEntry.hashed].toSorted());
  });

  it.each(CASE_ROWS.map((r) => [r.label, r] as const))(
    "a case digest follows its %s as listed",
    async (_, r) => {
      const before = await caseDigest(r.base());
      const changed = r.base();
      r.change(changed);
      expect(CaseSchema.safeParse(changed).success, "the changed case is valid").toBe(true);
      if (r.hashed) expect(await caseDigest(changed)).not.toBe(before);
      else expect(await caseDigest(changed)).toBe(before);
    },
  );

  it.each(CONFIGURATION_ROWS.map((r) => [r.label, r] as const))(
    "a configuration identity follows its %s as listed",
    async (_, r) => {
      const before = await configurationIdentity(r.base());
      const changed = r.base();
      r.change(changed);
      expect(
        ConfigurationSchema.safeParse(changed).success,
        "the changed configuration is valid",
      ).toBe(true);
      if (r.hashed) expect(await configurationIdentity(changed)).not.toBe(before);
      else expect(await configurationIdentity(changed)).toBe(before);
    },
  );

  it.each(ENTRY_ROWS.map((r) => [r.label, r] as const))(
    "a case set digest follows the %s of an entry",
    async (_, r) => {
      const before = await caseSetDigest([r.base()]);
      const changed = r.base();
      r.change(changed);
      expect(await caseSetDigest([changed])).not.toBe(before);
    },
  );

  it("lists every member the writer schema defines, hashed or excluded with a reason", () => {
    const caseSchema = committedSchema("case") as Record<string, Record<string, unknown>>;
    const props = caseSchema["properties"] as Record<string, Record<string, unknown>>;
    expect(listed(DIGEST_RULES.case)).toEqual(membersOf(caseSchema));
    expect(listed(DIGEST_RULES.provenance)).toEqual(membersOf(props["provenance"]!));
    const config = committedSchema("configuration") as Record<string, unknown>;
    const configProps = config["properties"] as Record<string, Record<string, unknown>>;
    expect(listed(DIGEST_RULES.configuration)).toEqual(membersOf(config));
    expect(listed(DIGEST_RULES.prompt)).toEqual(
      membersOf(configProps["prompts"]!["items"] as Record<string, unknown>),
    );
    const caseSet = committedSchema("caseSet") as Record<string, unknown>;
    const entries = (caseSet["properties"] as Record<string, Record<string, unknown>>)["cases"]!;
    expect(listed(DIGEST_RULES.caseSetEntry)).toEqual(
      membersOf(entries["items"] as Record<string, unknown>),
    );
    for (const rule of Object.values(DIGEST_RULES))
      for (const reason of Object.values(rule.excluded)) expect(reason.length).toBeGreaterThan(10);
  });

  it("is the rule file other languages read", () => {
    const file = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "fixtures", "digest-rules.json"), "utf8"),
    ) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(DIGEST_RULES)));
  });
});

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Path = ReadonlyArray<string | number>;

const isLeaf = (value: unknown): boolean => value === null || typeof value !== "object";

/** Every leaf of a JSON value with its path. */
function leaves(value: Json, path: Array<string | number> = []): Array<Array<string | number>> {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, i]));
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [path];
}

const valueAt = (root: Json, path: Path): unknown =>
  path.reduce<unknown>(
    (node, key) => (node !== null && typeof node === "object" ? (node as Rec)[key] : undefined),
    root,
  );

function withLeaf(root: Json, path: Path, value: unknown): Json {
  const copy = structuredClone(root);
  let node = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path[path.length - 1] as string | number] = value;
  return copy;
}

/** Other values of the same JSON type, to try in turn until one is valid. */
function candidates(value: unknown, other: unknown): unknown[] {
  const list: unknown[] = [other];
  if (typeof value === "string") {
    list.push(
      /^\d{4}-\d\d-\d\d$/.test(value) ? "2000-01-01" : `${value}x`,
      value.startsWith("sha256:") ? `sha256:${"7".repeat(64)}` : `${value}y`,
    );
  } else if (typeof value === "number") list.push(value === 0 ? 1 : -value, value + 1);
  else if (typeof value === "boolean") list.push(!value);
  return list.filter((c) => isLeaf(c) && !Object.is(c, value));
}

type Ruling = "hashed" | "excluded" | "unlisted";

const listedIn = (
  spec: { hashed: readonly string[]; excluded: readonly string[] },
  key = "",
): Ruling =>
  spec.hashed.includes(key) ? "hashed" : spec.excluded.includes(key) ? "excluded" : "unlisted";

/** What the list says about a leaf: hashed, excluded, or not listed at all. */
function ruling(path: Path, kind: "case" | "configuration"): Ruling {
  const [top, second, third] = path as string[];
  if (kind === "case") {
    if (top === "provenance") return listedIn(SPEC.provenance, second);
    return listedIn(SPEC.case, top);
  }
  if (top === "prompts") return listedIn(SPEC.prompt, third);
  return listedIn(SPEC.configuration, top);
}

const labelOf = (path: Path, kind: "case" | "configuration"): string => {
  const [top, second, third] = path as string[];
  if (kind === "case") return top === "provenance" ? `provenance.${second}` : top!;
  return top === "prompts" ? `prompts.${third}` : top!;
};

describe("digests over generated records", () => {
  it.each([
    ["configuration", ConfigurationSchema, configurationIdentity],
    ["case", CaseSchema, caseDigest],
  ] as const)(
    "a %s digest follows the list for every leaf, changed to another valid value",
    async (kind, schema, digestOf) => {
      const prepare = (value: unknown): Json => {
        const parsed = schema.parse(value);
        return (kind === "configuration"
          ? dedupe(parsed as Configuration)
          : parsed) as unknown as Json;
      };
      const exercised = new Set<string>();
      await fc.assert(
        fc.asyncProperty(arbitraryFor(schema), arbitraryFor(schema), async (first, second) => {
          const record = prepare(first);
          const other = prepare(second);
          let before: string;
          try {
            before = await digestOf(record);
          } catch {
            fc.pre(false);
            return;
          }
          for (const path of leaves(record).filter((p) => p.length > 0 && p[0] !== "schema")) {
            const verdict = ruling(path, kind);
            expect(verdict, `${path.join("/")} is in no list`).not.toBe("unlisted");
            const current = valueAt(record, path);
            for (const candidate of candidates(current, valueAt(other, path))) {
              const changed = withLeaf(record, path, candidate);
              if (!schema.safeParse(changed).success) continue;
              let after: string;
              try {
                after = await digestOf(changed);
              } catch {
                // A changed role or name can duplicate another, which has no identity.
                continue;
              }
              expect(after === before, `${path.join("/")} is ${verdict}`).toBe(
                verdict === "excluded",
              );
              exercised.add(labelOf(path, kind));
              break;
            }
          }
        }),
        { seed: 20261115, numRuns: 25 },
      );
      // A property that skips a member proves nothing about it: every listed member was changed
      // at least once. Two members are left to the explicit rows above. A generated template does
      // not match its generated digest, so `dedupe` removes it. The arm in `provenance.source`
      // changes alone only between some arms, so a run may or may not reach it.
      const explicitOnly = new Set(["prompts.template", "provenance.source"]);
      expect([...exercised].filter((l) => !explicitOnly.has(l)).toSorted()).toEqual(
        specLabels(kind).filter((l) => !explicitOnly.has(l)),
      );
    },
  );
});
