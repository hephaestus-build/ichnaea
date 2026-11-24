import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import * as z from "zod";
import { canonicalize } from "../contracts/canonical.js";
import { Json } from "../contracts/primitives.js";
import { TrialIdentity, WorkerReady } from "../contracts/records/worker.js";
import { CallLedger } from "./ledger.js";
import {} from "./records.js";
import { sealRun } from "./store.js";
import { runDirectory } from "./store-path.js";
const LEASE_MS = 10 * 60_000;
const OwnerSchema = z.strictObject({ host: z.string(), pid: z.int().positive() });
const block = z.int().nonnegative();
const BlockStartSchema = z.strictObject({
    kind: z.literal("block-start"),
    block,
    first: z.enum(["base", "candidate"]),
});
const TakeoverCause = z.enum(["dead-pid", "expired-lease"]);
const EntrySchema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("receipt"), receipt: Json.optional() }),
    z.strictObject({
        kind: z.literal("owner-takeover"),
        previous: OwnerSchema,
        cause: TakeoverCause,
    }),
    BlockStartSchema,
    z.strictObject({ kind: z.literal("block-abandoned"), block }),
    z.strictObject({ kind: z.literal("block-complete"), block }),
    z.strictObject({ kind: z.literal("handshake"), block, ready: WorkerReady }),
    z.strictObject({ kind: z.literal("intent"), block, trial: TrialIdentity }),
    z.strictObject({ kind: z.literal("outcome"), block, trial: TrialIdentity, result: Json }),
]);
function hasCode(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function dead(pid) {
    try {
        process.kill(pid, 0);
        return false;
    }
    catch (error) {
        if (hasCode(error, "ESRCH"))
            return true;
        if (hasCode(error, "EPERM"))
            return false;
        throw error;
    }
}
/** Publish a complete file without replacing an existing entry. */
async function publish(dir, name, record) {
    const temporary = join(dir, `.temporary-${randomUUID()}`);
    try {
        await writeFile(temporary, `${canonicalize(record)}\n`, { flag: "wx", flush: true });
        await link(temporary, join(dir, name));
    }
    finally {
        await rm(temporary, { force: true });
    }
}
class Lease {
    #path;
    #next;
    #heartbeat;
    #closed = false;
    constructor(dir, generation) {
        this.#path = join(dir, String(generation));
        this.#next = join(dir, String(generation + 1));
        this.#heartbeat = setInterval(() => {
            void this.refresh().catch(() => clearInterval(this.#heartbeat));
        }, LEASE_MS / 3);
        this.#heartbeat.unref();
    }
    async refresh() {
        if (this.#closed || existsSync(this.#next))
            throw new Error("run ownership lost");
        const now = new Date();
        const status = await stat(this.#path);
        if (now.getTime() - status.mtimeMs >= LEASE_MS || existsSync(this.#next))
            throw new Error("run ownership lost");
        await utimes(this.#path, now, now);
        if (this.#closed || existsSync(this.#next))
            throw new Error("run ownership lost");
    }
    async close() {
        if (this.#closed)
            return;
        this.#closed = true;
        clearInterval(this.#heartbeat);
        await writeFile(`${this.#path}.released`, "");
    }
}
async function takeLease(dir) {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const previous = Math.max(-1, ...files.filter((name) => /^\d+$/.test(name)).map(Number));
    let takeover;
    const host = hostname();
    if (previous >= 0) {
        const path = join(dir, String(previous));
        if (!existsSync(`${path}.released`)) {
            const owner = OwnerSchema.parse(JSON.parse(await readFile(path, "utf8")));
            const expired = Date.now() - (await stat(path)).mtimeMs >= LEASE_MS;
            const cause = owner.host === host && dead(owner.pid) ? "dead-pid" : expired ? "expired-lease" : undefined;
            if (!cause)
                throw new Error("run is owned by another runner");
            takeover = { kind: "owner-takeover", previous: owner, cause };
        }
    }
    const generation = previous + 1;
    // All contenders for a generation publish the same name. Keeping prior generations fences
    // their owners even after a later owner releases the run.
    try {
        await publish(dir, String(generation), { host, pid: process.pid });
    }
    catch (error) {
        if (hasCode(error, "EEXIST"))
            throw new Error("run is owned by another runner", { cause: error });
        throw error;
    }
    return { lease: new Lease(dir, generation), takeover };
}
async function readEntries(dir) {
    const files = (await readdir(dir))
        .filter((name) => /^\d+\.json$/.test(name))
        .toSorted((a, b) => Number(basename(a, ".json")) - Number(basename(b, ".json")));
    const entries = [];
    for (const [index, file] of files.entries()) {
        if (file !== `${index}.json`)
            throw new Error("run journal has a missing entry");
        try {
            entries.push(EntrySchema.parse(JSON.parse(await readFile(join(dir, file), "utf8"))));
        }
        catch {
            throw new Error(`invalid run journal entry ${index}`);
        }
    }
    return entries;
}
/** Exclusive access to one work area and its append-only block journal. */
export class RunWork {
    directory;
    #root;
    #run;
    #lease;
    #journal;
    #entries;
    #block;
    #pending = new Set();
    #draw = 0;
    #changing = false;
    constructor(root, run, directory, lease, entries) {
        this.#root = root;
        this.#run = run;
        this.directory = directory;
        this.#lease = lease;
        this.#journal = join(directory, "journal");
        this.#entries = entries;
        for (const entry of entries) {
            if ("block" in entry && entry.kind !== "block-start" && this.#block?.block !== entry.block)
                throw new Error("run journal entry refers to a block that is not open");
            if (entry.kind === "block-start") {
                if (this.#block || entry.block !== this.#draw++)
                    throw new Error("run journal has out-of-order blocks");
                this.#block = entry;
            }
            else if (entry.kind === "block-complete" || entry.kind === "block-abandoned") {
                this.#block = undefined;
            }
        }
    }
    static async open(root, run, receipt) {
        const directory = runDirectory(root, "work", run);
        const sealed = runDirectory(root, "runs", run);
        if (existsSync(sealed))
            throw new Error(`run '${run}' is already sealed`);
        const { lease, takeover } = await takeLease(runDirectory(root, "owners", run));
        try {
            if (existsSync(sealed))
                throw new Error(`run '${run}' is already sealed`);
            const journal = join(directory, "journal");
            await mkdir(journal, { recursive: true });
            const entries = await readEntries(journal);
            const work = new RunWork(root, run, directory, lease, entries);
            if (!entries.length)
                await work.#append({ kind: "receipt", ...(receipt === undefined ? {} : { receipt }) });
            else if (entries[0]?.kind !== "receipt")
                throw new Error("the first run journal entry must be the receipt");
            else if (receipt !== undefined &&
                canonicalize(entries[0].receipt ?? null) !== canonicalize(receipt))
                throw new Error("the receipt changed since the run began");
            if (takeover)
                await work.#append(takeover);
            if (work.#block) {
                await work.#append({ kind: "block-abandoned", block: work.#block.block });
                work.#block = undefined;
            }
            return work;
        }
        catch (error) {
            await lease.close();
            throw error;
        }
    }
    async entries() {
        return readEntries(this.#journal);
    }
    async #append(entry) {
        await this.#lease.refresh();
        await publish(this.#journal, `${this.#entries.length}.json`, EntrySchema.parse(entry));
        this.#entries.push(entry);
    }
    async #change(operation) {
        if (this.#changing)
            throw new Error("another journal operation is in progress");
        this.#changing = true;
        try {
            await this.#lease.refresh();
            return await operation();
        }
        finally {
            this.#changing = false;
        }
    }
    /** Book the entire block before emitting any attempt intent. A dead runner cannot refund it. */
    async startBlock(booking, draw) {
        return this.#change(async () => {
            if (this.#block)
                throw new Error("a block is already open");
            const entry = BlockStartSchema.parse({
                kind: "block-start",
                block: this.#draw,
                first: draw(this.#draw),
            });
            await new CallLedger(this.#root).reserve(booking.endpoint, booking.cap, {
                run: this.#run,
                calls: booking.calls,
                at: new Date().toISOString(),
            });
            await this.#append(entry);
            this.#block = entry;
            this.#draw++;
            return entry;
        });
    }
    async handshake(ready) {
        await this.#change(async () => {
            await this.#append({ kind: "handshake", block: this.#openBlock(), ready });
        });
    }
    async intent(trial) {
        const parsed = TrialIdentity.parse(trial);
        const key = canonicalize(parsed);
        await this.#change(async () => {
            if (this.#pending.has(key))
                throw new Error("attempt already has an intent");
            await this.#append({ kind: "intent", block: this.#openBlock(), trial: parsed });
            this.#pending.add(key);
        });
    }
    async outcome(trial, result) {
        const parsed = TrialIdentity.parse(trial);
        const key = canonicalize(parsed);
        await this.#change(async () => {
            if (!this.#pending.has(key))
                throw new Error("outcome has no outstanding intent");
            await this.#append({ kind: "outcome", block: this.#openBlock(), trial: parsed, result });
            this.#pending.delete(key);
        });
    }
    #openBlock() {
        if (!this.#block)
            throw new Error("there is no open block");
        return this.#block.block;
    }
    async completeBlock() {
        await this.#change(async () => {
            if (this.#pending.size)
                throw new Error("block has attempts without outcomes");
            await this.#append({ kind: "block-complete", block: this.#openBlock() });
            this.#block = undefined;
        });
    }
    async seal(records) {
        await this.#change(async () => {
            if (records.run.id !== this.#run)
                throw new Error("records belong to another run");
            if (this.#block)
                throw new Error("cannot seal a run with an open block");
            await sealRun(this.#root, this.directory, records, () => this.#lease.refresh());
            await this.#lease.close();
        });
    }
    async close() {
        if (this.#changing)
            throw new Error("cannot release ownership during a journal operation");
        await this.#lease.close();
    }
}
//# sourceMappingURL=runner-work.js.map