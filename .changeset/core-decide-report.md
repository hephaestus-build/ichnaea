---
"@hephaestus-build/ichnaea-core": minor
"@hephaestus-build/ichnaea-decide": minor
"@hephaestus-build/ichnaea-report": minor
---

First end-to-end slice. `core`: a plugin host with the seven lifecycle hooks and default-deny egress, an append-only file store with a run index, a monthly call ledger, the planner (every trial planned before any call, worst-case calls, estimand checks) and the `ichnaea` CLI with `import` (another runner's results, no model calls), `schema` and `doctor`. `decide`: the decision rule (non-inferiority per primary measure, Holm on regressions, hard gates, coverage floors, missingness and its sensitivity analysis, flips, estimate-only mode) and the `decide` command with a verdict file and an exit code by CI policy. `report`: one view model rendered as a Markdown CI summary and a static HTML report, after a check that the decision recomputes from the stored records.
