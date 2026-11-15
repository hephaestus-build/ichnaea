# 0011 The verdict order, captured output and scope sentences

- Status: Accepted
- Date: 2026-11-15

## Context

A run verdict combines record checks, deterministic hard gates, the plan's mode and the statistics
of each primary measure. The order decides what a reader sees when several apply. Three cases went
wrong:

- An estimate-only run hid a failed hard gate. A hard gate is deterministic, so its result does not
  depend on power.
- A completed record whose answer was lost was scored as a wrong answer. It also failed a gate that
  checked for an answer, and blocked the change.
- A system failure that carried a passing value counted as a pass.

Reports also printed claims that the records did not support, for example "beyond run-to-run
noise" on a run with one trial per case.

## Decision

- **Order.** INVALID first, then a failed hard gate, then estimate-only, then the statistical
  verdicts.
  - INVALID: a record check failed. It always blocks.
  - A failed hard gate gives REGRESSION in both modes. The reason names the gate.
  - Estimate-only gives no verdict. An exploratory run, whose plan changed after the first trial,
    is estimate-only too.
- **Captured output.** A trial is scored only on output that was captured.
  - A `completed` record with neither an output nor a pointer to one is an infrastructure failure,
    with the error kind `not-captured`. It counts as missing: against coverage, and in the
    sensitivity analysis (decision 0010).
  - Import makes that change. An importer should make it itself, as the example application does.
  - A hard gate checks only captured output. A lost capture shows as coverage, never as a failed
    check.
  - An output that the system returned empty was captured. It is scored.
- **Failed trials.** A system failure or a budget overrun is a failed trial on every binary
  measure, whatever value its record carries. A failed trial that carries a passing value is a
  record that contradicts itself, which is a defect in the importer. Import refuses it, and a
  decision over such records is INVALID.
- **Scope sentences** come from the records:
  - An INVALID decision makes no claim: "no claim: the records fail a check". Its reason states
    the cause.
  - A failed hard gate: "a deterministic check failed".
  - Estimate-only: "estimates on these N cases, without a verdict".
  - Otherwise, under `fixed-cases`: "on these N cases". N counts the cases that the primary
    measures compare, not every case of the plan. ", beyond run-to-run noise" is added only when
    every one of those cases has at least 2 trials in each arm.
  - Under `sampled-cases`: the population the N randomly drawn cases represent.
- **Reasons.** The reason of an INCONCLUSIVE verdict names its cause. The cause is the
  sensitivity analysis, a comparison outside the validated domain, no comparison, or "the cases
  cannot tell yet".

## Evidence

- A run of 12 cases with one trial each and a failed hard gate gave no verdict and exited 0 under a
  reporting policy. It now gives REGRESSION, names the gate, and blocks.
- In the example application, one completed record without an answer made the candidate a blocking
  REGRESSION through a failed gate. It now passes, with that trial counted as missing.
- Sixty candidate system failures that carried a passing value gave PASS. The run is now INVALID.

## Consequences

- An importer must class lost output as `infrastructure_failure` with `not-captured`, or pass the
  output on. Import does it for a completed record without output, so a capture failure is never
  scored.
- A gate that checked for missing output checks nothing now. Such a gate checks the content of
  captured output instead.
