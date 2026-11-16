import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseHeroCard } from "../../src/hero/render.ts";

// The support example's regressed run as a card. It stands in for the card.json that report()
// writes, until that output lands. Cases 03, 06 and 09 broke.
export const broken = new Set(["support-03", "support-06", "support-09"]);

export const regressedJson: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "support-regressed.card.json"), "utf8"),
);

export const regressed = parseHeroCard(regressedJson);
