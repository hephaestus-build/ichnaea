import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { RECORD_CONTRACTS, toJsonSchema, TriggerKind } from "@hephaestus-build/ichnaea-contracts";

import { CORE_COMMANDS, createHost, type Host } from "./host.ts";
import { importRun } from "./import.ts";
import { testMeasure } from "./measures.ts";
import type { Config } from "./plugin.ts";
import { CORE_VERSION } from "./version.ts";

/** Loads `ichnaea.config.ts` (or another file) and returns its default export. */
export async function loadConfig(path: string): Promise<Config> {
  const url = pathToFileURL(resolve(path)).href;
  const module = (await import(url)) as { default?: Config };
  if (!module.default || !Array.isArray(module.default.plugins))
    throw new Error(`${path} must export a configuration (defineConfig) as default`);
  return module.default;
}

async function contractsVersion(): Promise<string> {
  const url = import.meta.resolve("@hephaestus-build/ichnaea-contracts/package.json");
  return (JSON.parse(await readFile(new URL(url), "utf8")) as { version: string }).version;
}

const HELP = `Usage: ichnaea <command> [options]

Commands from the core:
  schema <record>     Print the normative JSON Schema of a record (case, trial, decision, ...)
  import              Import another runner's results into the store (no model calls)
                      --importer <id> --suite <file> --case-set <file> --cases <file.jsonl>
                      --arm <name>:<role>:<configuration.json> (repeat) --file <path> (repeat)
                      --run <id> [--store .ichnaea] [--trigger code] [--seed 1] [--now <ISO time>]
                      [--vary <factor key>] (repeat: what the change varies beyond its trigger)
  doctor              Check the configuration: plugins, measures, testers, warnings
  help                Show this help

Plugins in the configuration add commands (for example decide and report).
Options: --config <file> (default ichnaea.config.ts)
Exit codes: 0 success, 1 a CI policy blocks, 2 an error (usage, configuration or records).`;

/**
 * Runs the CLI. Returns the exit code: 0 on success, 1 when a command's policy blocks, 2 on any
 * error, so an error never reads as a policy result.
 */
export async function main(
  argv: readonly string[],
  out: (text: string) => void = (t) => process.stdout.write(`${t}\n`),
): Promise<number> {
  try {
    return await dispatch(argv, out);
  } catch (error) {
    out(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

async function dispatch(argv: readonly string[], out: (text: string) => void): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    out(HELP);
    return command ? 0 : 2;
  }
  if (command === "schema") {
    const name = rest[0];
    const contract = RECORD_CONTRACTS.find((c) => c.name === name);
    if (!contract) {
      out(
        `unknown record '${name ?? ""}'; one of: ${RECORD_CONTRACTS.map((c) => c.name).join(", ")}`,
      );
      return 2;
    }
    out(JSON.stringify(toJsonSchema(contract), null, 2));
    return 0;
  }
  const configPath =
    (parseArgs({ args: [...rest], options: { config: { type: "string" } }, strict: false }).values[
      "config"
    ] as string | undefined) ?? "ichnaea.config.ts";
  let host: Host;
  try {
    host = createHost(
      await loadConfig(configPath),
      { core: CORE_VERSION, contracts: await contractsVersion() },
      (m) => out(`warning: ${m}`),
    );
    await host.configResolved();
  } catch (error) {
    out(`configuration error: ${(error as Error).message}`);
    return 2;
  }
  if (command === "doctor") return doctor(host, out);
  if (command === "import") return importCommand(host, rest, out);
  const definition = host.commands.get(command);
  if (!definition) {
    out(
      `unknown command '${command}'. Commands: ${[...CORE_COMMANDS, ...host.commands.keys()].join(", ")}`,
    );
    return 2;
  }
  const options = {
    config: { type: "string" as const },
    ...Object.fromEntries(
      Object.entries(definition.options).map(([k, o]) => [
        k,
        { type: o.type, ...(o.multiple ? { multiple: true } : {}) },
      ]),
    ),
  };
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: [...rest], options, allowPositionals: true, strict: true });
  } catch (error) {
    out(`${command}: ${(error as Error).message}`);
    return 2;
  }
  return definition.run(
    { values: parsed.values, positionals: parsed.positionals },
    { measures: host.measures, importers: host.importers, gates: host.gates, hooks: host, out },
  );
}

async function doctor(host: Host, out: (text: string) => void): Promise<number> {
  let problems = 0;
  out(
    `plugins: ${host.plugins.map((p) => `${p.id}@${p.version} (${p.stability})`).join(", ") || "none"}`,
  );
  for (const warning of host.warnings) out(`warning: ${warning}`);
  for (const measure of host.measures.values()) {
    if (measure.card.computedBy === "application") {
      const status = measure.card.validation?.tester?.status;
      out(
        `measure ${measure.card.id}: computed by the application; tester ${status ?? "not recorded"}`,
      );
      if (status !== "passed" && measure.card.tier === "primary") problems++;
      continue;
    }
    const result = await testMeasure(measure);
    out(`measure ${measure.card.id}: tester ${result.status}`);
    for (const failure of result.failures) out(`  ${failure}`);
    if (result.status === "failed") problems++;
  }
  out(problems === 0 ? "doctor: clean" : `doctor: ${problems} problem(s)`);
  return problems === 0 ? 0 : 1;
}

async function importCommand(
  host: Host,
  args: readonly string[],
  out: (text: string) => void,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    options: {
      config: { type: "string" },
      importer: { type: "string" },
      suite: { type: "string" },
      "case-set": { type: "string" },
      cases: { type: "string" },
      arm: { type: "string", multiple: true },
      file: { type: "string", multiple: true },
      run: { type: "string" },
      store: { type: "string" },
      trigger: { type: "string" },
      vary: { type: "string", multiple: true },
      seed: { type: "string" },
      now: { type: "string" },
    },
  });
  const required = ["importer", "suite", "case-set", "cases", "run"] as const;
  const missing = required.filter((k) => values[k] === undefined);
  if (missing.length > 0 || !values.arm?.length) {
    out(
      `import: missing ${[...missing.map((m) => `--${m}`), ...(values.arm?.length ? [] : ["--arm"])].join(", ")}`,
    );
    return 2;
  }
  const trigger = TriggerKind.safeParse(values.trigger ?? "code");
  if (!trigger.success) {
    out(`import: --trigger must be one of ${TriggerKind.options.join(", ")}`);
    return 2;
  }
  const seed = values.seed ?? "1";
  if (!/^(0|[1-9][0-9]{0,8})$/.test(seed)) {
    out("import: --seed must be a non-negative integer below 10^9");
    return 2;
  }
  const arms = [];
  for (const spec of values.arm) {
    const [name, role, ...path] = spec.split(":");
    if (!name || !role || path.length === 0 || !["base", "candidate", "reference"].includes(role)) {
      out(`import: --arm '${spec}' is not <name>:<role>:<file>`);
      return 2;
    }
    arms.push({
      name,
      role: role as "base" | "candidate" | "reference",
      configuration: path.join(":"),
    });
  }
  const result = await importRun({
    host,
    store: values.store ?? ".ichnaea",
    run: values.run as string,
    importer: values.importer as string,
    suite: values.suite as string,
    caseSet: values["case-set"] as string,
    cases: values.cases as string,
    arms,
    files: values.file ?? [],
    trigger: trigger.data,
    varies: values.vary ?? [],
    seed: Number(seed),
    now: values.now ?? new Date().toISOString(),
    ichnaea: CORE_VERSION,
  });
  out(
    `import: run ${values.run as string}: ${result.trials} trials, ${result.values} values, plan ${result.plan.mode}`,
  );
  for (const reason of result.plan.modeReasons) out(`  estimate-only: ${reason}`);
  // The planning power statement (REQ-54): what a run of this plan can detect at best.
  for (const p of result.plan.power)
    out(
      p.computed
        ? `  power: ${p.measure}: smallest detectable drop ${(p.mde * 100).toFixed(1)} points (${p.assumption}), margin ${(p.margin * 100).toFixed(1)} points, ${p.decidable ? "can decide" : "cannot decide"}`
        : `  power: ${p.measure}: not computed (${p.reason})`,
    );
  return 0;
}
