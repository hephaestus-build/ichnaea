// The core has no runtime dependency but the contracts package, and zod as a peer.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("core dependencies", () => {
  it("are the contracts package only, with zod as a peer", async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      "@hephaestus-build/ichnaea-contracts",
    ]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(["zod"]);
  });
});
