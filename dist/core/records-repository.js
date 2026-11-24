import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import { canonicalize, digest } from "../contracts/canonical.js";
import { Digest, RunId, Timestamp } from "../contracts/primitives.js";
import { Verdict } from "../contracts/records/decision.js";
import { git } from "./git.js";
import { publishRecord } from "./publish-record.js";
const DecisionEntry = z.strictObject({
    suite: Digest,
    caseSet: Digest,
    base: Digest,
    run: RunId,
    candidate: Digest,
    decidedAt: Timestamp,
    verdict: Verdict.nullable(),
});
const ReadEntry = z.strictObject({
    run: RunId,
    purpose: z.enum(["development", "regression", "confirmation"]),
    case: Digest,
});
function digestFile(value) {
    return `${value.slice("sha256:".length)}.json`;
}
function hasCode(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
/** Publishes a complete index row and leaves any existing row in place. */
async function writeEntry(directory, file, entry) {
    await mkdir(directory, { recursive: true });
    try {
        await publishRecord(directory, file, entry);
        return true;
    }
    catch (error) {
        if (hasCode(error, "EEXIST"))
            return false;
        throw error;
    }
}
async function readEntry(path, schema) {
    let text;
    try {
        text = await readFile(path, "utf8");
    }
    catch (error) {
        if (hasCode(error, "ENOENT"))
            return undefined;
        throw error;
    }
    try {
        return schema.parse(JSON.parse(text));
    }
    catch {
        throw new Error(`invalid records index entry at ${path}`);
    }
}
/** A checkout of the team's records repository. Rows contain class-none identifiers only. */
export class RecordsRepository {
    #directory;
    constructor(directory) {
        this.#directory = directory;
    }
    static async open(path) {
        const directory = await realpath(path);
        const root = await git(directory, ["rev-parse", "--show-toplevel"]);
        if (root.status !== 0 || (await realpath(root.stdout.trimEnd())) !== directory)
            throw new Error("records must name the root of a Git checkout");
        return new RecordsRepository(directory);
    }
    /** Records case use before dispatch. A failed run leaves every reservation it made spent. */
    async recordReads(run, purpose, digests) {
        const cases = [...new Set(digests.map((item) => Digest.parse(item)))].toSorted();
        const directory = join(this.#directory, "reads");
        if (purpose === "confirmation") {
            for (const item of cases) {
                const entry = await readEntry(join(directory, digestFile(item)), ReadEntry);
                if (entry && entry.case !== item)
                    throw new Error("case digest does not match its read index entry");
                if (entry)
                    throw new Error(`confirmation case ${item} was already read`);
            }
        }
        for (const item of cases) {
            const entry = ReadEntry.parse({ run, purpose, case: item });
            const added = await writeEntry(directory, digestFile(item), entry);
            if (!added && purpose === "confirmation")
                throw new Error(`confirmation case ${item} was already read`);
        }
    }
    async appendDecision(input) {
        const entry = DecisionEntry.parse(input);
        const directory = join(this.#directory, "decisions");
        const file = digestFile(digest(entry.run));
        if (await writeEntry(directory, file, entry))
            return;
        const previous = await readEntry(join(directory, file), DecisionEntry);
        if (canonicalize(previous ?? null) !== canonicalize(entry))
            throw new Error(`records already holds another decision for run '${entry.run}'`);
    }
    async earlierCandidates(key) {
        const directory = join(this.#directory, "decisions");
        let files;
        try {
            files = await readdir(directory);
        }
        catch (error) {
            if (hasCode(error, "ENOENT"))
                return [];
            throw error;
        }
        const matching = [];
        for (const file of files) {
            if (!/^[0-9a-f]{64}\.json$/.test(file))
                continue;
            const entry = await readEntry(join(directory, file), DecisionEntry);
            if (entry?.suite === key.suite && entry.caseSet === key.caseSet && entry.base === key.base)
                matching.push(entry);
        }
        return matching.toSorted((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt) || a.run.localeCompare(b.run));
    }
}
/** Use the configured checkout to reserve case reads before any worker dispatch. */
export async function reserveCaseReads(records, run, purpose, digests) {
    if (records === undefined) {
        if (purpose === "confirmation")
            throw new Error("confirmation requires a records repository");
        return undefined;
    }
    const repository = await RecordsRepository.open(records);
    await repository.recordReads(run, purpose, digests);
    return repository;
}
//# sourceMappingURL=records-repository.js.map