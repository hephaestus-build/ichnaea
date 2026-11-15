// Manual mutation testing of the contracts until StrykerJS runs at 1.0 (REQ-112). Each mutant is
// one source change that a test must detect. Run in a scratch copy, never in a working tree:
//   node scripts/mutants.ts            # every mutant
//   node scripts/mutants.ts S10 E1     # selected mutants
// A mutant that survives is a test that cannot fail: kill it, or justify it as equivalent here.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Regenerate schemas and fixtures first, as a schema change would. */
  readonly regen?: boolean;
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: "I5",
    file: "src/identity.ts",
    from: 'projection["models"] = sortedUnique(projection["models"], "role", "model role");',
    to: 'projection["models"] = sortedUnique((projection["models"] as Array<Record<string, unknown>>).map(({ version: _v, route: _r, ...m }) => m), "role", "model role");',
  },
  {
    id: "I13 identity accepts unknown members",
    file: "src/identity.ts",
    from: "  Configuration.parse(input);",
    to: "  Configuration.loose?.();",
  },
  {
    id: "E1",
    file: "src/egress.ts",
    from: 'const value = project(schema, record, "", false);',
    to: 'const value = project(schema, record, "", true);',
  },
  {
    id: "E2",
    file: "src/egress.ts",
    from: "const option = options.find((o) => o.safeParse(value).success);",
    to: "const option = options[0];",
  },
  {
    id: "E3",
    file: "src/egress.ts",
    from: "if (!keyType.safeParse(key).success) {",
    to: "if (false) {",
  },
  {
    id: "E8",
    file: "src/egress.ts",
    from: 'return DATA_CLASSES.includes(declared as DataClass) ? (declared as DataClass) : "special";',
    to: 'return DATA_CLASSES.includes(declared as DataClass) ? (declared as DataClass) : "none";',
  },
  {
    id: "E9",
    file: "src/egress.ts",
    from: "if (value === null) return node.safeParse(null).success && allowed ? null : drop(path);",
    to: "if (value === null) return null;",
  },
  { id: "L3", file: "src/lint.ts", from: '  "lazy",\n];', to: "];" },
  {
    id: "T2",
    file: "src/target-view.ts",
    from: "view.fixtures = structuredClone(record.fixtures);",
    to: "view.fixtures = record.fixtures;",
  },
  {
    id: "T3",
    file: "src/target-view.ts",
    from: "view.turns = structuredClone(record.turns);",
    to: "view.turns = record.turns;",
  },
  {
    id: "S2",
    file: "src/records/case.ts",
    from: "author: personal(Text).optional(),",
    to: "author: none(Text).optional(),",
    regen: true,
  },
  {
    id: "S3",
    file: "src/records/judge.ts",
    from: "perRater: pseudonym(",
    to: "perRater: none(",
    regen: true,
  },
  {
    id: "S4",
    file: "src/records/case.ts",
    from: "references: content(z.record(z.string(), Json)).optional(),",
    to: "references: none(z.record(z.string(), Json)).optional(),",
    regen: true,
  },
  {
    id: "S5",
    file: "src/records/case.ts",
    from: "note: content(z.string()).optional(),",
    to: "note: none(z.string()).optional(),",
    regen: true,
  },
  {
    id: "S7",
    file: "src/records/trial.ts",
    from: "message: content(z.string()).optional()",
    to: "message: none(z.string()).optional()",
    regen: true,
  },
  {
    id: "S8",
    file: "src/primitives.ts",
    from: "export const Real = z.union([z.number(), NonFinite]);",
    to: "export const Real = z.union([z.number()]);",
    regen: true,
  },
  {
    id: "S9",
    file: "src/records/trial.ts",
    from: "case: none(CaseId.nullable()),",
    to: "case: none(CaseId),",
    regen: true,
  },
  {
    id: "S10",
    file: "src/records/case.ts",
    from: "      limits: none(Text),",
    to: "      limits: none(Text).optional(),",
    regen: true,
  },
  {
    id: "S12",
    file: "src/records/configuration.ts",
    from: 'status: none(z.enum(["pinned", "declared"])),',
    to: 'status: none(z.enum(["pinned", "declared", "observed"])),',
    regen: true,
  },
  {
    id: "S13",
    file: "src/records/configuration.ts",
    from: "  value: none(Json),\n  status: none(FactorStatus),\n  part:",
    to: "  value: none(Json),\n  status: none(FactorStatus).optional(),\n  part:",
    regen: true,
  },
  {
    id: "S14",
    file: "src/records/case.ts",
    from: "  created: none(CalendarDate),",
    to: "  created: none(CalendarDate).optional(),",
    regen: true,
  },
  {
    id: "S15",
    file: "src/records/case.ts",
    from: '  exposure: none(z.enum(["public", "private", "sealed"])),',
    to: '  exposure: none(z.enum(["public", "private", "sealed"])).optional(),',
    regen: true,
  },
  {
    id: "S19",
    file: "src/records/run.ts",
    from: 'schema: none(z.literal("ichnaea.run/1")),',
    to: "schema: none(z.string()),",
    regen: true,
  },
  {
    id: "S21 objects not strict",
    file: "src/records/configuration.ts",
    from: "export const ModelBinding = z.strictObject({",
    to: "export const ModelBinding = z.object({",
    regen: true,
  },
  {
    id: "J2 nonFinite widened by readers",
    file: "src/json-schema.ts",
    from: 'out["x-ichnaea-closed"] !== true',
    to: "true",
  },
  // Re-review of 1445f5f: the four survivors, and one mutant per new path.
  {
    id: "N2 reader accepts lone surrogates",
    file: "src/reader.ts",
    from: "  if (hasLoneSurrogate(value)) {",
    to: "  if (false) {",
  },
  {
    id: "N11 grant matches a path prefix",
    file: "src/egress.ts",
    from: 'return a.length === b.length && a.every((segment, i) => segment === "*" || segment === b[i]);',
    to: "return path.startsWith(pattern);",
  },
  {
    id: "N13 a nested writer object is loose",
    file: "src/records/measure.ts",
    from: "  validation: z\n    .strictObject({",
    to: "  validation: z\n    .object({",
    regen: true,
  },
  {
    id: "N17 template and uri enter the identity",
    file: "src/identity.ts",
    from: '(projection["prompts"] as unknown[]).map((p) => pick(p, DIGEST_RULES.prompt.members)),',
    to: 'projection["prompts"],',
  },
  {
    id: "DN6 provenance hashed whole",
    file: "src/identity.ts",
    from: 'projection["provenance"] = pick(projection["provenance"], DIGEST_RULES.provenance.members);',
    to: "",
  },
  {
    id: "DN6 criticality left out",
    file: "src/identity.ts",
    from: '      "criticality",\n',
    to: "",
    regen: true,
  },
  {
    id: "DN7 template not checked",
    file: "src/identity.ts",
    from: "    if (prompt.template === undefined) continue;",
    to: "    continue;",
  },
  {
    id: "DN7 verifyArms skips templates",
    file: "src/identity.ts",
    from: "    errors.push(...(await verifyConfiguration(arm.configuration, `${at}/${i}/configuration`)));",
    to: "",
  },
  {
    id: "m20 digits left as \\d",
    file: "src/json-schema.ts",
    from: 'out += next === "d" ? (inClass ? "0-9" : "[0-9]") : char + next;',
    to: "out += char + next;",
    regen: true,
  },
  {
    id: "m19 seed of 20 digits",
    file: "src/primitives.ts",
    from: "[1-9][0-9]{0,18}",
    to: "[1-9][0-9]{0,19}",
    regen: true,
  },
  {
    id: "R-m3 proportion check off by one",
    file: "src/values.ts",
    from: "value.successes > value.trials",
    to: "value.successes > value.trials + 1",
  },
  {
    id: "R-m4 isKnownKind always true",
    file: "src/reader.ts",
    from: "  return known.includes((value as Record<string, unknown>)[tag] as string);",
    to: "  return true;",
  },
];

const root = join(import.meta.dirname, "..");
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
  if (!original.includes(m.from)) {
    console.log(`${m.id}: anchor not found (update the mutant)`);
    survivors.push(m.id);
    continue;
  }
  writeFileSync(path, original.replace(m.from, m.to));
  try {
    if (m.regen) {
      run("node", ["scripts/generate-schemas.ts"]);
      run("node", ["scripts/write-fixtures.ts"]);
    }
    const killed = !run("pnpm", ["exec", "vitest", "run", "--root", "."]);
    console.log(`${m.id}: ${killed ? "killed" : "SURVIVED"}`);
    if (!killed) survivors.push(m.id);
  } finally {
    writeFileSync(path, original);
    if (m.regen) {
      run("node", ["scripts/generate-schemas.ts"]);
      run("node", ["scripts/write-fixtures.ts"]);
    }
  }
}
console.log(survivors.length === 0 ? "all mutants killed" : `survivors: ${survivors.join(", ")}`);
process.exitCode = survivors.length === 0 ? 0 : 1;
