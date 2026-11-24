import { randomUUID } from "node:crypto";
import { link, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize } from "../contracts/canonical.ts";

/** Publish a complete file without replacing an existing entry. */
export async function publishRecord(dir: string, name: string, record: unknown): Promise<void> {
  const temporary = join(dir, `.temporary-${randomUUID()}`);
  try {
    await writeFile(temporary, `${canonicalize(record)}\n`, { flag: "wx", flush: true });
    await link(temporary, join(dir, name));
  } finally {
    await rm(temporary, { force: true });
  }
}
