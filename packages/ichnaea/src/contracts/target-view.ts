import type { Case } from "./records/case.ts";

/**
 * What a target may see of a case: the input side only. Hidden references, slices, provenance,
 * pool and validation never reach the system under test (REQ-08). The view is an allow-list, so a
 * field added to the case later stays hidden until it is added here on purpose.
 */
export interface TargetCase {
  /** The case's identifier. */
  readonly id: Case["id"];
  /** The unit of the case: a turn, trace, session or episode. */
  readonly unit: Case["unit"];
  /** The case's input, as the target receives it. */
  readonly input: Case["input"];
  /** The scripted turns of a session case; absent when the case has none. */
  readonly turns?: Case["turns"];
  /** References to the case's fixtures by name and digest; absent when the case has none. */
  readonly fixtures?: Case["fixtures"];
}

/** Returns the target's view of a case. */
export function caseForTarget(record: Case): TargetCase {
  const view: { -readonly [K in keyof TargetCase]: TargetCase[K] } = {
    id: record.id,
    unit: record.unit,
    input: structuredClone(record.input),
  };
  if (record.turns !== undefined) view.turns = structuredClone(record.turns);
  if (record.fixtures !== undefined) view.fixtures = structuredClone(record.fixtures);
  return view;
}
