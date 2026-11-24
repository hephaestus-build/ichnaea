import { toJsonSchema } from "./contracts/json-schema.ts";
import { Json } from "./contracts/primitives.ts";
import { CliDoctor, CliErrorRecord, CliHelp } from "./contracts/records/cli.ts";
import { RECORD_CONTRACTS } from "./contracts/registry.ts";
import { hostAndStore, importModule, type ModuleLoader } from "./core/cli-config.ts";
import { importCommand } from "./core/cli-import.ts";
import { planCommand } from "./core/cli-plan.ts";
import {
  argumentsFor,
  CliError,
  COMMON_OPTIONS,
  type Command,
  type CommandResult,
  CONFIG_OPTION,
  jsonRequested,
} from "./core/command-grammar.ts";
import { decideCommand, reportCommand } from "./core/commands.ts";
import { testMeasure } from "./core/measures.ts";
import { CORE_VERSION } from "./core/version.ts";
import { TRIGGER_VARIES } from "./plan/rules.ts";

export { loadConfig, type ModuleLoader } from "./core/cli-config.ts";

const schemaCommand: Command = {
  name: "schema",
  description: "Print the normative JSON Schema of a record",
  positionals: ["<record>"],
  options: {},
  run(args) {
    const name = args.positionals[0];
    const contract = RECORD_CONTRACTS.find((record) => record.name === name);
    if (!contract)
      throw new CliError(
        "USAGE",
        `unknown record '${name ?? ""}'; one of: ${RECORD_CONTRACTS.map((record) => record.name).join(", ")}`,
      );
    const json = toJsonSchema(contract);
    return { code: 0, text: [JSON.stringify(json, null, 2)], json };
  },
};

const doctorCommand: Command = {
  name: "doctor",
  description:
    "Check the configuration and its measure testers. Exit 1 when there are tester problems.",
  options: { config: CONFIG_OPTION },
  async run(args, load) {
    const { host, directory } = await hostAndStore(args, load);
    let problems = 0;
    const plugins = host.plugins.map((plugin) => `${plugin.id}@${plugin.version}`);
    const text = [`plugins: ${plugins.join(", ") || "none"}`];
    const measures = [];
    for (const measure of host.measures.values()) {
      const id = measure.card.id;
      if (measure.card.computedBy === "application") {
        const tester = measure.card.validation?.tester;
        const status = tester?.status ?? "not recorded";
        text.push(`measure ${id}: computed by the application; tester ${status}`);
        if (status !== "passed" && measure.card.tier === "primary") problems++;
        if (tester?.instrumentPin)
          text.push(`  producer-attested instrument ${tester.instrumentPin}`);
        measures.push({ id, status });
        continue;
      }
      const result = await testMeasure(measure, { directory });
      text.push(`measure ${id}: tester ${result.qualification ?? result.status}`);
      for (const failure of result.failures) text.push(`  ${failure}`);
      if (result.status === "failed") problems++;
      measures.push({ id, status: result.status });
    }
    text.push(problems === 0 ? "doctor: clean" : `doctor: ${problems} problem(s)`);
    return {
      code: problems > 0 ? 1 : 0,
      text,
      json: CliDoctor.parse({ schema: "ichnaea.doctor/1", plugins, measures, problems }),
    };
  },
};

const versionCommand: Command = {
  name: "version",
  description: "Print the version",
  options: {},
  run: () => ({ code: 0, text: [CORE_VERSION], json: CORE_VERSION }),
};

const helpCommand: Command = {
  name: "help",
  description: "Show help",
  positionals: ["<command>"],
  optionalPositionals: 1,
  options: {},
  run(args) {
    const name = args.positionals[0];
    return help(name === undefined ? undefined : findCommand(name));
  },
};

const COMMANDS: readonly Command[] = [
  schemaCommand,
  importCommand,
  decideCommand,
  reportCommand,
  planCommand,
  doctorCommand,
  helpCommand,
  versionCommand,
];

function findCommand(name: string): Command {
  const command = COMMANDS.find((entry) => entry.name === name);
  if (!command)
    throw new CliError(
      "USAGE",
      `unknown command '${name}'; one of: ${COMMANDS.map(({ name: valid }) => valid).join(", ")}. Use 'ichnaea help' for options.`,
    );
  return command;
}

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

function help(command?: Command): CommandResult {
  const commands = (command ? [command] : COMMANDS).map((entry) => ({
    name: entry.name,
    description: entry.description,
    positionals: entry.positionals ?? [],
    optionalPositionals: entry.optionalPositionals ?? 0,
    options: Object.entries({ ...entry.options, ...COMMON_OPTIONS }).map(([name, option]) => ({
      name,
      ...option,
    })),
    ...(entry.together === undefined ? {} : { together: entry.together }),
    ...(entry.worker ? { worker: true } : {}),
  }));
  const found = commands[0];
  const lines =
    command && found
      ? [
          `Usage: ichnaea ${found.name}${found.positionals.map((label) => ` ${label}`).join("")} [options]`,
          "",
          found.description,
          "",
          "Options:",
          ...found.options.map(
            ({ name, type, description, required, multiple, choices }) =>
              `  --${name}${type === "string" ? " <value>" : ""}  ${description}${required ? " (required)" : ""}${multiple ? " (repeatable)" : ""}${choices ? ` [${choices.join(", ")}]` : ""}`,
          ),
        ]
      : [
          "Usage: ichnaea <command> [options]",
          "",
          "Commands:",
          ...commands
            .filter(({ name }) => name !== "version")
            .map(({ name, description }) => `  ${name.padEnd(18)}${description}`),
          "  --version, -v     Print the version",
        ];
  if (command === undefined || command.name === "import") lines.push("", triggerHelp());
  lines.push(
    "",
    "Exit codes: 0 success, 1 a CI policy blocks, 2 an error (usage, configuration or records).",
  );
  return {
    code: 0,
    text: [lines.join("\n")],
    json: CliHelp.parse({
      schema: "ichnaea.help/1",
      commands,
      exitCodes: { success: 0, blocked: 1, error: 2 },
    }),
  };
}

const PUBLIC_ERROR: Readonly<Record<Exclude<CliError["code"], "USAGE">, string>> = {
  CONFIGURATION: "The configuration could not be loaded.",
  RECOMPUTE_MISMATCH: "The decision does not match the stored records.",
  RECORDS: "The stored records could not be read.",
  COMMAND_FAILED: "The command could not complete.",
};

/** Runs one command and writes its result after the handler finishes. */
export async function main(
  argv: readonly string[],
  out: (text: string) => void = (text) => process.stdout.write(`${text}\n`),
  load: ModuleLoader = importModule,
  err: (text: string) => void = (text) => process.stderr.write(`${text}\n`),
): Promise<number> {
  const json = jsonRequested(argv);
  try {
    const globalJson = argv[0] === "--json";
    const [requested, ...rest] = globalJson ? argv.slice(1) : argv;
    if (!requested) throw new CliError("USAGE", help().text.join("\n"));
    const name =
      requested === "-v" || requested === "--version"
        ? "version"
        : requested === "--help"
          ? "help"
          : requested;
    const command = findCommand(name);
    const args = argumentsFor(command, globalJson ? ["--json", ...rest] : rest);
    const result =
      args.values["help"] === true
        ? help(command === helpCommand ? undefined : command)
        : await command.run(args, load);
    if (json) out(JSON.stringify(Json.parse(result.json)));
    else for (const line of result.text) out(line);
    return result.code;
  } catch (cause) {
    const code = cause instanceof CliError ? cause.code : "COMMAND_FAILED";
    const message = cause instanceof Error ? cause.message : String(cause);
    if (json) {
      const error = JSON.stringify(
        CliErrorRecord.parse({
          schema: "ichnaea.cli.error/1",
          code,
          message:
            code === "USAGE"
              ? message
              : ((cause instanceof CliError ? cause.publicMessage : undefined) ??
                PUBLIC_ERROR[code]),
        }),
      );
      out(error);
      err(error);
    } else err(cause instanceof CliError ? message : `error: ${message}`);
    return 2;
  }
}
