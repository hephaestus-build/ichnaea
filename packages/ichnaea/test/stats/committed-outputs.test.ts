// CI checks the provenance of every published study output (`check-sweep-provenance.ts --all`), so
// the list of outputs comes from the committed sidecars, never from a list kept by hand.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { committedOutputs } from "../../scripts/stats/check-sweep-provenance.ts";
import { repoRoot } from "../../scripts/stats/provenance.ts";

describe("the published study outputs", () => {
  it("are every output with a committed sidecar", () => {
    const root = repoRoot(import.meta.filename);
    const validation = join(import.meta.dirname, "..", "..", "validation");
    const sidecars = readdirSync(validation)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => `packages/ichnaea/validation/${f.replace(/\.meta\.json$/, "")}`)
      .toSorted();
    expect(sidecars.length).toBeGreaterThan(0);
    expect(committedOutputs(root)).toEqual(sidecars);
  });
});
