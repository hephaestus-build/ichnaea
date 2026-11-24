# Ichnaea design

Ichnaea compares a GenAI configuration with its base on a fixed set of cases. The plan names the
cases, the measures, the configurations and the budget. Trials carry the evidence for the
comparison. Decisions and reports state the result and the limits of that evidence.

## The decision boundary

These rules define the scope of the design. The README states which claims the current release
can make.

- Keep the recorded outcome of each trial. A capture failure, a system failure and a missing
  measurement carry different meanings.
- Compare the same cases, with the same weights for both configurations. State what the estimate
  describes and when the trial evidence cannot support the comparison.
- A claim about a regression across runs requires independent randomized blocks. A statistical
  pass also needs a validated non-inferiority margin. Until those checks are available, the
  [README guarantee](../README.md#what-the-results-can-show) describes the scope of the result.

The [decision records](decisions/README.md) give the reasons for individual choices. The
[record schemas](https://hephaestus-build.github.io/ichnaea/reference/schemas/) define the
wire format. The [frozen requirements](requirements.md) keep the original acceptance targets
and the IDs that code and tests cite.
