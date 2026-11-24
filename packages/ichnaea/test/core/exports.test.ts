import { expect, it } from "vitest";

import { exportProblems, namespaces, readInventory } from "../../scripts/check-export-inventory.ts";

it("matches each package entry against its committed inventory", () => {
  expect(exportProblems(readInventory(), namespaces)).toEqual([]);
});

it("refuses an unlisted export on an otherwise valid entry", () => {
  expect(
    exportProblems(readInventory(), {
      ...namespaces,
      ".": { ...namespaces["."], internalHelper() {} },
    }),
  ).toEqual([".: unlisted export 'internalHelper'"]);
});
