# 0008 Only binary outcomes have a validated method

- Status: Accepted
- Date: 2026-11-15

## Context

Score, proportion and ordinal measures need their own methods. A proportion is several items in one
output. Treating its items as independent trials undercovers: coverage 0.73–0.80 and false rejections
of 19–48% in a study with correlated items.

## Decision

- `compareCounts` takes the measure's value type and refuses anything but `binary`. The measure is
  then estimate-only, and the decision says why.
- A proportion is reduced to one value per trial and analysed as a score outcome once that method
  exists. Its items are never trials.
- No unvalidated method may produce a verdict.

## Consequences

- The score and proportion method must land before the first suite that declares such a primary
  measure, and at the latest for 1.0.
