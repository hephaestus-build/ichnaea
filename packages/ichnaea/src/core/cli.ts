import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { toJsonSchema } from "../contracts/json-schema.ts";
import { Case, CaseSet } from "../contracts/records/case.ts";
import { notComputedReason, Plan, TriggerKind } from "../contracts/records/plan.ts";
import { RECORD_CONTRACTS } from "../contracts/registry.ts";

import { CORE_COMMANDS, createHost, type Host } from "./host.ts";
import { importRun } from "./import.ts";
import { testMeasure } from "./measures.ts";
import { TRIGGER_VARIES } from "./planner.ts";
import type { Config } from "./plugin.ts";
import { runCommandWorker } from "./runner.ts";
import { CORE_VERSION } from "./version.ts";

/** Loads a module by URL. The CLI uses `import()`; a test injects another. */
export type ModuleLoader = (url: string) => Promise<unknown>;

const importModule: ModuleLoader = (url) => import(url);

/** The Node that Ichnaea needs: it runs the `.ts` sources and configuration with type stripping. */
const NODE_WITHOUT_FLAG = "24.3";

/** Loads `ichnaea.config.ts` (or another file) and returns its default export. */
export async function loadConfig(path: string, load: ModuleLoader = importModule): Promise<Config> {
  const url = pathToFileURL(resolve(path)).href;
  let module: { default?: Config };
  try {
    module = (await load(url)) as { default?: Config };
  } catch (error) {
    if (
      (error as { code?: unknown }).code === "ERR_UNKNOWN_FILE_EXTENSION" &&
      extname(path) === ".ts"
    )
      throw new Error(
        `${path} is TypeScript, and this Node (${process.version}) cannot run it: Ichnaea needs Node ${NODE_WITHOUT_FLAG} or later to load a .ts configuration`,
        { cause: error },
      );
    throw error;
  }
  if (!module.default || !Array.isArray(module.default.plugins))
    throw new Error(`${path} must export a configuration (defineConfig) as default`);
  return module.default;
}

const HELP_COMMANDS = `Usage: ichnaea <command> [options]

Commands from the core:
  schema <record>     Print the normative JSON Schema of a record (case, trial, decision, ...)
  import              Import another runner's results into the store (no model calls)
                      --importer <id> --suite <file> --case-set <file> --cases <file.jsonl>
                      --arm <name>:<role>:<configuration.json> (repeat) --file <path> (repeat)
                      --run <id> [--store .ichnaea] [--trigger code] [--seed 1] [--now <ISO time>]
                      [--vary <factor key>] (repeat: what the change varies beyond its trigger)
                      [--concurrency <n> --endpoint <name>] (the schedule the trials ran on)
                      [--aa <run>] (repeat: a decided A/A run to cite, at one trial per case)
  run                 Execute a locked plan through a local command worker
                      --run <id> --plan <file> --case-set <file> --cases <file.jsonl>
                      --worker <executable> [--worker-arg <arg>] (repeat)
                      --deadline <ISO seconds> --monthly-cap <calls> [--attempts 2] [--store .ichnaea]
  doctor              Check the configuration: plugins, measures, testers, warnings
  help                Show this help
  --version, -v       Print the version

Plugins in the configuration add commands (for example decide and report).
Options: --config <file> (default ichnaea.config.ts)`;

/**
 * Each trigger and what its arms may differ in, from `TRIGGER_VARIES`, so the help cannot drift
 * from the rule that `decide` applies.
 */
function triggerHelp(): string {
  const lines = Object.entries(TRIGGER_VARIES).map(([trigger, parts]) => {
    const varies =
      parts === null
        ? "nothing in the system (--vary is refused)"
        : `${parts.length > 0 ? `the ${parts.join(" and ")} part, and ` : ""}what --vary declares`;
    return `  ${trigger.padEnd(22)}${varies}`;
  });
  return `Triggers (--trigger, default code) and what the arms may differ in:\n${lines.join("\n")}`;
}

const HELP = `${HELP_COMMANDS}\n\n${triggerHelp()}\n\nExit codes: 0 success, 1 a CI policy blocks, 2 an error (usage, configuration or records).`;

/**
 * Runs the CLI. Returns the exit code: 0 on success, 1 when a command's policy blocks, 2 on any
 * error, so an error never reads as a policy result.
 */
export async function main(
  argv: readonly string[],
  out: (text: string) => void = (t) => process.stdout.write(`${t}\n`),
  load: ModuleLoader = importModule,
): Promise<number> {
  try {
    return await dispatch(argv, out, load);
  } catch (error) {
    out(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

async function dispatch(
  argv: readonly string[],
  out: (text: string) => void,
  load: ModuleLoader,
): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    out(HELP);
    return command ? 0 : 2;
  }
  if (command === "--version" || command === "-v") {
    out(CORE_VERSION);
    return 0;
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
  // A missing file is a usage error with its own message, before any command is looked up.
  const configFile = resolve(configPath);
  if (
    !(await stat(configFile).then(
      (s) => s.isFile(),
      () => false,
    ))
  ) {
    out(`no ${basename(configFile)} in ${dirname(configFile)}; see the README's quick start`);
    return 2;
  }
  let host: Host;
  try {
    host = createHost(
      await loadConfig(configPath, load),
      // The contracts ship in the same package as the core, at its version.
      { core: CORE_VERSION, contracts: CORE_VERSION },
      (m) => out(`warning: ${m}`),
    );
    await host.configResolved();
  } catch (error) {
    out(`configuration error: ${(error as Error).message}`);
    return 2;
  }
  if (command === "doctor") return doctor(host, out);
  if (command === "import") return importCommand(host, rest, out);
  if (command === "run") return runWorkerCommand(host, rest, out);
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
      concurrency: { type: "string" },
      endpoint: { type: "string" },
      aa: { type: "string", multiple: true },
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
  if ((values.concurrency === undefined) !== (values.endpoint === undefined)) {
    out(
      "import: --concurrency and --endpoint go together: they state the schedule the trials ran on",
    );
    return 2;
  }
  if (values.concurrency !== undefined && !/^[1-9][0-9]{0,5}$/.test(values.concurrency)) {
    out("import: --concurrency must be a whole number from 1");
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
    ...(values.concurrency === undefined || values.endpoint === undefined
      ? {}
      : { schedule: { concurrency: Number(values.concurrency), endpoint: values.endpoint } }),
    aa: values.aa ?? [],
    seed: Number(seed),
    now: values.now ?? new Date().toISOString(),
    ichnaea: CORE_VERSION,
  });
  out(
    `import: run ${values.run as string}: ${result.trials} trials, ${result.values} values, plan ${result.plan.mode}`,
  );
  for (const reason of result.plan.modeReasons) out(`  estimate-only: ${reason}`);
  // The planning power statement (REQ-54): what a run of this plan can detect at best. A plugin
  // computes it (the decision plugin does); without one, the plan has none, and the line says so.
  const reach = (decidable: boolean): string =>
    !decidable
      ? "cannot decide"
      : result.plan.mode === "decision"
        ? "can decide"
        : "within reach of the margin, but the plan is estimate-only";
  for (const p of result.plan.power)
    out(
      p.computed
        ? `  power: ${p.measure}: smallest detectable drop ${(p.mde * 100).toFixed(1)} points (${p.assumption}), margin ${(p.margin * 100).toFixed(1)} points, ${reach(p.decidable)}`
        : `  power: ${p.measure}: not computed (${notComputedReason(p)})`,
    );
  if (result.plan.power.length === 0 && result.plan.primary.length > 0)
    out("  power: not computed: no plugin in the configuration states one (decidePlugin() does)");
  return 0;
}

async function runWorkerCommand(
  host: Host,
  args: readonly string[],
  out: (line: string) => void,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      config: { type: "string" },
      run: { type: "string" },
      plan: { type: "string" },
      "case-set": { type: "string" },
      cases: { type: "string" },
      worker: { type: "string" },
      "worker-arg": { type: "string", multiple: true },
      deadline: { type: "string" },
      "monthly-cap": { type: "string" },
      attempts: { type: "string", default: "2" },
      store: { type: "string", default: ".ichnaea" },
    },
  });
  const { run, plan, cases, worker, deadline, store } = values;
  if (
    !run ||
    !plan ||
    !values["case-set"] ||
    !cases ||
    !worker ||
    !deadline ||
    !/^[0-9]+$/.test(values["monthly-cap"] ?? "") ||
    !/^[0-9]+$/.test(values.attempts)
  )
    throw new Error(
      "run needs --run, --plan, --case-set, --cases, --worker, --deadline and --monthly-cap",
    );
  const [planText, manifestText, caseText] = await Promise.all([
    readFile(plan, "utf8"),
    readFile(values["case-set"], "utf8"),
    readFile(cases, "utf8"),
  ]);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const result = await runCommandWorker({
      host,
      store,
      run,
      plan: Plan.parse(JSON.parse(planText)),
      caseSet: CaseSet.parse(JSON.parse(manifestText)),
      cases: caseText
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => Case.parse(JSON.parse(line))),
      command: [worker, ...(values["worker-arg"] ?? [])],
      deadline,
      monthlyCap: Number(values["monthly-cap"]),
      maxAttempts: Number(values.attempts),
      signal: controller.signal,
      ichnaea: CORE_VERSION,
    });
    if (result.workerError) out(`run: ${result.workerError}`);
    out(`run: stored ${result.trials} trial(s) and ${result.values} measure value(s)`);
    return result.interrupted || result.workerError ? 2 : 0;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
