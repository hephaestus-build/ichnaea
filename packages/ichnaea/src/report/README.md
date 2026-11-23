# Reports: `@tumaet/ichnaea`

The `report` plugin renders a stored decision as a CI summary in Markdown (`summary.md`) and a
static HTML report (`report.html`). `report(decision, { format })` renders one as Markdown, HTML
or the JSON view model. It is synchronous, writes no file, and refuses a report that the lint
refuses (`ReportError`).

- Both come from one view model of the decision record. They compute nothing new, and they show
  the same numbers.
- Before it renders, the plugin recomputes the decision from the stored records. It refuses to
  render when the two differ.
- A lower bound is labelled "not validated" unless the comparison's non-inferiority result is
  validated (decision 0015). The regression result never vouches for an interval.
- `lintReport` checks each output. A rate or a difference must stand next to its interval, and an
  HTML bound marked not validated must carry its label. The word "significant" and an anonymity
  claim are not allowed, and a lineage footer is required.
- The HTML report has no JavaScript and no external resource. Every verdict is written out, so its
  meaning never rests on colour. The colours come from the Okabe–Ito palette.

## One-arm runs

Run `ichnaea report --run <id>` after import. A one-arm run can be reported as soon as it is
stored. To report both pass^k and pass@k, add `trialReduction` to the suite before collecting
trials. Set `measure` to the ID of a binary measure in the suite, `k` to the number of trials
of interest, and `cases` to the IDs in the registered population. A passing value on that
measure defines success. The plan pins this declaration before the importer reads any trial
records.

With exactly k valid values, the report gives the observed all-pass and any-pass indicators.
With more values, it gives both estimates and labels them estimate-only. With fewer, it gives
missing. The overall row gives each registered case equal weight and needs a value from every
case. Reports show these reductions for one-arm runs, and the reductions do not decide a verdict.

Secondary measures with value type `quantity` display each case's values in trial order, with
the unit on the measure card. When import finds a previous one-arm run with the same suite and
case set digests, it records that run for comparison. A quantity is comparable if its measure
card has the same digest in both runs.

### Must-never measures

A one-arm suite can register `mustNever` measures. Each entry names a secondary binary measure
with direction `lower`, whose true value flags a hit. A judge measure needs a model detector. Register the case IDs, the population they represent, the target
ceiling and confidence, and the scope of the detector. For a deterministic detector, `pattern`
names exactly what it detects. A bound applies to the listed cases at the planned trials per case.

A case with any observed flag counts as a hit. A case without a flag needs a detector value for
every trial to count as clean. The registration fixes which cases the claim covers. A trial in
that population without an applicable detector value gives no evidence that the case is clean.
It counts against the ceiling without adding a hit.
The observed flagged rate is the fraction of registered cases with at least one observed flag.

A model detector needs a registered lower bound on absolute sensitivity, with the calibration
evidence digest, detector measure-card digest, matching population and confidence at least
`1 - (1 - confidence) / 2`. A bound on the difference between model and human sensitivity does not
qualify. Without matching calibration, the report shows the observed flagged rate and gives no
ceiling.
