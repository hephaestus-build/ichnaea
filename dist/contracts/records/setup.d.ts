import * as z from "zod";
/**
 * A name that the project config or a suite gives to a worker, a dataset, an endpoint, a measure,
 * an instrument, a stage, a profile or a sink, for example `eu-llm` or `quality-judge`.
 */
export declare const ConfigName: z.ZodString;
/** A name in the project config or a suite. */
export type ConfigName = z.infer<typeof ConfigName>;
/** The name of an environment variable, for example `LLM_API_KEY`. */
export declare const EnvName: z.ZodString;
/** A value that Ichnaea reads from an environment variable when it uses it, and never stores. */
export declare const FromEnv: z.ZodObject<{
    fromEnv: z.ZodString;
}, z.core.$strict>;
/**
 * An ISO 8601 duration as a person writes it in a project or suite file: years, months, days,
 * hours, minutes and whole seconds, such as `P7D`, `PT10M` or `P3Y`. It has at least one part, and
 * a `T` is followed by a time part. Records exchanged with a worker or scorer use `Duration`, in
 * seconds only.
 */
export declare const AuthoredDuration: z.ZodString;
/** A full git commit: 40 hexadecimal digits (SHA-1), or 64 (SHA-256). Never a branch or a tag. */
export declare const CommitSha: z.ZodString;
/**
 * One argument of a command: non-empty, and holding no known token format (GitHub, GitLab, Slack,
 * Hugging Face, OpenAI, Anthropic, Langfuse and AWS keys, an `Authorization` header or a `Bearer`
 * value). A secret belongs in the environment allow-list (`env`), never in an argument.
 */
export declare const Argument: z.ZodString;
/**
 * The path of an HTTPS URL: it starts with `/`, and holds no whitespace, query, fragment or known
 * token format, because it may come from a URL that the environment held.
 */
export declare const HttpsPath: z.ZodString;
/** A command and its arguments, run without a shell. No argument holds a token. */
export declare const Command: z.ZodArray<z.ZodString>;
/** A JSON scalar: a string, a finite number, a boolean or null. */
export declare const JsonScalar: z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>;
/** Who may see a content field: anyone, the project, or only the local store. */
export declare const Exposure: z.ZodEnum<{
    private: "private";
    public: "public";
    sealed: "sealed";
}>;
/** An exposure. */
export type Exposure = z.infer<typeof Exposure>;
/** How a comparison gets its base side: a stored baseline (`fast`), or both arms now (`confirm`). */
export declare const CompareMode: z.ZodEnum<{
    confirm: "confirm";
    fast: "fast";
}>;
/**
 * One environment variable that a process may read. Only the listed variables reach it. An entry
 * is a secret when `secret` is true, or when its name has a whole segment KEY, TOKEN, SECRET,
 * PASSWORD, PASSWD or CREDENTIAL; `secret: false` overrides a name match. The file names the
 * variable only, never its value.
 */
export declare const EnvEntry: z.ZodObject<{
    name: z.ZodString;
    secret: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/**
 * A git repository that `git clone` takes: an HTTPS URL with no user information, query or
 * fragment; an `ssh://` URL whose user has no password; or the scp form `[user@]host:path`, whose
 * path holds no `@`. No part holds a known token format. The user's credentials come from git, never from the URL.
 */
export declare const GitRepo: z.ZodString;
/** A git repository at a full commit: fetched by the system `git`, with the user's credentials. */
export declare const GitSource: z.ZodObject<{
    git: z.ZodObject<{
        repo: z.ZodString;
        commit: z.ZodString;
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * An HTTPS URL with no user information, query or fragment, so that it cannot carry a
 * credential.
 */
export declare const HttpsUrl: z.ZodString;
/** A file that Ichnaea fetches over HTTPS, with no headers, and verifies against its digest. */
export declare const HttpsSource: z.ZodObject<{
    https: z.ZodXor<readonly [z.ZodObject<{
        url: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>]>;
    digest: z.ZodString;
}, z.core.$strict>;
/** Where a set of files comes from: a file, a git commit, an HTTPS URL or a command. */
export declare const DataSource: z.ZodXor<readonly [z.ZodObject<{
    file: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    git: z.ZodObject<{
        repo: z.ZodString;
        commit: z.ZodString;
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    https: z.ZodXor<readonly [z.ZodObject<{
        url: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>]>;
    digest: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodArray<z.ZodString>;
    output: z.ZodString;
    env: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>]>;
/**
 * A process that runs the system, one per arm: the command, what runs before it, and what it may
 * read. Defaults: capacity 1, processes 1, startTimeout `PT10M`.
 */
export declare const WorkerSettings: z.ZodObject<{
    command: z.ZodArray<z.ZodString>;
    prepare: z.ZodOptional<z.ZodArray<z.ZodString>>;
    env: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        secret: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>>;
    envFile: z.ZodOptional<z.ZodString>;
    endpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    capacity: z.ZodOptional<z.ZodInt>;
    processes: z.ZodOptional<z.ZodInt>;
    startTimeout: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A worker's settings. */
export type WorkerSettings = z.infer<typeof WorkerSettings>;
/** A model endpoint and its static budgets for a run. */
export declare const Endpoint: z.ZodObject<{
    provider: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodString>;
    concurrency: z.ZodOptional<z.ZodInt>;
    requestsPerMinute: z.ZodOptional<z.ZodInt>;
    tokensPerMinute: z.ZodOptional<z.ZodInt>;
}, z.core.$strict>;
/**
 * The limits of a run. Defaults: artifactBytes 256 MiB, outputBytes 1 MiB, wallClockMax three
 * times trialDeadline, missingMax 0.2, throttleMax `PT10M`.
 */
export declare const RunLimits: z.ZodObject<{
    artifactBytes: z.ZodOptional<z.ZodInt>;
    outputBytes: z.ZodOptional<z.ZodInt>;
    trialDeadline: z.ZodOptional<z.ZodString>;
    wallClockMax: z.ZodOptional<z.ZodString>;
    missingMax: z.ZodOptional<z.ZodNumber>;
    throttleMax: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
//# sourceMappingURL=setup.d.ts.map