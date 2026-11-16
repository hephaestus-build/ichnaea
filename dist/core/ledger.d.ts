/** One booking in the monthly call ledger. */
export interface LedgerBooking {
    /** The ID of the run that books the calls. */
    readonly run: string;
    /** The number of calls booked, a non-negative integer. */
    readonly calls: number;
    /** The ISO 8601 timestamp of the booking; its `YYYY-MM` prefix selects the month's file. */
    readonly at: string;
}
/**
 * Thrown when a ledger line, or a booking to write, is not a valid booking. The booking stops: a
 * ledger that cannot be read never counts as 0 calls, so one corrupt line cannot lift the cap.
 */
export declare class LedgerError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "LedgerError";
}
/** Age after which a ledger lock is taken to belong to a crashed run. */
export declare const STALE_LOCK_MS = 30000;
/** Thrown when a run would exceed an endpoint's monthly cap. The run makes no call. */
export declare class MonthlyCapError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "MonthlyCapError";
}
/**
 * A monthly call ledger per model endpoint (REQ-86), as append-only files:
 * `ledger/<endpoint>/<YYYY-MM>.jsonl`. A run reserves its worst-case calls before the first call;
 * a reservation that would exceed the cap is refused, so the run ends INVALID without a call.
 * A reservation holds an exclusive lock file while it reads and books, so concurrent reservations
 * cannot together exceed the cap.
 */
export declare class CallLedger {
    /** The directory that holds the `ledger/` folder. */
    readonly root: string;
    constructor(root: string);
    private file;
    /**
     * Calls booked against an endpoint in the month of `at`. Only a missing file counts as 0. A line
     * that is not a booking throws a LedgerError that names the file and the line.
     */
    used(endpoint: string, at: string): Promise<number>;
    /** Books a run's worst-case calls, or refuses when the month's cap would be exceeded. */
    reserve(endpoint: string, cap: number, booking: LedgerBooking): Promise<{
        used: number;
        remaining: number;
    }>;
    /**
     * Takes an exclusive lock by creating its file; waits up to 10 s for another holder. A booking
     * holds the lock for milliseconds, so a lock older than `STALE_LOCK_MS` belongs to a run that
     * crashed while it held it, and is taken over.
     */
    private lock;
}
//# sourceMappingURL=ledger.d.ts.map