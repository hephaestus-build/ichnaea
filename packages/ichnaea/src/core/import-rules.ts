import { canonicalize, type MeasureValue, type Trial } from "../contracts/index.ts";

/** Thrown when an importer's records cannot be stored. The message names the record. */
export class ImportError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "ImportError";
}

/**
 * The error kind of a trial whose output was not captured. Such a trial is an infrastructure
 * failure, never a completed trial: it counts as missing, never as a failure of the system.
 */
export const NOT_CAPTURED = "not-captured";

/** Outcomes that score as a failed trial, whatever value a record carries (REQ-20). */
export const FAILED_OUTCOMES: ReadonlySet<string> = new Set(["system_failure", "budget_exceeded"]);

/**
 * Marks a trial whose configuration differs from its arm, or whose observations differ from what
 * the configuration expects (REQ-15), as an invalid configuration. Its outputs stay recorded; it
 * gives no value, so it counts as missing.
 */
export function checkConfiguration(trial: Trial, identity: string | undefined): Trial {
  if (trial.outcome === "invalid_configuration") return trial;
  const mismatch =
    identity !== trial.configuration
      ? `the trial ran configuration ${trial.configuration}, not its arm's ${identity ?? "(no arm)"}`
      : trial.observed
          ?.filter(
            (o) => o.expected !== undefined && canonicalize(o.value) !== canonicalize(o.expected),
          )
          .map((o) => `observed ${o.name} differs from the expected value`)[0];
  if (mismatch === undefined) return trial;
  return {
    ...trial,
    outcome: "invalid_configuration",
    error: { kind: "configuration-mismatch", message: mismatch },
  };
}

/**
 * A trial is scored only on output that was captured (REQ-20). A completed record with neither
 * an output nor a pointer to one is a capture failure: an infrastructure failure, so it counts as
 * missing. An output the system returned empty is present, and is scored.
 */
export function checkCaptured(trial: Trial): Trial {
  if (trial.outcome !== "completed" || trial.output !== undefined || trial.pointer !== undefined)
    return trial;
  return {
    ...trial,
    outcome: "infrastructure_failure",
    error: { kind: NOT_CAPTURED, message: "the record has no captured output" },
  };
}

/** Whether a value says that its trial passed: a binary pass, or a proportion with a success. */
export function passing(value: MeasureValue["value"]): boolean {
  return (
    (value?.type === "binary" && value.pass) ||
    (value?.type === "proportion" && value.successes > 0)
  );
}
