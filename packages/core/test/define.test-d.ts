// The define helpers keep literal IDs, so a configuration knows the measures and gates it can name.
import { describe, expectTypeOf, it } from "vitest";

import {
  defineConfig,
  defineMeasure,
  definePlugin,
  type GateIdsOf,
  type MeasureIdsOf,
} from "../src/index.ts";

const measure = defineMeasure({
  card: {
    id: "app/correct",
    version: "1.0.0",
    construct: "c",
    operationalDefinition: "o",
    valueType: "binary",
    unit: "proportion",
    direction: "higher",
    justification: "j",
    errorModel: "e",
    applicability: "all",
    tier: "primary",
    unitOfEvaluation: "turn",
    establishes: "e",
    computedBy: "application",
  },
});
const plugin = definePlugin({
  id: "app",
  version: "1.0.0",
  stability: "stable",
  measures: [measure],
  gates: [{ id: "app/schema", version: "1.0.0", description: "d" }],
});

describe("define helpers", () => {
  it("keep the literal IDs of a measure, a plugin and its parts", () => {
    expectTypeOf(measure.card.id).toEqualTypeOf<"app/correct">();
    expectTypeOf(plugin.id).toEqualTypeOf<"app">();
    expectTypeOf<MeasureIdsOf<readonly [typeof plugin]>>().toEqualTypeOf<"app/correct">();
    expectTypeOf<GateIdsOf<readonly [typeof plugin]>>().toEqualTypeOf<"app/schema">();
  });

  it("refuse a part that is not namespaced by its plugin", () => {
    definePlugin({
      id: "app",
      version: "1.0.0",
      stability: "stable",
      // @ts-expect-error a gate of plugin 'app' is named 'app/…'
      gates: [{ id: "other/schema", version: "1.0.0", description: "d" }],
    });
    // @ts-expect-error a measure ID has a namespace
    defineMeasure({ card: { ...measure.card, id: "correct" } });
  });

  it("keep the plugin list of a configuration", () => {
    const config = defineConfig({ plugins: [plugin], governance: "app" });
    expectTypeOf(config.plugins).toEqualTypeOf<readonly [typeof plugin]>();
  });
});
