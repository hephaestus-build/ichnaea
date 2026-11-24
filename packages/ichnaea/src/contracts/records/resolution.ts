import * as z from "zod";

import { none } from "../data-class.ts";
import { MeasureId, Probability, Text } from "../primitives.ts";

/** The evidence behind a per-measure resolution estimate. */
export const Resolution = z.strictObject({
  measure: none(MeasureId),
  basis: none(z.enum(["default-simulation", "noise-pilot", "base-arm-rates"])),
  targetPower: none(Probability),
  level: none(Probability),
  targetDrop: none(Probability).optional(),
  powerAtTarget: none(Probability).optional(),
  result: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: none(z.literal("detectable-drop")),
      drop: none(Probability),
    }),
    z.strictObject({
      kind: none(z.literal("extreme")),
      power: none(Probability),
    }),
    z.strictObject({
      kind: none(z.literal("unavailable")),
      reason: none(Text),
    }),
  ]),
});
/** One measure's resolution estimate. */
export type Resolution = z.infer<typeof Resolution>;
