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
  DIGEST_RULES,
  IdentityError,
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
    prompts: uniq(config.prompts, (p) => p.name),
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

  it("records a prompt's template and uri without hashing them (DN-7)", async () => {
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
    const identity = await configurationIdentity(edited);
    expect(await verifyArms([{ identity, configuration: edited }])).toEqual([
      {
        path: "/arms/0/configuration/prompts/0/digest",
        stored: declared.prompts[0]!.digest,
        computed: await sha256(edited.prompts[0]!.template!),
      },
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

  it("ignores only the author pointer and the review status (DN-6)", async () => {
    const reviewed = {
      ...structuredClone(record),
      validation: { status: "validated" },
      provenance: { ...record.provenance, author: "someone else" },
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
  ])("changes the case and case-set digest when the %s changes (DN-6)", async (_, change) => {
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

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every leaf of a JSON value with its path. */
function leaves(value: Json, path: Array<string | number> = []): Array<Array<string | number>> {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, i]));
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [path];
}

/** A different value of the same JSON type. */
function changedLeaf(value: Json): Json {
  if (typeof value === "string") return `${value}x`;
  if (typeof value === "number") return value === 0 ? 1 : -value;
  if (typeof value === "boolean") return !value;
  return 0;
}

function withLeaf(root: Json, path: ReadonlyArray<string | number>): Json {
  const copy = structuredClone(root);
  let node = copy as Record<string | number, Json>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, Json>;
  const last = path[path.length - 1] as string | number;
  node[last] = changedLeaf(node[last] as Json);
  return copy;
}

/** Whether a leaf lies under an excluded member of a rule. */
function excluded(path: ReadonlyArray<string | number>, kind: "case" | "configuration"): boolean {
  const [top, , nested] = path;
  if (kind === "case")
    return (
      Object.hasOwn(DIGEST_RULES.case.excluded, top as string) ||
      (top === "provenance" && Object.hasOwn(DIGEST_RULES.provenance.excluded, path[1] as string))
    );
  return (
    Object.hasOwn(DIGEST_RULES.configuration.excluded, top as string) ||
    (top === "prompts" && Object.hasOwn(DIGEST_RULES.prompt.excluded, nested as string))
  );
}

/** The member names a writer schema object defines, over every arm of a union. */
const membersOf = (node: Record<string, unknown>): string[] => {
  const arms = (node["oneOf"] ?? node["anyOf"] ?? [node]) as Array<Record<string, unknown>>;
  return [
    ...new Set(arms.flatMap((a) => Object.keys((a["properties"] ?? {}) as object))),
  ].toSorted();
};

const listed = (rule: { members: readonly string[]; excluded: object }): string[] =>
  [...rule.members, ...Object.keys(rule.excluded)].toSorted();

describe("digest rules", () => {
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

  it.each([
    ["configuration", ConfigurationSchema, configurationIdentity],
    ["case", CaseSchema, caseDigest],
  ] as const)(
    "a %s digest changes with every hashed leaf and with no excluded leaf (DN-7)",
    async (kind, schema, digestOf) => {
      await fc.assert(
        fc.asyncProperty(arbitraryFor(schema), fc.nat(), async (generated, pick) => {
          const record = schema.parse(generated) as unknown as Json;
          let before: string;
          try {
            before = await digestOf(record);
          } catch {
            fc.pre(false);
            return;
          }
          const paths = leaves(record).filter((p) => p.length > 0 && p[0] !== "schema");
          fc.pre(paths.length > 0);
          const path = paths[pick % paths.length]!;
          const changed = withLeaf(record, path);
          fc.pre(schema.safeParse(changed).success);
          let after: string;
          try {
            after = await digestOf(changed);
          } catch {
            // A changed role or name can duplicate another, which has no identity.
            fc.pre(false);
            return;
          }
          if (excluded(path, kind)) expect(after).toBe(before);
          else expect(after).not.toBe(before);
        }),
        { seed: 20261115, numRuns: 300 },
      );
    },
  );
});
