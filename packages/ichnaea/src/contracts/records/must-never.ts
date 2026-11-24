import * as z from "zod";

import { none } from "../data-class.ts";
import { CaseId, MeasureId, Text, Timestamp } from "../primitives.ts";

const Detector = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: none(z.literal("deterministic")),
    variants: z
      .array(
        z.strictObject({
          pattern: none(Text),
          positiveControl: none(CaseId),
        }),
      )
      .min(1),
  }),
  z.strictObject({ kind: none(z.literal("model")) }),
]);

/** A detector, its scope, and the cases over which its hits are counted. */
export const MustNever = z.strictObject({
  measure: none(MeasureId),
  cases: none(z.array(CaseId).min(1)),
  scope: none(Text),
  detector: Detector,
});

/** The authored declarations before their identifiers are validated. */
export type MustNeverDeclaration = z.input<typeof MustNever>;

/** Counts and the recorded evidence about independence. */
export const MustNeverCount = z.strictObject({
  measure: none(MeasureId),
  scope: none(Text),
  detector: none(z.enum(["deterministic", "model"])),
  planned: none(z.int().nonnegative()),
  clean: none(z.int().nonnegative()),
  hits: none(z.int().nonnegative()),
  missing: none(z.int().nonnegative()),
  cases: z.array(
    z.strictObject({
      case: none(CaseId),
      planned: none(z.int().nonnegative()),
      observed: none(z.int().nonnegative()),
      status: none(z.enum(["clean", "hit", "missing"])),
      contexts: none(z.array(Text)),
    }),
  ),
  windows: z.array(
    z.strictObject({
      block: none(z.int().nonnegative()),
      startedAt: none(Timestamp),
      endedAt: none(Timestamp),
    }),
  ),
  controls: z.array(
    z.strictObject({
      pattern: none(Text),
      case: none(CaseId),
      status: none(z.enum(["hit", "clean", "missing"])),
    }),
  ),
});
