// The parts that the project config and the suite share: names, durations, environment entries,
// commands, case sources, workers, endpoints and limits. Every value is authored configuration
// about no person, so every leaf is class none.
import * as z from "zod";

import { none } from "../data-class.ts";
import { Digest, Probability, Text } from "../primitives.ts";

/**
 * A name that the project config or a suite gives to a worker, a dataset, an endpoint, a measure,
 * an instrument, a stage, a profile or a sink, for example `eu-llm` or `quality-judge`.
 */
export const ConfigName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
/** A name in the project config or a suite. */
export type ConfigName = z.infer<typeof ConfigName>;

/** The name of an environment variable, for example `LLM_API_KEY`. */
export const EnvName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,199}$/);

/** A value that Ichnaea reads from an environment variable when it uses it, and never stores. */
export const FromEnv = z.strictObject({
  fromEnv: none(EnvName.describe("The environment variable that holds the value.")),
});

const TIME = "T(?:[0-9]+H(?:[0-9]+M)?(?:[0-9]+S)?|[0-9]+M(?:[0-9]+S)?|[0-9]+S)";
const DATE = "(?:[0-9]+Y(?:[0-9]+M)?(?:[0-9]+D)?|[0-9]+M(?:[0-9]+D)?|[0-9]+D)";

/**
 * An ISO 8601 duration in years, months, days, hours, minutes and whole seconds, such as `P7D`,
 * `PT10M` or `P3Y`. It has at least one part, and a `T` is followed by a time part.
 */
export const Duration = z.string().regex(new RegExp(`^P(?:${DATE}(?:${TIME})?|${TIME})$`));

/** A full git commit: 40 hexadecimal digits (SHA-1), or 64 (SHA-256). Never a branch or a tag. */
export const CommitSha = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);

/**
 * Known token formats, each at the start of a word: GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`,
 * `github_pat_`), GitLab (`glpat-`), Slack (`xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxs-`), Hugging
 * Face (`hf_`), OpenAI, Anthropic and Langfuse keys (`sk-`, `pk-lf-`), AWS access keys (`AKIA`), and
 * an `Authorization:` or `Bearer ` header value.
 */
const TOKEN =
  "(?:^|[^A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]|github_pat_|glpat-|xox[abprs]-|hf_[A-Za-z0-9]{8}|sk-[A-Za-z0-9]|pk-lf-|AKIA[0-9A-Z]{16})|[Aa]uthorization:|[Bb]earer ";

/**
 * One argument of a command: non-empty, and not in a known token format (GitHub, GitLab, Slack,
 * Hugging Face, OpenAI, Anthropic, Langfuse and AWS keys, or an `Authorization:` or `Bearer `
 * header value). A secret belongs in the environment allow-list (`env`), never in an argument.
 */
export const Argument = z.string().regex(new RegExp(`^(?![\\s\\S]*(?:${TOKEN}))[\\s\\S]+$`));

/** A command and its arguments, run without a shell. No argument holds a token. */
export const Command = z.array(Argument).min(1);

/** A JSON scalar: a string, a finite number, a boolean or null. */
// A union of primitives would become a JSON Schema type list, which strict validators refuse.
export const JsonScalar = z.xor([z.string(), z.number(), z.boolean(), z.null()]);

/** Who may see a content field: anyone, the project, or only the local store. */
export const Exposure = z.enum(["public", "private", "sealed"]);
/** An exposure. */
export type Exposure = z.infer<typeof Exposure>;

/** How a comparison gets its base side: a stored baseline (`fast`), or both arms now (`confirm`). */
export const CompareMode = z.enum(["fast", "confirm"]);

/**
 * One environment variable that a process may read. Only the listed variables reach it. An entry
 * is a secret when `secret` is true, or when its name has a whole segment KEY, TOKEN, SECRET,
 * PASSWORD, PASSWD or CREDENTIAL; `secret: false` overrides a name match. The file names the
 * variable only, never its value.
 */
export const EnvEntry = z.strictObject({
  name: none(EnvName.describe("The variable's name.")),
  secret: none(
    z
      .boolean()
      .describe("Whether the value is a secret, which Ichnaea scrubs from what it writes."),
  ).optional(),
});

const commandSourceShape = {
  command: none(Command.describe("The command that fetches the files, run with the user's tools.")),
  output: none(Text.describe("The directory or file that the command writes.")),
  env: none(
    z.array(EnvName).describe("The environment variables that the command may read."),
  ).optional(),
};

/**
 * A git repository that `git clone` takes: an HTTPS URL with no user information, query or
 * fragment; an `ssh://` URL whose user has no password; or `user@host:path`. No part holds a known
 * token format. The user's credentials come from git, never from the URL.
 */
export const GitRepo = z
  .string()
  .regex(
    new RegExp(
      `^(?![\\s\\S]*(?:${TOKEN}))(?:https://[^\\s/?#@]+(?:/[^\\s?#]*)?|ssh://(?:[A-Za-z0-9._-]+@)?[^\\s/?#@:]+(?::[0-9]+)?(?:/[^\\s?#@]*)?|[A-Za-z0-9._-]+@[^\\s/?#@:]+:[^\\s?#@/][^\\s?#@]*)$`,
    ),
  );

/** A git repository at a full commit: fetched by the system `git`, with the user's credentials. */
export const GitSource = z.strictObject({
  git: z
    .strictObject({
      repo: none(GitRepo.describe("The repository, as `git clone` takes it.")),
      commit: none(CommitSha.describe("The full commit.")),
      path: none(Text.describe("A file or directory in the repository.")).optional(),
    })
    .describe("A git repository at a full commit."),
});

/**
 * An HTTPS URL with no user information, query or fragment, so that it cannot carry a
 * credential.
 */
export const HttpsUrl = z.string().regex(/^https:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/);

/** A file that Ichnaea fetches over HTTPS, with no headers, and verifies against its digest. */
export const HttpsSource = z.strictObject({
  https: z
    .xor([
      z.strictObject({ url: none(HttpsUrl.describe("The URL.")) }),
      FromEnv.describe("A URL that the environment holds, such as a presigned URL."),
    ])
    .describe("Where to fetch the file."),
  digest: none(Digest.describe("The digest that the fetched file must have.")),
});

/** Where a set of files comes from: a file, a git commit, an HTTPS URL or a command. */
export const DataSource = z.xor([
  z.strictObject({ file: none(Text.describe("A path, relative to the declaring file.")) }),
  GitSource,
  HttpsSource,
  z.strictObject(commandSourceShape),
]);

/**
 * A process that runs the system, one per arm: the command, what runs before it, and what it may
 * read. Defaults: capacity 1, processes 1, startTimeout `PT10M`.
 */
export const WorkerSettings = z.strictObject({
  command: none(
    Command.describe("The command that starts the worker, run in the arm's directory."),
  ),
  prepare: none(
    Command.describe("A command that each arm runs in its own directory before its worker starts."),
  ).optional(),
  env: z.array(EnvEntry).describe("The environment variables that the worker may read.").optional(),
  envFile: none(
    Text.describe("A file of secrets to load. Only the variables listed in env pass."),
  ).optional(),
  endpoints: none(
    z.array(ConfigName).describe("The endpoints from the project config that the worker calls."),
  ).optional(),
  capacity: none(
    z.int().min(1).describe("How many trials one worker process takes at a time. Default 1."),
  ).optional(),
  processes: none(z.int().min(1).describe("How many worker processes run. Default 1.")).optional(),
  startTimeout: none(
    Duration.describe("How long a worker may take to be ready. Default PT10M."),
  ).optional(),
});
/** A worker's settings. */
export type WorkerSettings = z.infer<typeof WorkerSettings>;

/** A model endpoint and its static budgets for a run. */
export const Endpoint = z.strictObject({
  provider: none(Text.describe("The provider that serves the endpoint.")).optional(),
  region: none(Text.describe("The region that serves the endpoint.")).optional(),
  concurrency: none(
    z.int().min(1).describe("The most trials that may run at once on the endpoint. Default 4."),
  ).optional(),
  requestsPerMinute: none(
    z.int().min(1).describe("The most requests per minute. No limit when absent."),
  ).optional(),
  tokensPerMinute: none(
    z.int().min(1).describe("The most tokens per minute. No limit when absent."),
  ).optional(),
});

/**
 * The limits of a run. Defaults: artifactBytes 256 MiB, outputBytes 1 MiB, wallClockMax three
 * times trialDeadline, missingMax 0.2, throttleMax `PT10M`.
 */
export const RunLimits = z.strictObject({
  artifactBytes: none(
    z.int().min(0).describe("The largest artifact of a trial, in bytes."),
  ).optional(),
  outputBytes: none(z.int().min(0).describe("The largest output of a trial, in bytes.")).optional(),
  trialDeadline: none(
    Duration.describe("The time bound of one trial, net of throttle waits."),
  ).optional(),
  wallClockMax: none(
    Duration.describe("The wall-clock cap of one trial attempt, throttle waits included."),
  ).optional(),
  missingMax: none(
    Probability.describe("The largest share of an arm's planned trials that may be missing."),
  ).optional(),
  throttleMax: none(
    Duration.describe("How long one call may wait to get through before the trial stops."),
  ).optional(),
});
