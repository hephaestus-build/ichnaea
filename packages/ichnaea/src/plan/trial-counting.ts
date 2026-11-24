/** Outcomes that count as failed binary trials even when no score was returned. */
export const FAILED_TRIAL_OUTCOMES: ReadonlySet<string> = new Set([
  "system_failure",
  "budget_exceeded",
]);
