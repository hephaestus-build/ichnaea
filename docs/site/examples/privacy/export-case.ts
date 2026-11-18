import { readFileSync } from "node:fs";

import { Case, projectForEgress } from "@tumaet/ichnaea/contracts";

// Read the first case of the support example, and mark it as personal data.
const [line = ""] = readFileSync("data/cases.jsonl", "utf8").split("\n");
const record = { ...JSON.parse(line), dataClass: "personal" };

// Keep only what may leave for a dashboard that accepts no personal data.
const { value, dropped } = projectForEgress(Case, record, {
  purpose: "dashboard",
  maxClass: "none",
});

console.log(dropped); // [ '/input', '/references' ]
console.log(Object.keys(Object(value)).join(", "));
