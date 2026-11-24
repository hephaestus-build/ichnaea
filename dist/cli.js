import { toJsonSchema } from "./contracts/json-schema.js";
import { Json } from "./contracts/primitives.js";
import { CliDoctor, CliErrorRecord, CliHelp } from "./contracts/records/cli.js";
import { RECORD_CONTRACTS } from "./contracts/registry.js";
import { hostAndStore, importModule } from "./core/cli-config.js";
import { importCommand } from "./core/cli-import.js";
import { planCommand } from "./core/cli-plan.js";
import { argumentsFor, CliError, COMMON_OPTIONS, CONFIG_OPTION, jsonRequested, } from "./core/command-grammar.js";
import { decideCommand, reportCommand } from "./core/commands.js";
import { testMeasure } from "./core/measures.js";
import { CORE_VERSION } from "./core/version.js";
import { TRIGGER_VARIES } from "./plan/rules.js";
export { loadConfig } from "./core/cli-config.js";
const schemaCommand = {
    name: "schema",
    description: "Print the normative JSON Schema of a record",
    positionals: ["<record>"],
    options: {},
    run(args) {
        const name = args.positionals[0];
        const contract = RECORD_CONTRACTS.find((record) => record.name === name);
        if (!contract)
            throw new CliError("USAGE", `unknown record '${name ?? ""}'; one of: ${RECORD_CONTRACTS.map((record) => record.name).join(", ")}`);
        const json = toJsonSchema(contract);
        return { code: 0, text: [JSON.stringify(json, null, 2)], json };
    },
};
const doctorCommand = {
    name: "doctor",
    description: "Check the configuration and its measure testers. Exit 1 when there are tester problems.",
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
                if (status !== "passed" && measure.card.tier === "primary")
                    problems++;
                if (tester?.instrumentPin)
                    text.push(`  producer-attested instrument ${tester.instrumentPin}`);
                measures.push({ id, status });
                continue;
            }
            const result = await testMeasure(measure, { directory });
            text.push(`measure ${id}: tester ${result.qualification ?? result.status}`);
            for (const failure of result.failures)
                text.push(`  ${failure}`);
            if (result.status === "failed")
                problems++;
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
const versionCommand = {
    name: "version",
    description: "Print the version",
    options: {},
    run: () => ({ code: 0, text: [CORE_VERSION], json: CORE_VERSION }),
};
const helpCommand = {
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
const COMMANDS = [
    schemaCommand,
    importCommand,
    decideCommand,
    reportCommand,
    planCommand,
    doctorCommand,
    helpCommand,
    versionCommand,
];
function findCommand(name) {
    const command = COMMANDS.find((entry) => entry.name === name);
    if (!command)
        throw new CliError("USAGE", `unknown command '${name}'; one of: ${COMMANDS.map(({ name: valid }) => valid).join(", ")}. Use 'ichnaea help' for options.`);
    return command;
}
function triggerHelp() {
    const lines = Object.entries(TRIGGER_VARIES).map(([trigger, parts]) => {
        const varies = parts === null
            ? "nothing in the system (--vary is refused)"
            : `${parts.length > 0 ? `the ${parts.join(" and ")} part, and ` : ""}what --vary declares`;
        return `  ${trigger.padEnd(22)}${varies}`;
    });
    return `Triggers (--trigger, default code) and what the arms may differ in:\n${lines.join("\n")}`;
}
function help(command) {
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
    const lines = command && found
        ? [
            `Usage: ichnaea ${found.name}${found.positionals.map((label) => ` ${label}`).join("")} [options]`,
            "",
            found.description,
            "",
            "Options:",
            ...found.options.map(({ name, type, description, required, multiple, choices }) => `  --${name}${type === "string" ? " <value>" : ""}  ${description}${required ? " (required)" : ""}${multiple ? " (repeatable)" : ""}${choices ? ` [${choices.join(", ")}]` : ""}`),
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
    if (command === undefined || command.name === "import")
        lines.push("", triggerHelp());
    lines.push("", "Exit codes: 0 success, 1 a CI policy blocks, 2 an error (usage, configuration or records).");
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
const PUBLIC_ERROR = {
    CONFIGURATION: "The configuration could not be loaded.",
    RECOMPUTE_MISMATCH: "The decision does not match the stored records.",
    RECORDS: "The stored records could not be read.",
    COMMAND_FAILED: "The command could not complete.",
};
/** Runs one command and writes its result after the handler finishes. */
export async function main(argv, out = (text) => process.stdout.write(`${text}\n`), load = importModule, err = (text) => process.stderr.write(`${text}\n`)) {
    const json = jsonRequested(argv);
    try {
        const globalJson = argv[0] === "--json";
        const [requested, ...rest] = globalJson ? argv.slice(1) : argv;
        if (!requested)
            throw new CliError("USAGE", help().text.join("\n"));
        const name = requested === "-v" || requested === "--version"
            ? "version"
            : requested === "--help"
                ? "help"
                : requested;
        const command = findCommand(name);
        const args = argumentsFor(command, globalJson ? ["--json", ...rest] : rest);
        const result = args.values["help"] === true
            ? help(command === helpCommand ? undefined : command)
            : await command.run(args, load);
        if (json)
            out(JSON.stringify(Json.parse(result.json)));
        else
            for (const line of result.text)
                out(line);
        return result.code;
    }
    catch (cause) {
        const code = cause instanceof CliError ? cause.code : "COMMAND_FAILED";
        const message = cause instanceof Error ? cause.message : String(cause);
        if (json) {
            const error = JSON.stringify(CliErrorRecord.parse({
                schema: "ichnaea.cli.error/1",
                code,
                message: code === "USAGE"
                    ? message
                    : ((cause instanceof CliError ? cause.publicMessage : undefined) ??
                        PUBLIC_ERROR[code]),
            }));
            out(error);
            err(error);
        }
        else
            err(cause instanceof CliError ? message : `error: ${message}`);
        return 2;
    }
}
//# sourceMappingURL=cli.js.map