import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize } from "@hephaestus-build/ichnaea-contracts";

/** One booking in the monthly call ledger. */
export interface LedgerBooking {
  readonly run: string;
  readonly calls: number;
  readonly at: string;
}

/** Thrown when a run would exceed an endpoint's monthly cap. The run makes no call. */
export class MonthlyCapError extends Error {
  override readonly name = "MonthlyCapError";
}

/**
 * A monthly call ledger per model endpoint (REQ-86), as append-only files:
 * `ledger/<endpoint>/<YYYY-MM>.jsonl`. A run reserves its worst-case calls before the first call;
 * a reservation that would exceed the cap is refused, so the run ends INVALID without a call.
 */
export class CallLedger {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private file(endpoint: string, at: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(endpoint))
      throw new Error(`endpoint name '${endpoint}' cannot name a directory`);
    return join(this.root, "ledger", endpoint, `${at.slice(0, 7)}.jsonl`);
  }

  /** Calls booked against an endpoint in the month of `at`. */
  async used(endpoint: string, at: string): Promise<number> {
    let text = "";
    try {
      text = await readFile(this.file(endpoint, at), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .reduce((sum, l) => sum + (JSON.parse(l) as LedgerBooking).calls, 0);
  }

  /** Books a run's worst-case calls, or refuses when the month's cap would be exceeded. */
  async reserve(
    endpoint: string,
    cap: number,
    booking: LedgerBooking,
  ): Promise<{ used: number; remaining: number }> {
    const used = await this.used(endpoint, booking.at);
    if (used + booking.calls > cap) {
      throw new MonthlyCapError(
        `run '${booking.run}' plans ${booking.calls} calls to '${endpoint}', but ${used} of ${cap} are used this month`,
      );
    }
    const file = this.file(endpoint, booking.at);
    await mkdir(join(file, ".."), { recursive: true });
    await appendFile(file, `${canonicalize(booking)}\n`);
    return { used: used + booking.calls, remaining: cap - used - booking.calls };
  }
}
