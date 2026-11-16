import { appendFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { canonicalize } from "../contracts/index.js";
import * as z from "zod";
/**
 * What every ledger line must hold: the run and a non-negative whole number of calls. Other
 * fields, such as a writer's `commit`, `event` or `kind`, are allowed and ignored.
 */
const LedgerLine = z.looseObject({ run: z.string(), calls: z.int().min(0) });
/**
 * Thrown when a ledger line, or a booking to write, is not a valid booking. The booking stops: a
 * ledger that cannot be read never counts as 0 calls, so one corrupt line cannot lift the cap.
 */
export class LedgerError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "LedgerError";
}
/** Why a value is not a booking, from its first problem; undefined when it is one. */
function bookingProblem(value) {
    const issue = LedgerLine.safeParse(value).error?.issues[0];
    if (!issue)
        return undefined;
    return issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
}
/** Age after which a ledger lock is taken to belong to a crashed run. */
export const STALE_LOCK_MS = 30_000;
/** Thrown when a run would exceed an endpoint's monthly cap. The run makes no call. */
export class MonthlyCapError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "MonthlyCapError";
}
/**
 * A monthly call ledger per model endpoint (REQ-86), as append-only files:
 * `ledger/<endpoint>/<YYYY-MM>.jsonl`. A run reserves its worst-case calls before the first call;
 * a reservation that would exceed the cap is refused, so the run ends INVALID without a call.
 * A reservation holds an exclusive lock file while it reads and books, so concurrent reservations
 * cannot together exceed the cap.
 */
export class CallLedger {
    /** The directory that holds the `ledger/` folder. */
    root;
    constructor(root) {
        this.root = root;
    }
    file(endpoint, at) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(endpoint))
            throw new Error(`endpoint name '${endpoint}' cannot name a directory`);
        return join(this.root, "ledger", endpoint, `${at.slice(0, 7)}.jsonl`);
    }
    /**
     * Calls booked against an endpoint in the month of `at`. Only a missing file counts as 0. A line
     * that is not a booking throws a LedgerError that names the file and the line.
     */
    async used(endpoint, at) {
        const file = this.file(endpoint, at);
        let text = "";
        try {
            text = await readFile(file, "utf8");
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        let sum = 0;
        for (const [i, line] of text.split("\n").entries()) {
            if (line.trim() === "")
                continue;
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
                throw new LedgerError(`call ledger ${file}, line ${i + 1}: not JSON`);
            }
            const problem = bookingProblem(value);
            if (problem !== undefined)
                throw new LedgerError(`call ledger ${file}, line ${i + 1}: not a booking (${problem})`);
            sum += value.calls;
        }
        return sum;
    }
    /** Books a run's worst-case calls, or refuses when the month's cap would be exceeded. */
    async reserve(endpoint, cap, booking) {
        const file = this.file(endpoint, booking.at);
        const problem = bookingProblem(booking);
        if (problem !== undefined)
            throw new LedgerError(`run '${booking.run}' cannot be booked: ${problem}`);
        await mkdir(join(file, ".."), { recursive: true });
        const release = await this.lock(`${file}.lock`);
        try {
            const used = await this.used(endpoint, booking.at);
            if (used + booking.calls > cap) {
                throw new MonthlyCapError(`run '${booking.run}' plans ${booking.calls} calls to '${endpoint}', but ${used} of ${cap} are used this month`);
            }
            await appendFile(file, `${canonicalize(booking)}\n`);
            return { used: used + booking.calls, remaining: cap - used - booking.calls };
        }
        finally {
            await release();
        }
    }
    /**
     * Takes an exclusive lock by creating its file; waits up to 10 s for another holder. A booking
     * holds the lock for milliseconds, so a lock older than `STALE_LOCK_MS` belongs to a run that
     * crashed while it held it, and is taken over.
     */
    async lock(path) {
        for (let attempt = 0; attempt < 200; attempt++) {
            try {
                const handle = await open(path, "wx");
                await handle.close();
                return () => rm(path, { force: true });
            }
            catch (error) {
                if (error.code !== "EEXIST")
                    throw error;
                const held = await stat(path).catch(() => undefined);
                if (held && Date.now() - held.mtimeMs > STALE_LOCK_MS) {
                    await rm(path, { force: true });
                    continue;
                }
                await delay(50);
            }
        }
        throw new Error(`the call ledger is locked (${path}); remove the file if no run holds it`);
    }
}
//# sourceMappingURL=ledger.js.map