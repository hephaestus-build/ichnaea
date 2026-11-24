# Reports: `@tumaet/ichnaea`

The `report` command renders a Markdown CI summary (`summary.md`) and a static HTML report
(`report.html`). The library function `report(records, { format })` also returns the JSON view.
The library's `decisionView(records)` exposes the same verified view as an object.
Both library functions are synchronous and read no files.

- Every format uses the verified view. The engine recomputes the decision from the stored
  evidence. Changed evidence or decision digests fail verification.
- The run manifest records the primary input and decision digests and the deciding version.
  When a newer engine reads a sealed run, it writes a recalculation with its own identity.
- JSON includes the verdict, the measure estimates and counts, hard-gate outcomes and lineage.
  The class-none projection omits gate detail. The flags and rows contain the results alone.
- Rates give the observed cases equal weight. Each result states its method, level, sidedness,
  validity and denominators. Block variance and case dispersion are descriptive.

- A lower bound is labelled "not validated" unless the comparison's non-inferiority result is
  validated (decision 0015). The regression result never vouches for an interval.
- `lintReport` checks each output. A rate or a difference must stand next to its interval, and an
  HTML bound marked not validated must carry its label. The word "significant" and an anonymity
  claim are not allowed, and a lineage footer is required.
- The HTML report has no JavaScript and no external resource. Every verdict is written out, so its
  meaning never rests on colour. The colours come from the Okabe–Ito palette.
