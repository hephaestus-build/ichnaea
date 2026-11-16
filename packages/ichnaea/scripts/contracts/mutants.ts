// Manual mutation testing of the contracts until StrykerJS runs at 1.0 (REQ-112). Each mutant is
// one source change that a test must detect. Run in a scratch copy, never in a working tree:
//   node scripts/contracts/mutants.ts            # every mutant
//   node scripts/contracts/mutants.ts S10 E1     # selected mutants
// A mutant that survives is a test that cannot fail: kill it, or justify it as equivalent here.
// `test/contracts/mutants.test.ts` checks that every anchor still occurs exactly once, so a refactor that
// moves one fails the test run instead of leaving a mutant that silently tests nothing.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Regenerate schemas and fixtures first, as a schema change would. */
  readonly regen?: boolean;
  /** More edits of the same file, applied after the first. */
  readonly also?: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/**
 * A digest rule that drops a provenance member: the member leaves `members` and enters `excluded`,
 * so the rule still lists every member and the regenerated rule file agrees with it. Only a
 * behaviour test, or the committed vectors, can notice.
 */
const provenanceMemberDropped = (name: string): Mutant => ({
  id: `provenance.${name} left out of the case digest`,
  file: "src/contracts/identity.ts",
  from: `      "${name}",\n`,
  to: "",
  also: [
    {
      from: "    excluded: {\n      author:",
      to: `    excluded: {\n      ${name}: "moved out of the digest by a mutant.",\n      author:`,
    },
  ],
  regen: true,
});

/** Every edit of a mutant, in order. */
export const editsOf = (m: Mutant): ReadonlyArray<{ from: string; to: string }> => [
  { from: m.from, to: m.to },
  ...(m.also ?? []),
];

/** The text of a file after a mutant's edits, or the edit whose anchor is missing. */
export function mutate(original: string, m: Mutant): { text: string } | { missing: string } {
  let text = original;
  for (const { from, to } of editsOf(m)) {
    if (!text.includes(from)) return { missing: from };
    text = text.replace(from, () => to);
  }
  return { text };
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: "I5",
    file: "src/contracts/identity.ts",
    from: 'projection["models"] = sortedUnique(projection["models"], "role", "model role");',
    to: 'projection["models"] = sortedUnique((projection["models"] as Array<Record<string, unknown>>).map(({ version: _v, route: _r, ...m }) => m), "role", "model role");',
  },
  {
    id: "I13 identity accepts unknown members",
    file: "src/contracts/identity.ts",
    from: "const config = Configuration.parse(input);",
    to: "const config = (input as typeof Configuration._output);",
  },
  {
    id: "E1",
    file: "src/contracts/egress.ts",
    from: 'const value = project(schema, record, "", false);',
    to: 'const value = project(schema, record, "", true);',
  },
  {
    id: "E2",
    file: "src/contracts/egress.ts",
    from: "const option = options.find((o) => o.safeParse(value).success);",
    to: "const option = options[0];",
  },
  {
    id: "E3",
    file: "src/contracts/egress.ts",
    from: "if (!keyType.safeParse(key).success) {",
    to: "if (false) {",
  },
  {
    id: "E8",
    file: "src/contracts/egress.ts",
    from: 'return DATA_CLASSES.includes(declared as DataClass) ? (declared as DataClass) : "special";',
    to: 'return DATA_CLASSES.includes(declared as DataClass) ? (declared as DataClass) : "none";',
  },
  {
    id: "E9",
    file: "src/contracts/egress.ts",
    from: "if (value === null) return node.safeParse(null).success && allowed ? null : drop(path);",
    to: "if (value === null) return null;",
  },
  { id: "L3", file: "src/contracts/lint.ts", from: '  "lazy",\n];', to: "];" },
  {
    id: "T2",
    file: "src/contracts/target-view.ts",
    from: "view.fixtures = structuredClone(record.fixtures);",
    to: "view.fixtures = record.fixtures;",
  },
  {
    id: "T3",
    file: "src/contracts/target-view.ts",
    from: "view.turns = structuredClone(record.turns);",
    to: "view.turns = record.turns;",
  },
  {
    id: "S2",
    file: "src/contracts/records/case.ts",
    from: 'author: personal(Text.describe("Who wrote the case.")).optional(),',
    to: 'author: none(Text.describe("Who wrote the case.")).optional(),',
    regen: true,
  },
  {
    id: "S3",
    file: "src/contracts/records/judge.ts",
    from: "perRater: pseudonym(",
    to: "perRater: none(",
    regen: true,
  },
  {
    id: "S4",
    file: "src/contracts/records/case.ts",
    from: "  references: content(\n    z\n      .record(z.string(), Json)",
    to: "  references: none(\n    z\n      .record(z.string(), Json)",
    regen: true,
  },
  {
    id: "S5",
    file: "src/contracts/records/case.ts",
    from: 'note: content(z.string().describe("A reviewer\'s note on the case.")).optional(),',
    to: 'note: none(z.string().describe("A reviewer\'s note on the case.")).optional(),',
    regen: true,
  },
  {
    id: "S7",
    file: "src/contracts/records/trial.ts",
    from: "message: content(z.string()).optional()",
    to: "message: none(z.string()).optional()",
    regen: true,
  },
  {
    id: "S8",
    file: "src/contracts/primitives.ts",
    from: "export const Real = z.union([z.number(), NonFinite]);",
    to: "export const Real = z.union([z.number()]);",
    regen: true,
  },
  {
    id: "S9",
    file: "src/contracts/records/trial.ts",
    from: "case: none(CaseId.nullable()),",
    to: "case: none(CaseId),",
    regen: true,
  },
  {
    id: "S10",
    file: "src/contracts/records/case.ts",
    from: '      limits: none(Text.describe("The known limits of the dataset for this use.")),',
    to: '      limits: none(Text.describe("The known limits of the dataset for this use.")).optional(),',
    regen: true,
  },
  {
    id: "S12",
    file: "src/contracts/records/configuration.ts",
    from: 'z.enum(["pinned", "declared"]).describe("Whether the value is pinned or only declared."),',
    to: 'z.enum(["pinned", "declared", "observed"]).describe("Whether the value is pinned or only declared."),',
    regen: true,
  },
  {
    id: "S13",
    file: "src/contracts/records/configuration.ts",
    from: '  value: none(Json),\n  status: none(\n    FactorStatus.describe(\n      "The control status of the value: pinned, observed, declared or uncontrollable.",\n    ),\n  ),\n  part:',
    to: '  value: none(Json),\n  status: none(\n    FactorStatus.describe(\n      "The control status of the value: pinned, observed, declared or uncontrollable.",\n    ),\n  ).optional(),\n  part:',
    regen: true,
  },
  {
    id: "S14",
    file: "src/contracts/records/case.ts",
    from: '  created: none(CalendarDate.describe("The date the case was created.")),',
    to: '  created: none(CalendarDate.describe("The date the case was created.")).optional(),',
    regen: true,
  },
  {
    id: "S15",
    file: "src/contracts/records/case.ts",
    from: '  exposure: none(z.enum(["public", "private", "sealed"]).describe("Who may see the case.")),',
    to: '  exposure: none(z.enum(["public", "private", "sealed"]).describe("Who may see the case.")).optional(),',
    regen: true,
  },
  {
    id: "S19",
    file: "src/contracts/records/run.ts",
    from: 'schema: none(z.literal("ichnaea.run/1")),',
    to: "schema: none(z.string()),",
    regen: true,
  },
  {
    id: "S21 objects not strict",
    file: "src/contracts/records/configuration.ts",
    from: "export const ModelBinding = z.strictObject({",
    to: "export const ModelBinding = z.object({",
    regen: true,
  },
  {
    id: "nonFinite widened by readers",
    file: "src/contracts/json-schema.ts",
    from: 'out["x-ichnaea-closed"] !== true',
    to: "true",
  },
  {
    id: "reader accepts lone surrogates",
    file: "src/contracts/reader.ts",
    from: "  if (hasLoneSurrogate(value)) {",
    to: "  if (false) {",
  },
  {
    id: "grant matches a path prefix",
    file: "src/contracts/egress.ts",
    from: 'return a.length === b.length && a.every((segment, i) => segment === "*" || segment === b[i]);',
    to: "return path.startsWith(pattern);",
  },
  {
    id: "a nested writer object is loose",
    file: "src/contracts/records/measure.ts",
    from: "  validation: z\n    .strictObject({",
    to: "  validation: z\n    .object({",
    regen: true,
  },
  {
    id: "template and uri enter the identity",
    file: "src/contracts/identity.ts",
    from: '(projection["prompts"] as unknown[]).map((p) => pick(p, DIGEST_RULES.prompt.members)),',
    to: 'projection["prompts"],',
  },
  {
    id: "provenance hashed whole",
    file: "src/contracts/identity.ts",
    from: 'projection["provenance"] = pick(projection["provenance"], DIGEST_RULES.provenance.members);',
    to: "",
  },
  {
    id: "criticality left out of the case digest",
    file: "src/contracts/identity.ts",
    from: '      "criticality",\n',
    to: "",
    regen: true,
  },
  {
    id: "template not checked",
    file: "src/contracts/identity.ts",
    from: "    if (prompt.template === undefined) continue;",
    to: "    continue;",
  },
  {
    id: "verifyArms skips template errors",
    file: "src/contracts/identity.ts",
    from: "    errors.push(...templates);",
    to: "",
  },
  {
    id: "identity of a contradicting template",
    file: "src/contracts/identity.ts",
    from: "  if (mismatch) {\n",
    to: "  if (false) {\n",
  },
  {
    id: "digits left as \\d",
    file: "src/contracts/json-schema.ts",
    from: 'out += next === "d" ? (inClass ? "0-9" : "[0-9]") : char + next;',
    to: "out += char + next;",
    regen: true,
  },
  {
    id: "seed bound one above 2^64 - 1",
    file: "src/contracts/primitives.ts",
    from: 'const SEED_MAX = "18446744073709551615";',
    to: 'const SEED_MAX = "18446744073709551616";',
    regen: true,
  },
  {
    id: "seed bound itself refused",
    file: "src/contracts/primitives.ts",
    from: "  alternatives.push(max);",
    to: "",
    regen: true,
  },
  {
    id: "seed accepts a leading zero",
    file: "src/contracts/primitives.ts",
    from: "const smallest = i === 0 ? 1 : 0;",
    to: "const smallest = 0;",
    regen: true,
  },
  {
    id: "seed of 19 digits refused",
    file: "src/contracts/primitives.ts",
    from: "[1-9][0-9]{0,${max.length - 2}}",
    to: "[1-9][0-9]{0,${max.length - 3}}",
    regen: true,
  },
  {
    id: "proportion check off by one",
    file: "src/contracts/values.ts",
    from: "value.successes > value.trials",
    to: "value.successes > value.trials + 1",
  },
  {
    id: "isKnownKind always true",
    file: "src/contracts/reader.ts",
    from: "  return known.includes((value as Record<string, unknown>)[tag] as string);",
    to: "  return true;",
  },
  // The digest rules: every ruled member, in and out.
  provenanceMemberDropped("source"),
  provenanceMemberDropped("selection"),
  provenanceMemberDropped("created"),
  provenanceMemberDropped("collected"),
  provenanceMemberDropped("licence"),
  provenanceMemberDropped("exposure"),
  provenanceMemberDropped("generator"),
  provenanceMemberDropped("reusedDataset"),
  provenanceMemberDropped("finding"),
  {
    id: "author enters the case digest",
    file: "src/contracts/identity.ts",
    from: '      "finding",\n    ],\n    excluded: {\n      author: "A pointer to a person, erased with them. Erasing it keeps the case\'s digest.",\n    },',
    to: '      "finding",\n      "author",\n    ],\n    excluded: {},',
    regen: true,
  },
  {
    id: "case set pointer enters the case digest",
    file: "src/contracts/identity.ts",
    from: '    members: [\n      "unit",',
    to: '    members: [\n      "caseSet",\n      "unit",',
    also: [
      {
        from: '      caseSet:\n        "A pointer to the set that holds the case. The same case in another set, or in a renamed set, keeps its digest, so a case is traced by its digest across sets. The set\'s own digest covers its membership.",\n',
        to: "",
      },
    ],
    regen: true,
  },
  {
    id: "case ID enters the case digest",
    file: "src/contracts/identity.ts",
    from: '    members: [\n      "unit",',
    to: '    members: [\n      "id",\n      "unit",',
    also: [
      {
        from: '      id: "Where the case sits in its set. A case copied under a new ID keeps its digest, so a screened case cannot pass as new; the set entry hashes the ID.",\n',
        to: "",
      },
    ],
    regen: true,
  },
  {
    id: "pool enters the case digest",
    file: "src/contracts/identity.ts",
    from: '      "provenance",\n    ],',
    to: '      "provenance",\n      "pool",\n    ],',
    also: [
      {
        from: '      pool: "Where the case sits in its set. Moving a screened case into another pool keeps its digest; the set entry hashes the pool.",\n',
        to: "",
      },
    ],
    regen: true,
  },
  {
    id: "review status enters the case digest",
    file: "src/contracts/identity.ts",
    from: '      "provenance",\n    ],',
    to: '      "provenance",\n      "validation",\n    ],',
    also: [
      {
        from: '      validation: "The review status. Reviewing a case does not change what it asks or grades.",\n',
        to: "",
      },
    ],
    regen: true,
  },
  {
    id: "prompt status left out of the identity",
    file: "src/contracts/identity.ts",
    from: 'members: ["name", "digest", "status"],',
    to: 'members: ["name", "digest"],',
    also: [
      {
        from: "    excluded: {\n      template:",
        to: '    excluded: {\n      status: "a mutant moved it out.",\n      template:',
      },
    ],
    regen: true,
  },
  {
    id: "template digest of the trimmed text",
    file: "src/contracts/identity.ts",
    from: "const computed = await sha256(prompt.template);",
    to: "const computed = await sha256(prompt.template.trim());",
  },
  {
    id: "template with a lone surrogate not reported",
    file: "src/contracts/identity.ts",
    from: "    if (!prompt.template.isWellFormed()) {",
    to: "    if (false) {",
  },
  {
    id: "sha256 hashes a lone surrogate as U+FFFD",
    file: "src/contracts/canonical.ts",
    from: '  if (!text.isWellFormed())\n    throw new TypeError("cannot hash a string with a lone surrogate: it has no UTF-8 form");',
    to: "",
  },
  {
    id: "verifyArms throws on a bad arm",
    file: "src/contracts/identity.ts",
    from: "      if (!(error instanceof IdentityError || error instanceof z.ZodError)) throw error;",
    to: "      throw error;",
  },
];

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..");
  const wanted = process.argv.slice(2);
  const run = (cmd: string, args: string[]): boolean => {
    try {
      execFileSync(cmd, args, { cwd: root, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  const survivors: string[] = [];
  for (const m of MUTANTS.filter(
    (x) => wanted.length === 0 || wanted.some((w) => x.id.startsWith(w)),
  )) {
    const path = join(root, m.file);
    const original = readFileSync(path, "utf8");
    const mutated = mutate(original, m);
    if ("missing" in mutated) {
      console.log(`${m.id}: anchor not found (update the mutant)`);
      survivors.push(m.id);
      continue;
    }
    writeFileSync(path, mutated.text);
    try {
      if (m.regen) {
        run("node", ["scripts/contracts/generate-schemas.ts"]);
        run("node", ["scripts/contracts/write-fixtures.ts"]);
      }
      const killed = !run("pnpm", ["exec", "vitest", "run", "--project", "contracts"]);
      console.log(`${m.id}: ${killed ? "killed" : "SURVIVED"}`);
      if (!killed) survivors.push(m.id);
    } finally {
      writeFileSync(path, original);
      if (m.regen) {
        run("node", ["scripts/contracts/generate-schemas.ts"]);
        run("node", ["scripts/contracts/write-fixtures.ts"]);
      }
    }
  }
  console.log(survivors.length === 0 ? "all mutants killed" : `survivors: ${survivors.join(", ")}`);
  process.exitCode = survivors.length === 0 ? 0 : 1;
}
