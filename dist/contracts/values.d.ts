import type { MeasuredValue } from "./primitives.ts";
/**
 * What a schema cannot check in a measured value, because it compares two fields: a proportion
 * whose successes exceed its trials. Returns the problem, or undefined when there is none.
 */
export declare function proportionProblem(value: MeasuredValue): string | undefined;
//# sourceMappingURL=values.d.ts.map